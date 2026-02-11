import { Controller, Get, Delete, Param, Query, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { TemporalClientService, WorkflowInfo } from '../temporal/temporal-client.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Controller('workflows')
@UseGuards(ApiKeyGuard)
export class WorkflowsController {
    constructor(private temporalClient: TemporalClientService) {}

    @Get('recent')
    async listRecent(@Query('limit') limit?: string): Promise<WorkflowInfo[]> {
        if (!this.temporalClient.isConnected()) {
            return [];
        }
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        return this.temporalClient.listRecentWorkflows(parsedLimit);
    }

    @Get(':workflowId')
    async getWorkflow(@Param('workflowId') workflowId: string): Promise<WorkflowInfo | { message: string }> {
        if (!this.temporalClient.isConnected()) {
            return { message: 'Temporal not enabled' };
        }
        const info = await this.temporalClient.getWorkflowStatus(workflowId);
        if (!info) {
            throw new HttpException(`Workflow ${workflowId} not found`, HttpStatus.NOT_FOUND);
        }
        return info;
    }

    @Delete(':workflowId')
    async cancelWorkflow(@Param('workflowId') workflowId: string): Promise<{ message: string }> {
        if (!this.temporalClient.isConnected()) {
            return { message: 'Temporal not enabled' };
        }
        await this.temporalClient.cancelWorkflow(workflowId);
        return { message: `Workflow ${workflowId} cancelled` };
    }
}
