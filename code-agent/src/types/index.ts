export interface AgentExecutionResult {
  success: boolean;
  rawOutput: string;
  error?: string;
}

export interface AgentExecutionOptions {
  workspaceRoot: string;
  timeout?: number;
  promptType?: string;
  repositoryId?: string;
  useMCPs?: boolean;
}

export interface AgentConfig {
  name: string;
  command: string;
  defaultTimeout: number;
}

export interface SpawnOptions {
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  prompt: string;
}

export interface CodingAgent {
  name: string;
  isAuthenticated(): Promise<boolean>;
  execute(prompt: string, options: AgentExecutionOptions): Promise<AgentExecutionResult>;
  executeStreaming?(prompt: string, options: AgentExecutionOptions): Promise<ReadableStream>;
  parseOutput(rawOutput: string): string | null;
}

export interface PromptRequest {
  prompt: string;
  timeout?: number;
  promptType?: string;
  repositoryId?: string;
  workspaceRoot?: string;
}








