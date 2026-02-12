import { Controller, Get, Delete, Param, Query, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { TemporalClientService, WorkflowInfo } from '../temporal/temporal-client.service';
import { IndexingService } from '../indexing/indexing.service';
import { DataSource } from '../types';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Controller('workflows')
@UseGuards(ApiKeyGuard)
export class WorkflowsController {
    constructor(
        private temporalClient: TemporalClientService,
        private indexingService: IndexingService,
    ) {}

    @Get('recent')
    async listRecent(@Query('limit') limit?: string): Promise<WorkflowInfo[]> {
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        return this.temporalClient.listRecentWorkflows(parsedLimit);
    }

    @Get(':workflowId')
    async getWorkflow(@Param('workflowId') workflowId: string): Promise<WorkflowInfo> {
        const info = await this.temporalClient.getWorkflowStatus(workflowId);
        if (!info) {
            throw new HttpException(`Workflow ${workflowId} not found`, HttpStatus.NOT_FOUND);
        }
        return info;
    }

    @Delete(':workflowId')
    async cancelWorkflow(@Param('workflowId') workflowId: string): Promise<{ message: string }> {
        const source = workflowId.replace(/^index-/, '') as DataSource;

        try {
            await this.temporalClient.cancelWorkflow(workflowId);
        } catch {
            // Workflow doesn't exist or already finished — still clear stale status below
        }

        await this.indexingService.resetStatusOnly(source);
        return { message: `Workflow ${workflowId} cancelled` };
    }
}
