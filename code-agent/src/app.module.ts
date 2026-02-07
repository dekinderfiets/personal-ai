import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PromptController } from './prompt.controller';
import { OpenAIController } from './openai.controller';
import { ResponsesController } from './responses.controller';
import { CursorAgentService } from './services/cursor-agent.service';

@Module({
  imports: [],
  controllers: [HealthController, PromptController, OpenAIController, ResponsesController],
  providers: [CursorAgentService],
})
export class AppModule { }