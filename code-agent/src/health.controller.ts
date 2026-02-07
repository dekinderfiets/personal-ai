import { Controller, Get } from '@nestjs/common';
import { CursorAgentService } from './services/cursor-agent.service';

@Controller('api/health')
export class HealthController {
  private readonly logger = console;

  constructor(private readonly cursorAgentService: CursorAgentService) {}

  @Get()
  async getHealth() {
    this.logger.log('Health check requested');

    const isAuthenticated = await this.cursorAgentService.isAuthenticated();

    return {
      status: 'healthy',
      agentAuthenticated: isAuthenticated,
      timestamp: new Date().toISOString(),
    };
  }
}