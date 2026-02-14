import { HttpException, HttpStatus } from '@nestjs/common';

import { WorkflowsController } from './workflows.controller';

describe('WorkflowsController', () => {
    let controller: WorkflowsController;
    let mockTemporalClient: any;
    let mockIndexingService: any;

    beforeEach(() => {
        mockTemporalClient = {
            listRecentWorkflows: jest.fn(),
            getWorkflowStatus: jest.fn(),
            cancelWorkflow: jest.fn(),
        };
        mockIndexingService = {
            resetStatusOnly: jest.fn(),
        };
        controller = new WorkflowsController(mockTemporalClient, mockIndexingService);
    });

    describe('listRecent', () => {
        it('should use default limit of 20', async () => {
            mockTemporalClient.listRecentWorkflows.mockResolvedValue([]);

            await controller.listRecent(undefined);

            expect(mockTemporalClient.listRecentWorkflows).toHaveBeenCalledWith(20);
        });

        it('should parse limit string', async () => {
            mockTemporalClient.listRecentWorkflows.mockResolvedValue([]);

            await controller.listRecent('10');

            expect(mockTemporalClient.listRecentWorkflows).toHaveBeenCalledWith(10);
        });
    });

    describe('getWorkflow', () => {
        it('should return workflow info when found', async () => {
            const info = {
                workflowId: 'index-gmail',
                runId: 'run1',
                type: 'indexSourceWorkflow',
                status: 'RUNNING',
            };
            mockTemporalClient.getWorkflowStatus.mockResolvedValue(info);

            const result = await controller.getWorkflow('index-gmail');

            expect(result).toEqual(info);
        });

        it('should throw 404 when workflow not found', async () => {
            mockTemporalClient.getWorkflowStatus.mockResolvedValue(null);

            await expect(controller.getWorkflow('index-unknown')).rejects.toThrow(
                new HttpException('Workflow index-unknown not found', HttpStatus.NOT_FOUND),
            );
        });
    });

    describe('cancelWorkflow', () => {
        it('should cancel workflow and reset status', async () => {
            mockTemporalClient.cancelWorkflow.mockResolvedValue(undefined);
            mockIndexingService.resetStatusOnly.mockResolvedValue(undefined);

            const result = await controller.cancelWorkflow('index-gmail');

            expect(mockTemporalClient.cancelWorkflow).toHaveBeenCalledWith('index-gmail');
            expect(mockIndexingService.resetStatusOnly).toHaveBeenCalledWith('gmail');
            expect(result).toEqual({ message: 'Workflow index-gmail cancelled' });
        });

        it('should still reset status even if cancel throws', async () => {
            mockTemporalClient.cancelWorkflow.mockRejectedValue(new Error('not found'));
            mockIndexingService.resetStatusOnly.mockResolvedValue(undefined);

            const result = await controller.cancelWorkflow('index-slack');

            expect(mockIndexingService.resetStatusOnly).toHaveBeenCalledWith('slack');
            expect(result).toEqual({ message: 'Workflow index-slack cancelled' });
        });

        it('should extract source correctly from workflowId', async () => {
            mockTemporalClient.cancelWorkflow.mockResolvedValue(undefined);
            mockIndexingService.resetStatusOnly.mockResolvedValue(undefined);

            await controller.cancelWorkflow('index-confluence');

            expect(mockIndexingService.resetStatusOnly).toHaveBeenCalledWith('confluence');
        });
    });
});
