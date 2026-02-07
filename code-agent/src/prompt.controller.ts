import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { CursorAgentService } from './services/cursor-agent.service';
import { PromptRequest } from './types';

@Controller('api/prompt')
export class PromptController {
  private readonly logger = console;

  constructor(private readonly cursorAgentService: CursorAgentService) {}

  @Post()
  async executePrompt(@Body() body: PromptRequest) {
    const { prompt, timeout, promptType, repositoryId, workspaceRoot } = body;

    if (!prompt || typeof prompt !== 'string') {
      throw new BadRequestException('Missing required field: prompt must be a non-empty string');
    }

    this.logger.log(`Executing prompt, length=${prompt.length}, timeout=${timeout || 'default'}, promptType=${promptType}, repositoryId=${repositoryId}`);

    try {
      const result = await this.cursorAgentService.execute(prompt, {
        workspaceRoot: workspaceRoot || process.env.WORKSPACE_ROOT || '/workspace',
        timeout,
        promptType,
        repositoryId,
      });

      this.logger.log(`Execution completed, success=${result.success}, outputLength=${result.rawOutput.length}`);

      if (result.success) {
        return result.rawOutput;
      } else {
        this.logger.error(`Agent execution failed, restarting container to clean up stuck processes: ${result.error}`);
        // Exit with error code to trigger container restart
        process.exit(1);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Unexpected error during prompt execution: ${errorMessage}, restarting container`, error);
      // Exit with error code to trigger container restart
      process.exit(1);
    }
  }
}