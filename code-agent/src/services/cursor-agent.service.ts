import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { CodingAgent, AgentExecutionResult, AgentExecutionOptions, AgentConfig, SpawnOptions } from '../types';

const AGENT_CONFIG: AgentConfig = {
  name: 'cursor',
  command: 'cursor-agent',
  defaultTimeout: Number.MAX_SAFE_INTEGER, // effectively no timeout
};

@Injectable()
export class CursorAgentService implements CodingAgent {
  private readonly logger = console;
  public readonly name = 'cursor';

  async isAuthenticated(): Promise<boolean> {
    // For cursor agent, we assume it's authenticated if the API key is set
    return !!process.env.CURSOR_API_KEY;
  }

  async execute(prompt: string, options: AgentExecutionOptions): Promise<AgentExecutionResult> {
    return this.executeAgent(AGENT_CONFIG, {
      args: this.buildArgs(options),
      cwd: options.workspaceRoot,
      prompt,
    }, options);
  }

  async executeStreaming(prompt: string, options: AgentExecutionOptions): Promise<ReadableStream> {
    return this.executeAgentStreaming(AGENT_CONFIG, {
      args: this.buildArgs(options),
      cwd: options.workspaceRoot,
      prompt,
    }, options);
  }

  parseOutput(rawOutput: string): string | null {
    return this.parseCursorOutput(rawOutput);
  }

  private buildArgs(options: AgentExecutionOptions): string[] {
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--disable-indexing',
      '--http-version', '2',
      '--insecure',
      '--force',
      '--model', 'grok-code-fast-1',
      '--workspace', options.workspaceRoot,
    ];

    if (options.useMCPs !== false) {
      args.push('--approve-mcps');
    }

    const apiKey = process.env.CURSOR_API_KEY;
    if (apiKey) {
      args.push('--api-key', apiKey);
    }

    this.logger.debug(`Cursor workspace root: ${options.workspaceRoot}`);
    return args;
  }

  private parseCursorOutput(rawOutput: string): string | null {
    this.logger.debug(`parseCursorOutput called with ${rawOutput.length} chars`);
    if (!rawOutput?.length) return null;

    return this.parseJsonStreamOutput(rawOutput, (event: unknown) => {
      const e = event as {
        type?: string;
        result?: string;
        message?: { content?: Array<{ type: string; text?: string }> };
      };

      // Look for result messages
      if (e.type === 'result' && e.result) {
        this.logger.debug('Found result event');
        return this.extractJson(e.result);
      }

      // Also check for assistant messages
      if (e.type === 'assistant' && e.message?.content) {
        const content = e.message.content;
        if (Array.isArray(content)) {
          const textContent = content.find((item) => item.type === 'text');
          if (textContent?.text) {
            // Check if the text content is a JSON string containing a tool call
            try {
              const parsedText = JSON.parse(textContent.text);
              if (parsedText && typeof parsedText === 'object' && parsedText.tool_call) {
                // Return the tool call as a JSON string so it can be detected by the Ollama controller
                return JSON.stringify(parsedText);
              }
            } catch (e) {
              // Not a JSON tool call, return as normal text
            }
            return textContent.text;
          }
        }
      }

      return null;
    });
  }

  private extractJson(result: string): string {
    const jsonStart = result.indexOf('{');
    const jsonEnd = result.lastIndexOf('}');

    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const jsonCandidate = result.substring(jsonStart, jsonEnd + 1);
      try {
        JSON.parse(jsonCandidate);
        return jsonCandidate;
      } catch {
        return result;
      }
    }
    return result;
  }

  private parseJsonStreamOutput(
    rawOutput: string,
    predicate: (event: unknown) => string | null
  ): string | null {
    const lines = rawOutput.trim().split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);
        const result = predicate(event);
        if (result !== null) return result;
      } catch {
        // Skip non-JSON lines
        continue;
      }
    }

    return null;
  }

  private executeAgent(
    config: AgentConfig,
    spawnOptions: SpawnOptions,
    options: AgentExecutionOptions
  ): Promise<AgentExecutionResult> {
    const { name, command, defaultTimeout } = config;
    const { args, cwd, env, prompt } = spawnOptions;
    const timeout = options.timeout ?? defaultTimeout;

    return new Promise((resolve) => {
      let output = '';
      let timeoutId: NodeJS.Timeout | null = null;

      this.logger.log(`Executing ${name} with prompt (${prompt.length} chars)`);
      this.logger.log(`Current PATH: ${process.env.PATH}`);

      // Try to find the executable
      let cmdToRun = command;
      // Check common locations if simple command not found (logic could be expanded, but for now specific to this issue)
      if (command === 'cursor-agent') {
        const potentialPath = '/root/.local/bin/cursor-agent';
        try {
          // We'll trust the absolute path if we're in the container environment known to use it
          if (require('fs').existsSync(potentialPath)) { // Using require to avoid top-level import changes if possible, or just add import
            cmdToRun = potentialPath;
            this.logger.log(`Found cursor-agent at absolute path: ${cmdToRun}`);
          }
        } catch (e) {
          this.logger.warn(`Could not check for absolute path: ${e}`);
        }
      }

      this.logger.log(`Spawning command: ${cmdToRun}`);

      const proc = spawn(cmdToRun, args, {
        cwd,
        env: env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Write prompt to stdin
      proc.stdin?.write(prompt);
      proc.stdin?.end();

      // Set timeout
      timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          success: false,
          rawOutput: output,
          error: `${name} execution timed out after ${timeout}ms`,
        });
      }, timeout);

      // Stream stdout
      proc.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        this.logger.debug(`[${name} stdout] ${chunk.trim()}`);
      });

      // Stream stderr
      proc.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        this.logger.error(`[${name} stderr] ${chunk.trim()}`);
      });

      proc.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);

        this.logger.log(`[${name}] Process exited with code: ${code}`);

        if (code === 0) {
          this.logger.log(`[${name}] Execution completed successfully`);
          resolve({ success: true, rawOutput: output });
        } else {
          this.logger.error(`[${name}] Execution failed with code ${code}`);
          resolve({
            success: false,
            rawOutput: output,
            error: `${name} exited with code ${code}`,
          });
        }
      });

      proc.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId);

        this.logger.error(`[${name}] Process error: ${err.message}`);

        resolve({
          success: false,
          rawOutput: output,
          error: `Failed to spawn ${name}: ${err.message}`,
        });
      });
    });
  }

  private executeAgentStreaming(
    config: AgentConfig,
    spawnOptions: SpawnOptions,
    options: AgentExecutionOptions
  ): Promise<ReadableStream> {
    const { name, command } = config;
    const { args, cwd, env, prompt } = spawnOptions;
    const timeout = options.timeout ?? config.defaultTimeout;

    return new Promise((resolve, reject) => {
      this.logger.log(`Executing ${name} streaming with prompt (${prompt.length} chars)`);
      this.logger.log(`Current PATH: ${process.env.PATH}`);

      // Try to find the executable
      let cmdToRun = command;
      // Check common locations if simple command not found
      if (command === 'cursor-agent') {
        const potentialPath = '/root/.local/bin/cursor-agent';
        try {
          // We'll trust the absolute path if we're in the container environment known to use it
          if (require('fs').existsSync(potentialPath)) {
            cmdToRun = potentialPath;
            this.logger.log(`Found cursor-agent at absolute path: ${cmdToRun}`);
          }
        } catch (e) {
          this.logger.warn(`Could not check for absolute path: ${e}`);
        }
      }

      this.logger.log(`Spawning command (streaming): ${cmdToRun}`);

      const proc = spawn(cmdToRun, args, {
        cwd,
        env: env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Write prompt to stdin
      proc.stdin?.write(prompt);
      proc.stdin?.end();

      let timeoutId: NodeJS.Timeout | null = null;
      let streamEnded = false;

      // Create a ReadableStream
      const stream = new ReadableStream({
        start: (controller) => {
          // Set timeout
          timeoutId = setTimeout(() => {
            proc.kill('SIGTERM');
            controller.error(new Error(`${name} execution timed out after ${timeout}ms`));
          }, timeout);

          // Stream stdout as it comes in
          proc.stdout.on('data', (data: Buffer) => {
            const chunk = data.toString();
            this.logger.debug(`[${name} streaming stdout] ${chunk.trim()}`);

            // Enqueue each line as it comes
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                controller.enqueue(line.trim());
              }
            }
          });

          // Handle stderr
          proc.stderr.on('data', (data: Buffer) => {
            const chunk = data.toString();
            this.logger.error(`[${name} streaming stderr] ${chunk.trim()}`);
          });

          // Handle process completion
          proc.on('close', (code) => {
            if (timeoutId) clearTimeout(timeoutId);

            if (!streamEnded) {
              streamEnded = true;
              if (code === 0) {
                this.logger.log(`[${name}] Streaming execution completed successfully`);
                controller.close();
              } else {
                this.logger.error(`[${name}] Streaming execution failed with code ${code}`);
                controller.error(new Error(`${name} exited with code ${code}`));
              }
            }
          });

          proc.on('error', (err) => {
            if (timeoutId) clearTimeout(timeoutId);

            if (!streamEnded) {
              streamEnded = true;
              this.logger.error(`[${name}] Streaming process error: ${err.message}`);
              controller.error(new Error(`Failed to spawn ${name}: ${err.message}`));
            }
          });
        },
        cancel: () => {
          if (timeoutId) clearTimeout(timeoutId);
          proc.kill('SIGTERM');
        }
      });

      resolve(stream);
    });
  }
}