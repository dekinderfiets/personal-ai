import { TemporalClientService } from './temporal-client.service';

describe('TemporalClientService', () => {
    let service: TemporalClientService;
    let mockClient: any;

    beforeEach(() => {
        const mockConfigService = {
            get: jest.fn((key: string, defaultValue?: string) => {
                if (key === 'temporal.namespace') return 'default';
                if (key === 'temporal.taskQueue') return 'collector-indexing';
                return defaultValue;
            }),
        };
        service = new TemporalClientService(mockConfigService as any);

        // Set up mock client directly on the service
        mockClient = {
            workflow: {
                start: jest.fn(),
                getHandle: jest.fn(),
                list: jest.fn(),
            },
        };
        (service as any).client = mockClient;
    });

    describe('startIndexSource', () => {
        it('should return started=true on success', async () => {
            mockClient.workflow.start.mockResolvedValue({ firstExecutionRunId: 'run-1' });

            const result = await service.startIndexSource('gmail', {});

            expect(result).toEqual({
                started: true,
                message: 'Workflow started',
                workflowId: 'index-gmail',
            });
            expect(mockClient.workflow.start).toHaveBeenCalledWith('indexSourceWorkflow', {
                taskQueue: 'collector-indexing',
                workflowId: 'index-gmail',
                args: [{ source: 'gmail', request: {} }],
            });
        });

        it('should return started=false when WorkflowAlreadyStarted', async () => {
            class WorkflowExecutionAlreadyStartedError extends Error {
                constructor() {
                    super('already started');
                    this.name = 'WorkflowExecutionAlreadyStartedError';
                }
            }
            (service as any).WorkflowExecutionAlreadyStartedError = WorkflowExecutionAlreadyStartedError;
            mockClient.workflow.start.mockRejectedValue(new WorkflowExecutionAlreadyStartedError());

            const result = await service.startIndexSource('gmail');

            expect(result).toEqual({
                started: false,
                message: 'Indexing already in progress',
                workflowId: 'index-gmail',
            });
        });

        it('should rethrow non-AlreadyStarted errors', async () => {
            mockClient.workflow.start.mockRejectedValue(new Error('network error'));

            await expect(service.startIndexSource('gmail')).rejects.toThrow('network error');
        });
    });

    describe('startCollectAll', () => {
        it('should return started=true on success', async () => {
            mockClient.workflow.start.mockResolvedValue({ firstExecutionRunId: 'run-2' });

            const result = await service.startCollectAll({}, ['gmail', 'slack']);

            expect(result).toEqual({
                started: true,
                message: 'Collect all started',
                workflowId: 'collect-all',
            });
            expect(mockClient.workflow.start).toHaveBeenCalledWith('collectAllWorkflow', {
                taskQueue: 'collector-indexing',
                workflowId: 'collect-all',
                args: [{ request: {}, sources: ['gmail', 'slack'] }],
            });
        });

        it('should return started=false when WorkflowAlreadyStarted', async () => {
            class WorkflowExecutionAlreadyStartedError extends Error {}
            (service as any).WorkflowExecutionAlreadyStartedError = WorkflowExecutionAlreadyStartedError;
            mockClient.workflow.start.mockRejectedValue(new WorkflowExecutionAlreadyStartedError());

            const result = await service.startCollectAll();

            expect(result).toEqual({
                started: false,
                message: 'Collect all already in progress',
                workflowId: 'collect-all',
            });
        });
    });

    describe('isWorkflowRunning', () => {
        it('should return true when status code is 1 (RUNNING)', async () => {
            const mockHandle = {
                describe: jest.fn().mockResolvedValue({ status: { code: 1 } }),
            };
            mockClient.workflow.getHandle.mockReturnValue(mockHandle);

            const result = await service.isWorkflowRunning('index-gmail');

            expect(result).toBe(true);
        });

        it('should return false when status code is not 1', async () => {
            const mockHandle = {
                describe: jest.fn().mockResolvedValue({ status: { code: 2 } }),
            };
            mockClient.workflow.getHandle.mockReturnValue(mockHandle);

            const result = await service.isWorkflowRunning('index-gmail');

            expect(result).toBe(false);
        });

        it('should return false on error', async () => {
            const mockHandle = {
                describe: jest.fn().mockRejectedValue(new Error('not found')),
            };
            mockClient.workflow.getHandle.mockReturnValue(mockHandle);

            const result = await service.isWorkflowRunning('index-unknown');

            expect(result).toBe(false);
        });
    });

    describe('checkHealth', () => {
        it('should return true when list iteration succeeds', async () => {
            // Create an async iterable that yields one item
            const asyncIterable = {
                [Symbol.asyncIterator]: () => {
                    let done = false;
                    return {
                        next: async () => {
                            if (!done) {
                                done = true;
                                return { value: { workflowId: 'test' }, done: false };
                            }
                            return { value: undefined, done: true };
                        },
                    };
                },
            };
            mockClient.workflow.list.mockReturnValue(asyncIterable);

            const result = await service.checkHealth();

            expect(result).toBe(true);
        });

        it('should return true when list returns empty iterator', async () => {
            const asyncIterable = {
                [Symbol.asyncIterator]: () => ({
                    next: async () => ({ value: undefined, done: true }),
                }),
            };
            mockClient.workflow.list.mockReturnValue(asyncIterable);

            const result = await service.checkHealth();

            expect(result).toBe(true);
        });

        it('should return false on error', async () => {
            mockClient.workflow.list.mockImplementation(() => {
                throw new Error('connection refused');
            });

            const result = await service.checkHealth();

            expect(result).toBe(false);
        });
    });

    describe('getWorkflowStatus', () => {
        it('should return workflow info when found', async () => {
            const now = new Date();
            const mockHandle = {
                describe: jest.fn().mockResolvedValue({
                    workflowId: 'index-gmail',
                    runId: 'run-1',
                    type: 'indexSourceWorkflow',
                    status: { code: 1 },
                    startTime: now,
                    closeTime: null,
                }),
            };
            mockClient.workflow.getHandle.mockReturnValue(mockHandle);

            const result = await service.getWorkflowStatus('index-gmail');

            expect(result).toEqual({
                workflowId: 'index-gmail',
                runId: 'run-1',
                type: 'indexSourceWorkflow',
                status: 'RUNNING',
                startTime: now.toISOString(),
                closeTime: undefined,
                executionTime: undefined,
            });
        });

        it('should return null when workflow not found', async () => {
            const mockHandle = {
                describe: jest.fn().mockRejectedValue(new Error('not found')),
            };
            mockClient.workflow.getHandle.mockReturnValue(mockHandle);

            const result = await service.getWorkflowStatus('index-unknown');

            expect(result).toBeNull();
        });

        it('should calculate executionTime when closeTime exists', async () => {
            const startTime = new Date('2024-01-01T00:00:00Z');
            const closeTime = new Date('2024-01-01T00:05:00Z');
            const mockHandle = {
                describe: jest.fn().mockResolvedValue({
                    workflowId: 'index-gmail',
                    runId: 'run-1',
                    type: 'indexSourceWorkflow',
                    status: { code: 2 },
                    startTime,
                    closeTime,
                }),
            };
            mockClient.workflow.getHandle.mockReturnValue(mockHandle);

            const result = await service.getWorkflowStatus('index-gmail');

            expect(result!.executionTime).toBe(300000); // 5 minutes in ms
            expect(result!.status).toBe('COMPLETED');
        });
    });

    describe('getSourceWorkflowInfo', () => {
        it('should return workflow info for a source with a completed workflow', async () => {
            const mockIter = {
                [Symbol.asyncIterator]: async function* () {
                    yield {
                        workflowId: 'index-gmail',
                        runId: 'run-1',
                        type: 'indexSourceWorkflow',
                        status: { code: 2 }, // COMPLETED
                        startTime: new Date('2026-02-14T10:00:00Z'),
                        closeTime: new Date('2026-02-14T10:05:00Z'),
                    };
                },
            };
            mockClient.workflow.list.mockReturnValue(mockIter);

            const result = await service.getSourceWorkflowInfo('gmail');
            expect(result).toEqual({
                workflowId: 'index-gmail',
                runId: 'run-1',
                type: 'indexSourceWorkflow',
                status: 'COMPLETED',
                startTime: '2026-02-14T10:00:00.000Z',
                closeTime: '2026-02-14T10:05:00.000Z',
                executionTime: 300000,
            });
        });

        it('should return null when no workflow exists for a source', async () => {
            const mockIter = {
                [Symbol.asyncIterator]: async function* () {
                    // yields nothing
                },
            };
            mockClient.workflow.list.mockReturnValue(mockIter);

            const result = await service.getSourceWorkflowInfo('gmail');
            expect(result).toBeNull();
        });
    });

    describe('cancelWorkflow', () => {
        it('should cancel the workflow via handle', async () => {
            const mockHandle = { cancel: jest.fn().mockResolvedValue(undefined) };
            mockClient.workflow.getHandle.mockReturnValue(mockHandle);

            await service.cancelWorkflow('index-gmail');

            expect(mockClient.workflow.getHandle).toHaveBeenCalledWith('index-gmail');
            expect(mockHandle.cancel).toHaveBeenCalled();
        });
    });

    describe('listRecentWorkflows', () => {
        it('should return workflows up to the limit', async () => {
            const startTime = new Date('2024-01-01T00:00:00Z');
            const workflows = [
                { workflowId: 'index-gmail', runId: 'r1', type: 'indexSourceWorkflow', status: { code: 2 }, startTime, closeTime: null },
                { workflowId: 'index-slack', runId: 'r2', type: 'indexSourceWorkflow', status: { code: 1 }, startTime, closeTime: null },
            ];

            const asyncIterable = {
                [Symbol.asyncIterator]: () => {
                    let idx = 0;
                    return {
                        next: async () => {
                            if (idx < workflows.length) {
                                return { value: workflows[idx++], done: false };
                            }
                            return { value: undefined, done: true };
                        },
                    };
                },
            };
            mockClient.workflow.list.mockReturnValue(asyncIterable);

            const result = await service.listRecentWorkflows(2);

            expect(result).toHaveLength(2);
            expect(result[0].workflowId).toBe('index-gmail');
            expect(result[0].status).toBe('COMPLETED');
            expect(result[1].status).toBe('RUNNING');
        });

        it('should respect limit parameter', async () => {
            const startTime = new Date();
            const workflows = Array.from({ length: 5 }, (_, i) => ({
                workflowId: `wf-${i}`,
                runId: `r-${i}`,
                type: 'indexSourceWorkflow',
                status: { code: 1 },
                startTime,
                closeTime: null,
            }));

            const asyncIterable = {
                [Symbol.asyncIterator]: () => {
                    let idx = 0;
                    return {
                        next: async () => {
                            if (idx < workflows.length) {
                                return { value: workflows[idx++], done: false };
                            }
                            return { value: undefined, done: true };
                        },
                    };
                },
            };
            mockClient.workflow.list.mockReturnValue(asyncIterable);

            const result = await service.listRecentWorkflows(3);

            expect(result).toHaveLength(3);
        });
    });
});
