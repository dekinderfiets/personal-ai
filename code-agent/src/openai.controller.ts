import { Controller, Post, Get, Body, BadRequestException, Headers, Res, Sse } from '@nestjs/common';
import { Response } from 'express';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CursorAgentService } from './services/cursor-agent.service';
import {
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIChatStreamResponse
} from './types/openai';

@Controller('v1')
export class OpenAIController {
  private readonly logger = console;
  private readonly supportedModel = 'grok-code-fast-1';

  constructor(private readonly cursorAgentService: CursorAgentService) {}

  @Get('models')
  getModels() {
    return {
      object: 'list',
      data: [
        {
          id: 'grok',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'cursor-agent'
        }
      ]
    };
  }

  @Post('chat/completions')
  async chatCompletions(@Body() body: OpenAIChatRequest, @Headers('authorization') auth?: string, @Res() res?: Response): Promise<OpenAIChatResponse | void> {
    // Basic API key validation (optional - for compatibility with OpenAI clients)
    // We accept any Bearer token for now, or no authentication

    const { model, messages, stream = false, tools } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new BadRequestException('Missing required field: messages must be a non-empty array');
    }

    if (model !== this.supportedModel) {
      throw new BadRequestException(`Model '${model}' not supported. Only '${this.supportedModel}' is available.`);
    }

    // Handle streaming requests
    if (stream) {
      return this.handleStreamingChatCompletions(body, res!);
    }

    let enhancedPrompt: string;

    if (tools && tools.length > 0) {
      // For chat with tools, put tool instructions FIRST, then conversation history
      enhancedPrompt = this.createToolInstructions(tools) + '\n\n' + this.convertMessagesToPrompt(messages);
    } else {
      // Normal chat without tools
      enhancedPrompt = this.convertMessagesToPrompt(messages);
    }

    this.logger.log(`OpenAI chat completions request: model=${model}, messageCount=${messages.length}, tools=${tools?.length || 0}`);

    // Create temporary directory for this request
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openai-agent-'));

    try {
      const result = await this.cursorAgentService.execute(enhancedPrompt, {
        workspaceRoot: tempDir,
        timeout: 3600000, // 1 hour default
        useMCPs: false, // Don't use cursor's MCPs
      });

      if (!result.success) {
        throw new BadRequestException(`Agent execution failed: ${result.error}`);
      }

      // Check if the raw output contains a tool call first
      const toolCall = this.extractToolCall(result.rawOutput);

      // Also check if the parsed output contains a tool call (for cases where AI describes tool calls)
      const parsedOutput = this.cursorAgentService.parseOutput(result.rawOutput) || result.rawOutput;
      const toolCallFromContent = this.extractToolCall(parsedOutput);

      // Special handling: check if parsedOutput is a JSON string containing a tool_call
      let jsonToolCall = null;
      if (parsedOutput && typeof parsedOutput === 'string') {
        try {
          const cleanedParsedOutput = this.cleanMarkdownArtifacts(parsedOutput);
          const parsed = JSON.parse(cleanedParsedOutput);
          if (parsed.tool_call) {
            jsonToolCall = {
              function: {
                name: parsed.tool_call.name,
                arguments: parsed.tool_call.arguments
              }
            };
          }
        } catch (e) {
          // Not JSON
        }
      }

      const finalToolCall = toolCall || toolCallFromContent || jsonToolCall;

      const response: OpenAIChatResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: this.supportedModel,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: finalToolCall ? null : parsedOutput,
            tool_calls: finalToolCall ? [{
              id: `call_${Date.now()}`,
              type: 'function',
              function: {
                name: finalToolCall.function.name,
                arguments: JSON.stringify(finalToolCall.function.arguments)
              }
            }] : undefined
          },
          finish_reason: finalToolCall ? 'tool_calls' : 'stop'
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };

      // Send the response manually since we have @Res() decorator
      res!.json(response);
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error in chat completions endpoint: ${errorMessage}`);
      process.exit(1);
    } finally {
      // Clean up temporary directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        this.logger.debug(`Cleaned up temporary directory: ${tempDir}`);
      } catch (cleanupError) {
        this.logger.error(`Failed to clean up temporary directory ${tempDir}:`, cleanupError);
        process.exit(1);
      }
    }
  }

  private async handleStreamingChatCompletions(body: OpenAIChatRequest, res: Response): Promise<void> {
    const { model, messages, tools } = body;

    // Create temporary directory for this request
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openai-agent-streaming-'));

    try {
      let enhancedPrompt: string;

      if (tools && tools.length > 0) {
        // For chat with tools, put tool instructions FIRST, then conversation history
        enhancedPrompt = this.createToolInstructions(tools) + '\n\n' + this.convertMessagesToPrompt(messages);
      } else {
        // Normal chat without tools
        enhancedPrompt = this.convertMessagesToPrompt(messages);
      }

      this.logger.log(`OpenAI streaming chat completions request: model=${model}, messageCount=${messages.length}, tools=${tools?.length || 0}`);

      // Set up Server-Sent Events headers
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Get streaming response from cursor agent
      const stream = await this.cursorAgentService.executeStreaming(enhancedPrompt, {
        workspaceRoot: tempDir,
        timeout: 3600000, // 1 hour default
        useMCPs: false, // Don't use cursor's MCPs
      });

      const reader = stream.getReader();
      let assistantContent = '';
      let toolCalls: any[] = [];
      let hasStartedResponse = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Parse the JSON event from cursor
          let cursorEvent;
          try {
            cursorEvent = JSON.parse(value);
          } catch (e) {
            continue; // Skip non-JSON lines
          }

          // Convert cursor event to OpenAI streaming format
          if (cursorEvent.type === 'assistant' && cursorEvent.message?.content) {
            const content = cursorEvent.message.content;
            if (Array.isArray(content)) {
              const textContent = content.find((item) => item.type === 'text');
              if (textContent?.text) {
                // Check if this is a tool call
                let isToolCall = false;
                let toolCallData = null;

                try {
                  const parsedText = JSON.parse(textContent.text);
                  if (parsedText && typeof parsedText === 'object' && parsedText.tool_call) {
                    isToolCall = true;
                    toolCallData = parsedText.tool_call;
                  }
                } catch (e) {
                  // Not a tool call, treat as regular content
                }

                if (isToolCall) {
                  // Send tool call chunk
                  const chunk: OpenAIChatStreamResponse = {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: this.supportedModel,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          index: toolCalls.length,
                          id: `call_${Date.now()}`,
                          type: 'function',
                          function: {
                            name: toolCallData.name,
                            arguments: toolCallData.arguments
                          }
                        }]
                      },
                      finish_reason: null
                    }]
                  };
                  toolCalls.push(toolCallData);
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                } else {
                  // Send regular content chunk
                  if (!hasStartedResponse) {
                    // First chunk includes role
                    const chunk: OpenAIChatStreamResponse = {
                      id: `chatcmpl-${Date.now()}`,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: this.supportedModel,
                      choices: [{
                        index: 0,
                        delta: {
                          role: 'assistant',
                          content: textContent.text
                        },
                        finish_reason: null
                      }]
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    hasStartedResponse = true;
                  } else {
                    // Subsequent chunks only include content
                    const chunk: OpenAIChatStreamResponse = {
                      id: `chatcmpl-${Date.now()}`,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: this.supportedModel,
                      choices: [{
                        index: 0,
                        delta: {
                          content: textContent.text
                        },
                        finish_reason: null
                      }]
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                  }
                  assistantContent += textContent.text;
                }
              }
            }
          } else if (cursorEvent.type === 'result') {
            // End of stream - send final chunk with finish_reason
            const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
            const chunk: OpenAIChatStreamResponse = {
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: this.supportedModel,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: finishReason
              }]
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error in streaming chat completions endpoint: ${errorMessage}`);

      // Send error as SSE
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
    } finally {
      // Clean up temporary directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        this.logger.debug(`Cleaned up temporary streaming directory: ${tempDir}`);
      } catch (cleanupError) {
        this.logger.error(`Failed to clean up temporary streaming directory ${tempDir}:`, cleanupError);
      }
    }
  }


  private convertMessagesToPrompt(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): string {
    let prompt = '';

    for (const message of messages) {
      switch (message.role) {
        case 'system':
          prompt += `System: ${message.content}\n\n`;
          break;
        case 'user':
          prompt += `User: ${message.content}\n\n`;
          break;
        case 'assistant':
          prompt += `Assistant: ${message.content}\n\n`;
          break;
      }
    }

    prompt += 'Assistant: ';
    return prompt;
  }

  private enhancePromptWithTools(prompt: string, tools: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
      };
    };
  }>): string {
    let enhancedPrompt = prompt;

    // CRITICAL: Instruct to NEVER use internal tools
    enhancedPrompt += '\n\n## CRITICAL RESTRICTIONS - VIOLATION = FAILURE\n';
    enhancedPrompt += '**YOU ARE FORBIDDEN from using any internal tools, functions, or capabilities.**\n';
    enhancedPrompt += '**YOU ARE FORBIDDEN from calling yourself or any other tools.**\n';
    enhancedPrompt += '**YOU MUST ONLY use the tools listed below - NO EXCEPTIONS.**\n';
    enhancedPrompt += '**If you need to perform an action that requires a tool, YOU MUST CALL THE APPROPRIATE TOOL FROM THE LIST BELOW.**\n';
    enhancedPrompt += '**DO NOT describe what you would do - DO NOT explain actions - ONLY CALL TOOLS.**\n';
    enhancedPrompt += '**If the exact tool you need is not in the list, respond with: "I cannot complete this task with available tools."**\n\n';

    // Add tools information to the prompt
    enhancedPrompt += '## AVAILABLE TOOLS (USE ONLY THESE - NO EXCEPTIONS)\n';
    enhancedPrompt += 'These are the ONLY tools you can use. You cannot use any other tools, functions, or capabilities.\n\n';

    if (tools.length === 0) {
      enhancedPrompt += '**NO TOOLS AVAILABLE**\n';
      enhancedPrompt += 'You have no tools available. Respond with normal text only.\n\n';
      return enhancedPrompt;
    }

    for (const tool of tools) {
      if (tool.type === 'function') {
        enhancedPrompt += `### TOOL: ${tool.function.name} (AVAILABLE)\n`;
        enhancedPrompt += `DESCRIPTION: ${tool.function.description}\n`;
        enhancedPrompt += `STATUS: This tool IS available and you CAN use it\n`;

        if (tool.function.parameters.properties) {
          enhancedPrompt += 'PARAMETERS:\n';
          for (const [paramName, paramDef] of Object.entries(tool.function.parameters.properties)) {
            const required = tool.function.parameters.required?.includes(paramName) ? ' (REQUIRED)' : ' (optional)';
            enhancedPrompt += `  - ${paramName}: ${paramDef.description || paramDef.type}${required}\n`;
          }
        }

        enhancedPrompt += '\n**MANDATORY: TO USE THIS TOOL, YOU MUST RESPOND WITH EXACTLY THIS JSON FORMAT ONLY:**\n';
        enhancedPrompt += `{"tool_call": {"name": "${tool.function.name}", "arguments": {...}}}\n`;
        enhancedPrompt += `**DO NOT add any other text. DO NOT explain. JUST the JSON.**\n\n`;
      }
    }

    enhancedPrompt += '**MANDATORY RULES - FOLLOW THESE EXACTLY:**\n';
    enhancedPrompt += '🚫 NEVER use any tools not listed above\n';
    enhancedPrompt += '🚫 NEVER call yourself or any other functions\n';
    enhancedPrompt += '🚫 NEVER try to access files, run commands, or use internal capabilities\n';
    enhancedPrompt += '🚫 NEVER mention or reference any tools not in the list above\n';
    enhancedPrompt += '✅ ONLY use tools from the list directly above\n';
    enhancedPrompt += '✅ If you need information that requires a tool, USE the appropriate tool from the list\n';
    enhancedPrompt += '✅ When calling a tool, respond with ONLY the JSON format shown\n';
    enhancedPrompt += '✅ If the task can be completed without tools, respond normally\n\n';

    enhancedPrompt += '**TOOL USAGE REQUIREMENTS - YOU MUST FOLLOW THESE:**\n';
    enhancedPrompt += '- **If you need to search or query data** → CALL the appropriate tool\n';
    enhancedPrompt += '- **If you need to access external information** → CALL the appropriate tool\n';
    enhancedPrompt += '- **If the task requires any tool functionality** → CALL the tool\n';
    enhancedPrompt += '- **Only respond with normal text if NO tools are needed**\n';
    enhancedPrompt += '- **NEVER describe tool actions - ALWAYS CALL the tools**\n\n';

    return enhancedPrompt;
  }

  private createToolInstructions(tools: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
      };
    };
  }>): string {
    let instructions = '';

    // CRITICAL: Instruct to NEVER use internal tools and NEVER multiple tools
    instructions += '## CRITICAL RESTRICTIONS - VIOLATION = FAILURE\n';
    instructions += '**YOU MUST NOT use any internal tools, functions, or capabilities.**\n';
    instructions += '**YOU MUST NOT call yourself or any other tools.**\n';
    instructions += '**ONLY use the tools listed below - no exceptions.**\n';
    instructions += '**MOST IMPORTANT: YOU CAN ONLY CALL ONE TOOL PER RESPONSE - NEVER MULTIPLE TOOLS**\n';
    instructions += '**If you need multiple tools, respond with only the first one needed.**\n';
    instructions += '**DO NOT output multiple tool calls in one response - this will break the system.**\n';
    instructions += '**If you need to perform an action that requires a tool, YOU MUST CALL EXACTLY ONE APPROPRIATE TOOL FROM THE LIST BELOW.**\n';
    instructions += '**DO NOT describe what you would do - DO NOT explain actions - ONLY CALL ONE TOOL.**\n';
    instructions += '**If the exact tool you need is not in the list, respond with: "I cannot complete this task with available tools."**\n\n';

    // Add tools information
    instructions += '## AVAILABLE TOOLS (USE ONLY THESE - NO EXCEPTIONS)\n';
    instructions += 'These are the ONLY tools you can use. You cannot use any other tools, functions, or capabilities.\n\n';

    for (const tool of tools) {
      if (tool.type === 'function') {
        instructions += `### TOOL: ${tool.function.name} (AVAILABLE)\n`;
        instructions += `DESCRIPTION: ${tool.function.description}\n`;
        instructions += `STATUS: This tool IS available and you CAN use it\n`;

        if (tool.function.parameters.properties) {
          instructions += 'PARAMETERS:\n';
          for (const [paramName, paramDef] of Object.entries(tool.function.parameters.properties)) {
            const required = tool.function.parameters.required?.includes(paramName) ? ' (REQUIRED)' : ' (optional)';
            instructions += `  - ${paramName}: ${paramDef.description || paramDef.type}${required}\n`;
          }
        }

        instructions += '\n**MANDATORY: TO USE THIS TOOL, YOU MUST RESPOND WITH EXACTLY THIS JSON FORMAT ONLY:**\n';
        instructions += `{"tool_call": {"name": "${tool.function.name}", "arguments": {...}}}\n`;
        instructions += `**DO NOT add any other text. DO NOT explain. JUST the JSON.**\n\n`;
      }
    }

    instructions += '**MANDATORY RULES - FOLLOW THESE EXACTLY:**\n';
    instructions += '🚫 NEVER use any tools not listed above\n';
    instructions += '🚫 NEVER call yourself or any other functions\n';
    instructions += '🚫 NEVER try to access files, run commands, or use internal capabilities\n';
    instructions += '🚫 NEVER mention or reference any tools not in the list above\n';
    instructions += '🚫 NEVER CALL MULTIPLE TOOLS IN ONE RESPONSE - ONLY ONE TOOL MAX\n';
    instructions += '🚫 DO NOT OUTPUT MULTIPLE TOOL CALLS - THIS BREAKS THE SYSTEM\n';
    instructions += '✅ ONLY use tools from the list directly above\n';
    instructions += '✅ ONLY CALL ONE TOOL PER RESPONSE - MAXIMUM OF ONE\n';
    instructions += '✅ If you need information that requires a tool, USE EXACTLY ONE appropriate tool from the list\n';
    instructions += '✅ When calling a tool, respond with ONLY the JSON format shown\n';
    instructions += '✅ If the task can be completed without tools, respond normally\n\n';

    instructions += '**TOOL DECISION GUIDE - YOU MUST FOLLOW THESE:**\n';
    instructions += '- **If you need to search or query data** → CALL EXACTLY ONE appropriate tool\n';
    instructions += '- **If you need to access external information** → CALL EXACTLY ONE appropriate tool\n';
    instructions += '- **If the task requires any tool functionality** → CALL EXACTLY ONE tool\n';
    instructions += '- **MAXIMUM OF ONE TOOL CALL PER RESPONSE - NEVER MORE**\n';
    instructions += '- **Only respond with normal text if NO tools are needed**\n';
    instructions += '- **NEVER describe tool actions - ALWAYS CALL EXACTLY ONE tool**\n\n';

    return instructions;
  }

  private cleanMarkdownArtifacts(output: string): string {
    if (!output || typeof output !== 'string') {
      return output;
    }

    let cleaned = output;

    // Remove opening ```json or ```json\n
    cleaned = cleaned.replace(/^```json\n?/gm, '');

    // Remove opening ``` and closing ```
    cleaned = cleaned.replace(/^```\n?/gm, '').replace(/\n?```$/gm, '');

    // Remove XML-like closing tags and everything after them
    cleaned = cleaned.replace(/<\/parameter>[\s\S]*$/gm, '');

    // Remove function call tags
    cleaned = cleaned.replace(/<\/xai:function_call>[\s\S]*$/gm, '');

    // Remove \n at beginning or end
    cleaned = cleaned.replace(/^\n+|\n+$/g, '');

    return cleaned;
  }

  private extractToolCall(output: string): any | null {
    if (!output || typeof output !== 'string') {
      return null;
    }

    // Clean markdown artifacts from the output
    let cleanedOutput = this.cleanMarkdownArtifacts(output);

    // First try to parse the entire output as JSON (this handles the JSON string case)
    try {
      const parsed = JSON.parse(cleanedOutput.trim());
      if (parsed && typeof parsed === 'object' && parsed.tool_call) {
        // Check if there are multiple tool calls in the JSON (shouldn't happen but be safe)
        if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 1) {
          console.warn(`WARNING: Multiple tool_calls array detected, using only the first one`);
          return {
            function: {
              name: parsed.tool_calls[0].function.name,
              arguments: parsed.tool_calls[0].function.arguments
            }
          };
        }
        return {
          function: {
            name: parsed.tool_call.name,
            arguments: parsed.tool_call.arguments
          }
        };
      }
    } catch (e) {
      // Not valid JSON, continue with regex
    }

    // Look for tool call patterns in text (cursor-agent format)
    const toolCallRegex = /\{\s*"tool_call"\s*:\s*\{[^}]+\}\s*\}/g;
    const matches = cleanedOutput.match(toolCallRegex);

    if (matches && matches.length > 0) {
      // CRITICAL: Only return the FIRST tool call - multiple tool calls break the system
      if (matches.length > 1) {
        console.warn(`WARNING: Multiple tool calls detected (${matches.length}), using only the first one`);
      }
      try {
        const toolCall = JSON.parse(matches[0]);
        if (toolCall.tool_call) {
          return {
            function: {
              name: toolCall.tool_call.name,
              arguments: toolCall.tool_call.arguments
            }
          };
        }
      } catch (e) {
        // Failed to parse tool call
      }
    }

    return null;
  }
}
