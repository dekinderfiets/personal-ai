import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from '../types';
import { SerializableIndexRequest } from './types';

export interface WorkflowInfo {
    workflowId: string;
    runId: string;
    type: string;
    status: string;
    startTime: string;
    closeTime?: string;
    executionTime?: number;
}

@Injectable()
export class TemporalClientService {
    private readonly logger = new Logger(TemporalClientService.name);
    private client: any = null;
    private WorkflowExecutionAlreadyStartedError: any = null;
    private namespace: string;
    private taskQueue: string;

    constructor(private configService: ConfigService) {
        this.namespace = this.configService.get<string>('temporal.namespace', 'default');
        this.taskQueue = this.configService.get<string>('temporal.taskQueue', 'collector-indexing');
    }

    async connect(connection: any): Promise<void> {
        // Dynamically import to get the Client class
        const { Client, WorkflowExecutionAlreadyStartedError } = await import('@temporalio/client');
        this.client = new Client({ connection, namespace: this.namespace });
        this.WorkflowExecutionAlreadyStartedError = WorkflowExecutionAlreadyStartedError;
        this.logger.log('Temporal client connected');
    }

    isConnected(): boolean {
        return this.client !== null;
    }

    async startIndexSource(
        source: DataSource,
        request: SerializableIndexRequest = {},
    ): Promise<{ started: boolean; message: string; workflowId: string }> {
        if (!this.client) throw new Error('Temporal client not connected');

        const workflowId = `index-${source}`;
        try {
            const handle = await this.client.workflow.start('indexSourceWorkflow', {
                taskQueue: this.taskQueue,
                workflowId,
                args: [{ source, request }],
            });
            this.logger.log(`Started workflow ${workflowId} (runId: ${handle.firstExecutionRunId})`);
            return { started: true, message: 'Workflow started', workflowId };
        } catch (err) {
            if (this.WorkflowExecutionAlreadyStartedError && err instanceof this.WorkflowExecutionAlreadyStartedError) {
                return { started: false, message: 'Indexing already in progress', workflowId };
            }
            throw err;
        }
    }

    async startCollectAll(
        request: SerializableIndexRequest = {},
        sources?: DataSource[],
    ): Promise<{ started: boolean; message: string; workflowId: string }> {
        if (!this.client) throw new Error('Temporal client not connected');

        const workflowId = 'collect-all';
        try {
            const handle = await this.client.workflow.start('collectAllWorkflow', {
                taskQueue: this.taskQueue,
                workflowId,
                args: [{ request, sources }],
            });
            this.logger.log(`Started collect-all workflow (runId: ${handle.firstExecutionRunId})`);
            return { started: true, message: 'Collect all started', workflowId };
        } catch (err) {
            if (this.WorkflowExecutionAlreadyStartedError && err instanceof this.WorkflowExecutionAlreadyStartedError) {
                return { started: false, message: 'Collect all already in progress', workflowId };
            }
            throw err;
        }
    }

    async listRecentWorkflows(limit = 20): Promise<WorkflowInfo[]> {
        if (!this.client) throw new Error('Temporal client not connected');

        const workflows: WorkflowInfo[] = [];
        const iter = this.client.workflow.list({
            query: `TaskQueue = '${this.taskQueue}' ORDER BY StartTime DESC`,
        });

        let count = 0;
        for await (const wf of iter) {
            if (count >= limit) break;
            workflows.push({
                workflowId: wf.workflowId,
                runId: wf.runId,
                type: wf.type,
                status: statusName(wf.status.code),
                startTime: wf.startTime.toISOString(),
                closeTime: wf.closeTime?.toISOString(),
                executionTime: wf.closeTime
                    ? wf.closeTime.getTime() - wf.startTime.getTime()
                    : undefined,
            });
            count++;
        }

        return workflows;
    }

    async getWorkflowStatus(workflowId: string): Promise<WorkflowInfo | null> {
        if (!this.client) throw new Error('Temporal client not connected');

        try {
            const handle = this.client.workflow.getHandle(workflowId);
            const desc = await handle.describe();
            return {
                workflowId: desc.workflowId,
                runId: desc.runId,
                type: desc.type,
                status: statusName(desc.status.code),
                startTime: desc.startTime.toISOString(),
                closeTime: desc.closeTime?.toISOString(),
                executionTime: desc.closeTime
                    ? desc.closeTime.getTime() - desc.startTime.getTime()
                    : undefined,
            };
        } catch {
            return null;
        }
    }

    async cancelWorkflow(workflowId: string): Promise<void> {
        if (!this.client) throw new Error('Temporal client not connected');
        const handle = this.client.workflow.getHandle(workflowId);
        await handle.cancel();
        this.logger.log(`Cancelled workflow ${workflowId}`);
    }

    async checkHealth(): Promise<boolean> {
        if (!this.client) return false;
        try {
            const iter = this.client.workflow.list({ query: `TaskQueue = '${this.taskQueue}'` });
            for await (const _ of iter) {
                break;
            }
            return true;
        } catch {
            return false;
        }
    }
}

function statusName(code: number): string {
    const map: Record<number, string> = {
        0: 'UNSPECIFIED',
        1: 'RUNNING',
        2: 'COMPLETED',
        3: 'FAILED',
        4: 'CANCELLED',
        5: 'TERMINATED',
        6: 'CONTINUED_AS_NEW',
        7: 'TIMED_OUT',
    };
    return map[code] || 'UNKNOWN';
}
