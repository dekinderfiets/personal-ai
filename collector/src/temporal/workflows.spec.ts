// --- Mock @temporalio/workflow before any imports ---

const mockActivities: Record<string, jest.Mock> = {
    fetchBatch: jest.fn(),
    processBatch: jest.fn(),
};

const mockMgmtActivities: Record<string, jest.Mock> = {
    recordRunStart: jest.fn(),
    recordRunComplete: jest.fn(),
    updateStatus: jest.fn(),
    loadSettings: jest.fn(),
    updateCursorAfterBatch: jest.fn(),
};

let proxyActivitiesCallCount = 0;

const mockContinueAsNew = jest.fn();
const mockExecuteChild = jest.fn();
const mockSleep = jest.fn();

class MockContinueAsNew extends Error {
    name = 'ContinueAsNew';
}

jest.mock('@temporalio/workflow', () => ({
    proxyActivities: jest.fn(() => {
        proxyActivitiesCallCount++;
        return proxyActivitiesCallCount === 1 ? mockActivities : mockMgmtActivities;
    }),
    continueAsNew: mockContinueAsNew,
    executeChild: mockExecuteChild,
    sleep: mockSleep,
    ContinueAsNew: MockContinueAsNew,
    ParentClosePolicy: { ABANDON: 2 },
}));

import type {
    CollectAllInput,
    FetchBatchResult,
    IndexSourceInput,
    LoadSettingsResult,
} from './types';
import { collectAllWorkflow,indexSourceWorkflow } from './workflows';

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

function makeLoadSettingsResult(overrides: Partial<LoadSettingsResult> = {}): LoadSettingsResult {
    return {
        request: {},
        cursor: null,
        configKey: 'config-key',
        configChanged: false,
        ...overrides,
    };
}

function makeBatch(overrides: Partial<FetchBatchResult> = {}): FetchBatchResult {
    return {
        documents: [],
        newCursor: { lastSync: '2024-06-01' },
        hasMore: false,
        ...overrides,
    };
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe('Temporal Workflows', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Default stubs so tests only override what they care about
        mockMgmtActivities.recordRunStart.mockResolvedValue('run-id');
        mockMgmtActivities.updateStatus.mockResolvedValue(undefined);
        mockMgmtActivities.loadSettings.mockResolvedValue(makeLoadSettingsResult());
        mockMgmtActivities.updateCursorAfterBatch.mockResolvedValue(null);
        mockMgmtActivities.recordRunComplete.mockResolvedValue(undefined);

        mockActivities.fetchBatch.mockResolvedValue(makeBatch());
        mockActivities.processBatch.mockResolvedValue({ processed: 0 });

        mockSleep.mockResolvedValue(undefined);
        mockContinueAsNew.mockResolvedValue(undefined);
        mockExecuteChild.mockResolvedValue({
            source: 'gmail',
            totalProcessed: 10,
            status: 'completed',
            startedAt: '2024-01-01T00:00:00Z',
            completedAt: '2024-01-01T00:01:00Z',
        });
    });

    // ===========================================================
    // indexSourceWorkflow
    // ===========================================================
    describe('indexSourceWorkflow', () => {
        const baseInput: IndexSourceInput = {
            source: 'gmail',
            request: {},
        };

        // --- Fresh start (no continuation) ----------------------

        describe('fresh start (no continuation)', () => {
            it('should call recordRunStart and set status to running', async () => {
                await indexSourceWorkflow(baseInput);

                expect(mockMgmtActivities.recordRunStart).toHaveBeenCalledWith('gmail');
                expect(mockMgmtActivities.updateStatus).toHaveBeenCalledWith('gmail', {
                    status: 'running',
                    documentsIndexed: 0,
                    error: '',
                    lastError: undefined,
                });
            });

            it('should load settings for the source', async () => {
                await indexSourceWorkflow(baseInput);

                expect(mockMgmtActivities.loadSettings).toHaveBeenCalledWith('gmail', {});
            });

            it('should complete successfully with zero documents when batch is empty', async () => {
                const result = await indexSourceWorkflow(baseInput);

                expect(result.source).toBe('gmail');
                expect(result.totalProcessed).toBe(0);
                expect(result.status).toBe('completed');
                expect(result.startedAt).toBeDefined();
                expect(result.completedAt).toBeDefined();
            });

            it('should update status to completed and record run on success', async () => {
                await indexSourceWorkflow(baseInput);

                expect(mockMgmtActivities.updateStatus).toHaveBeenCalledWith(
                    'gmail',
                    expect.objectContaining({ status: 'completed' }),
                );
                expect(mockMgmtActivities.recordRunComplete).toHaveBeenCalledWith(
                    'gmail',
                    expect.objectContaining({
                        documentsProcessed: 0,
                        documentsNew: 0,
                        documentsUpdated: 0,
                        documentsSkipped: 0,
                    }),
                );
            });
        });

        // --- Cursor handling ------------------------------------

        describe('cursor handling', () => {
            it('should use null cursor on fullReindex without continuation', async () => {
                const settings = makeLoadSettingsResult({
                    request: { fullReindex: true },
                    cursor: { source: 'gmail', lastSync: '2024-01-01' },
                });
                mockMgmtActivities.loadSettings.mockResolvedValue(settings);

                await indexSourceWorkflow({
                    source: 'gmail',
                    request: { fullReindex: true },
                });

                expect(mockActivities.fetchBatch).toHaveBeenCalledWith('gmail', null, { fullReindex: true });
            });

            it('should use settings cursor for incremental indexing', async () => {
                const cursor = { source: 'gmail' as const, lastSync: '2024-06-01' };
                mockMgmtActivities.loadSettings.mockResolvedValue(
                    makeLoadSettingsResult({ cursor }),
                );

                await indexSourceWorkflow(baseInput);

                expect(mockActivities.fetchBatch).toHaveBeenCalledWith('gmail', cursor, {});
            });

            it('should use settings cursor on fullReindex continuation', async () => {
                const cursor = { source: 'gmail' as const, lastSync: '2024-06-01' };
                mockMgmtActivities.loadSettings.mockResolvedValue(
                    makeLoadSettingsResult({
                        request: { fullReindex: true },
                        cursor,
                    }),
                );

                await indexSourceWorkflow({
                    source: 'gmail',
                    request: { fullReindex: true },
                    _continuation: { totalProcessed: 100, startedAt: '2024-01-01T00:00:00Z' },
                });

                expect(mockActivities.fetchBatch).toHaveBeenCalledWith('gmail', cursor, { fullReindex: true });
            });
        });

        // --- Batch processing loop ------------------------------

        describe('batch processing loop', () => {
            it('should process documents when batch is non-empty', async () => {
                const docs = [{ id: 'doc1', source: 'gmail', content: 'hello', metadata: {} }];
                mockActivities.fetchBatch.mockResolvedValue(makeBatch({ documents: docs }));
                mockActivities.processBatch.mockResolvedValue({ processed: 1 });

                const result = await indexSourceWorkflow(baseInput);

                expect(mockActivities.processBatch).toHaveBeenCalledWith('gmail', docs, false);
                expect(result.totalProcessed).toBe(1);
            });

            it('should skip processBatch when batch has no documents', async () => {
                mockActivities.fetchBatch.mockResolvedValue(makeBatch({ documents: [] }));

                await indexSourceWorkflow(baseInput);

                expect(mockActivities.processBatch).not.toHaveBeenCalled();
            });

            it('should iterate through multiple batches and accumulate totalProcessed', async () => {
                mockActivities.fetchBatch
                    .mockResolvedValueOnce(
                        makeBatch({
                            documents: [{ id: 'd1', source: 'gmail', content: 'a', metadata: {} }],
                            hasMore: true,
                        }),
                    )
                    .mockResolvedValueOnce(
                        makeBatch({
                            documents: [{ id: 'd2', source: 'gmail', content: 'b', metadata: {} }],
                            hasMore: true,
                        }),
                    )
                    .mockResolvedValueOnce(
                        makeBatch({
                            documents: [{ id: 'd3', source: 'gmail', content: 'c', metadata: {} }],
                            hasMore: false,
                        }),
                    );
                mockActivities.processBatch.mockResolvedValue({ processed: 1 });

                const result = await indexSourceWorkflow(baseInput);

                expect(mockActivities.fetchBatch).toHaveBeenCalledTimes(3);
                expect(mockActivities.processBatch).toHaveBeenCalledTimes(3);
                expect(result.totalProcessed).toBe(3);
            });

            it('should update cursor after each batch', async () => {
                const updatedCursor = { source: 'gmail' as const, lastSync: '2024-06-02' };
                mockMgmtActivities.updateCursorAfterBatch.mockResolvedValue(updatedCursor);
                mockActivities.fetchBatch
                    .mockResolvedValueOnce(makeBatch({ hasMore: true }))
                    .mockResolvedValueOnce(makeBatch({ hasMore: false }));

                await indexSourceWorkflow(baseInput);

                expect(mockMgmtActivities.updateCursorAfterBatch).toHaveBeenCalledTimes(2);
                // Second fetchBatch should use the cursor returned by updateCursorAfterBatch
                expect(mockActivities.fetchBatch).toHaveBeenNthCalledWith(
                    2,
                    'gmail',
                    updatedCursor,
                    {},
                );
            });

            it('should update status with documentsIndexed after processing a batch', async () => {
                const docs = [{ id: 'd1', source: 'gmail', content: 'x', metadata: {} }];
                mockActivities.fetchBatch.mockResolvedValue(makeBatch({ documents: docs }));
                mockActivities.processBatch.mockResolvedValue({ processed: 5 });

                await indexSourceWorkflow(baseInput);

                expect(mockMgmtActivities.updateStatus).toHaveBeenCalledWith('gmail', {
                    documentsIndexed: 5,
                });
            });
        });

        // --- Adaptive delay -------------------------------------

        describe('adaptive delay', () => {
            it('should use 500ms delay between batches normally', async () => {
                mockActivities.fetchBatch
                    .mockResolvedValueOnce(
                        makeBatch({
                            documents: [{ id: 'd1', source: 'gmail', content: 'a', metadata: {} }],
                            hasMore: true,
                        }),
                    )
                    .mockResolvedValueOnce(makeBatch({ hasMore: false }));
                // processed = 3, 3 % 500 !== 0 => 500ms
                mockActivities.processBatch.mockResolvedValue({ processed: 3 });

                await indexSourceWorkflow(baseInput);

                expect(mockSleep).toHaveBeenCalledWith(500);
            });

            it('should use 2000ms delay when totalProcessed is a multiple of 500', async () => {
                mockActivities.fetchBatch
                    .mockResolvedValueOnce(
                        makeBatch({
                            documents: [{ id: 'd1', source: 'gmail', content: 'a', metadata: {} }],
                            hasMore: true,
                        }),
                    )
                    .mockResolvedValueOnce(makeBatch({ hasMore: false }));
                // processed = 500, 500 % 500 === 0 => 2000ms
                mockActivities.processBatch.mockResolvedValue({ processed: 500 });

                await indexSourceWorkflow(baseInput);

                expect(mockSleep).toHaveBeenCalledWith(2000);
            });

            it('should not sleep after the final batch', async () => {
                mockActivities.fetchBatch.mockResolvedValue(makeBatch({ hasMore: false }));

                await indexSourceWorkflow(baseInput);

                expect(mockSleep).not.toHaveBeenCalled();
            });
        });

        // --- continueAsNew --------------------------------------

        describe('continueAsNew', () => {
            it('should call continueAsNew when batchCount reaches MAX_BATCHES_PER_EXECUTION', async () => {
                // 50 batches with hasMore=true, then the 51st should not be reached
                // because continueAsNew is called at batch 50
                let callCount = 0;
                mockActivities.fetchBatch.mockImplementation(() => {
                    callCount++;
                    return Promise.resolve(makeBatch({ hasMore: true }));
                });

                // Make continueAsNew throw ContinueAsNew to stop the loop
                mockContinueAsNew.mockImplementation(() => {
                    throw new MockContinueAsNew();
                });

                await expect(indexSourceWorkflow(baseInput)).rejects.toThrow(MockContinueAsNew);

                expect(callCount).toBe(50);
                expect(mockContinueAsNew).toHaveBeenCalledWith({
                    source: 'gmail',
                    request: {},
                    _continuation: expect.objectContaining({
                        totalProcessed: 0,
                        startedAt: expect.any(String),
                    }),
                });
            });

            it('should pass accumulated totalProcessed in continuation', async () => {
                let callCount = 0;
                mockActivities.fetchBatch.mockImplementation(() => {
                    callCount++;
                    return Promise.resolve(
                        makeBatch({
                            documents: [{ id: `d${callCount}`, source: 'gmail', content: 'x', metadata: {} }],
                            hasMore: true,
                        }),
                    );
                });
                mockActivities.processBatch.mockResolvedValue({ processed: 2 });

                mockContinueAsNew.mockImplementation(() => {
                    throw new MockContinueAsNew();
                });

                await expect(indexSourceWorkflow(baseInput)).rejects.toThrow(MockContinueAsNew);

                expect(mockContinueAsNew).toHaveBeenCalledWith(
                    expect.objectContaining({
                        _continuation: expect.objectContaining({
                            totalProcessed: 100, // 50 batches * 2 processed each
                        }),
                    }),
                );
            });

            it('should re-throw ContinueAsNew errors without catching them', async () => {
                mockActivities.fetchBatch.mockResolvedValue(makeBatch({ hasMore: true }));
                mockContinueAsNew.mockImplementation(() => {
                    throw new MockContinueAsNew();
                });

                // Let 50 batches go by so continueAsNew is triggered
                let callCount = 0;
                mockActivities.fetchBatch.mockImplementation(() => {
                    callCount++;
                    return Promise.resolve(makeBatch({ hasMore: true }));
                });

                await expect(indexSourceWorkflow(baseInput)).rejects.toThrow(MockContinueAsNew);

                // Should NOT record error status when ContinueAsNew is thrown
                const statusCalls = mockMgmtActivities.updateStatus.mock.calls;
                const errorStatusCalls = statusCalls.filter(
                    (call: any[]) => call[1]?.status === 'error',
                );
                expect(errorStatusCalls).toHaveLength(0);
            });
        });

        // --- Continuation state ---------------------------------

        describe('continuation state', () => {
            it('should skip recordRunStart on continuation', async () => {
                await indexSourceWorkflow({
                    ...baseInput,
                    _continuation: { totalProcessed: 50, startedAt: '2024-01-01T00:00:00Z' },
                });

                expect(mockMgmtActivities.recordRunStart).not.toHaveBeenCalled();
            });

            it('should skip initial updateStatus running on continuation', async () => {
                await indexSourceWorkflow({
                    ...baseInput,
                    _continuation: { totalProcessed: 50, startedAt: '2024-01-01T00:00:00Z' },
                });

                const runningCalls = mockMgmtActivities.updateStatus.mock.calls.filter(
                    (call: any[]) => call[1]?.status === 'running',
                );
                expect(runningCalls).toHaveLength(0);
            });

            it('should preserve totalProcessed from continuation', async () => {
                const docs = [{ id: 'd1', source: 'gmail', content: 'x', metadata: {} }];
                mockActivities.fetchBatch.mockResolvedValue(makeBatch({ documents: docs }));
                mockActivities.processBatch.mockResolvedValue({ processed: 5 });

                const result = await indexSourceWorkflow({
                    ...baseInput,
                    _continuation: { totalProcessed: 50, startedAt: '2024-01-01T00:00:00Z' },
                });

                expect(result.totalProcessed).toBe(55); // 50 + 5
            });

            it('should preserve startedAt from continuation', async () => {
                const result = await indexSourceWorkflow({
                    ...baseInput,
                    _continuation: { totalProcessed: 0, startedAt: '2024-01-01T00:00:00Z' },
                });

                expect(result.startedAt).toBe('2024-01-01T00:00:00Z');
            });
        });

        // --- Error handling -------------------------------------

        describe('error handling', () => {
            it('should update status to error on failure', async () => {
                mockActivities.fetchBatch.mockRejectedValue(new Error('API timeout'));

                const result = await indexSourceWorkflow(baseInput);

                expect(result.status).toBe('error');
                expect(result.error).toBe('API timeout');
                expect(mockMgmtActivities.updateStatus).toHaveBeenCalledWith(
                    'gmail',
                    expect.objectContaining({
                        status: 'error',
                        error: 'API timeout',
                        lastError: 'API timeout',
                    }),
                );
            });

            it('should record run complete with error details', async () => {
                mockActivities.fetchBatch.mockRejectedValue(new Error('Network failure'));

                await indexSourceWorkflow(baseInput);

                expect(mockMgmtActivities.recordRunComplete).toHaveBeenCalledWith(
                    'gmail',
                    expect.objectContaining({
                        error: 'Network failure',
                        documentsNew: 0,
                    }),
                );
            });

            it('should return error result with completedAt timestamp', async () => {
                mockActivities.fetchBatch.mockRejectedValue(new Error('Boom'));

                const result = await indexSourceWorkflow(baseInput);

                expect(result.completedAt).toBeDefined();
                expect(result.source).toBe('gmail');
            });

            it('should include partial totalProcessed on mid-run error', async () => {
                mockActivities.fetchBatch
                    .mockResolvedValueOnce(
                        makeBatch({
                            documents: [{ id: 'd1', source: 'gmail', content: 'a', metadata: {} }],
                            hasMore: true,
                        }),
                    )
                    .mockRejectedValueOnce(new Error('Rate limit'));
                mockActivities.processBatch.mockResolvedValue({ processed: 3 });

                const result = await indexSourceWorkflow(baseInput);

                expect(result.status).toBe('error');
                expect(result.totalProcessed).toBe(3);
            });
        });
    });

    // ===========================================================
    // collectAllWorkflow
    // ===========================================================
    describe('collectAllWorkflow', () => {
        const baseInput: CollectAllInput = { request: {} };

        describe('source selection', () => {
            it('should default to ALL_SOURCES when sources is undefined', async () => {
                await collectAllWorkflow(baseInput);

                const allSources = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'];
                expect(mockExecuteChild).toHaveBeenCalledTimes(allSources.length);
                for (const source of allSources) {
                    expect(mockExecuteChild).toHaveBeenCalledWith(
                        indexSourceWorkflow,
                        expect.objectContaining({
                            workflowId: `index-${source}`,
                            args: [{ source, request: {} }],
                            parentClosePolicy: 2, // ParentClosePolicy.ABANDON
                        }),
                    );
                }
            });

            it('should use provided sources when specified', async () => {
                await collectAllWorkflow({
                    request: {},
                    sources: ['gmail', 'slack'],
                });

                expect(mockExecuteChild).toHaveBeenCalledTimes(2);
                expect(mockExecuteChild).toHaveBeenCalledWith(
                    indexSourceWorkflow,
                    expect.objectContaining({ workflowId: 'index-gmail' }),
                );
                expect(mockExecuteChild).toHaveBeenCalledWith(
                    indexSourceWorkflow,
                    expect.objectContaining({ workflowId: 'index-slack' }),
                );
            });
        });

        describe('staggered execution', () => {
            it('should not sleep before the first child workflow', async () => {
                await collectAllWorkflow({
                    request: {},
                    sources: ['gmail'],
                });

                expect(mockSleep).not.toHaveBeenCalled();
            });

            it('should sleep 1000ms between child workflow starts', async () => {
                await collectAllWorkflow({
                    request: {},
                    sources: ['gmail', 'slack', 'jira'],
                });

                // Should sleep between each pair (after 1st, after 2nd)
                expect(mockSleep).toHaveBeenCalledTimes(2);
                expect(mockSleep).toHaveBeenCalledWith(1000);
            });
        });

        describe('child workflow results', () => {
            it('should collect results from all successful child workflows', async () => {
                const gmailResult = {
                    source: 'gmail',
                    totalProcessed: 10,
                    status: 'completed' as const,
                    startedAt: '2024-01-01T00:00:00Z',
                    completedAt: '2024-01-01T00:01:00Z',
                };
                const slackResult = {
                    source: 'slack',
                    totalProcessed: 5,
                    status: 'completed' as const,
                    startedAt: '2024-01-01T00:00:00Z',
                    completedAt: '2024-01-01T00:01:00Z',
                };

                mockExecuteChild
                    .mockResolvedValueOnce(gmailResult)
                    .mockResolvedValueOnce(slackResult);

                const result = await collectAllWorkflow({
                    request: {},
                    sources: ['gmail', 'slack'],
                });

                expect(result.results).toHaveLength(2);
                expect(result.started).toEqual(['gmail', 'slack']);
                expect(result.skipped).toEqual([]);
            });

            it('should add source to skipped on WorkflowExecutionAlreadyStartedError', async () => {
                const alreadyStartedError = new Error('Already started');
                alreadyStartedError.name = 'WorkflowExecutionAlreadyStartedError';

                mockExecuteChild
                    .mockRejectedValueOnce(alreadyStartedError)
                    .mockResolvedValueOnce({
                        source: 'slack',
                        totalProcessed: 5,
                        status: 'completed',
                        startedAt: '2024-01-01T00:00:00Z',
                        completedAt: '2024-01-01T00:01:00Z',
                    });

                const result = await collectAllWorkflow({
                    request: {},
                    sources: ['gmail', 'slack'],
                });

                expect(result.skipped).toEqual(['gmail']);
                expect(result.started).toEqual(['slack']);
                // Skipped sources should not produce results
                expect(result.results).toHaveLength(1);
                expect(result.results[0].source).toBe('slack');
            });

            it('should add source to started with error result on non-AlreadyStarted errors', async () => {
                const otherError = new Error('Unknown failure');

                mockExecuteChild
                    .mockRejectedValueOnce(otherError)
                    .mockResolvedValueOnce({
                        source: 'slack',
                        totalProcessed: 5,
                        status: 'completed',
                        startedAt: '2024-01-01T00:00:00Z',
                        completedAt: '2024-01-01T00:01:00Z',
                    });

                const result = await collectAllWorkflow({
                    request: {},
                    sources: ['gmail', 'slack'],
                });

                expect(result.started).toEqual(expect.arrayContaining(['gmail', 'slack']));
                expect(result.skipped).toEqual([]);
                expect(result.results).toHaveLength(2);

                const errorResult = result.results.find((r) => r.source === 'gmail');
                expect(errorResult).toBeDefined();
                expect(errorResult!.status).toBe('error');
                expect(errorResult!.error).toBe('Unknown failure');
                expect(errorResult!.totalProcessed).toBe(0);
            });

            it('should handle mix of success, skipped, and error', async () => {
                const alreadyStartedError = new Error('Already running');
                alreadyStartedError.name = 'WorkflowExecutionAlreadyStartedError';

                mockExecuteChild
                    .mockResolvedValueOnce({
                        source: 'gmail',
                        totalProcessed: 10,
                        status: 'completed',
                        startedAt: '2024-01-01T00:00:00Z',
                        completedAt: '2024-01-01T00:01:00Z',
                    })
                    .mockRejectedValueOnce(alreadyStartedError)
                    .mockRejectedValueOnce(new Error('Connection lost'));

                const result = await collectAllWorkflow({
                    request: {},
                    sources: ['gmail', 'slack', 'jira'],
                });

                expect(result.started).toEqual(expect.arrayContaining(['gmail', 'jira']));
                expect(result.skipped).toEqual(['slack']);
                expect(result.results).toHaveLength(2); // gmail success + jira error

                const jiraResult = result.results.find((r) => r.source === 'jira');
                expect(jiraResult!.status).toBe('error');
            });

            it('should return empty arrays when no sources are provided', async () => {
                const result = await collectAllWorkflow({
                    request: {},
                    sources: [],
                });

                expect(result.results).toEqual([]);
                expect(result.started).toEqual([]);
                expect(result.skipped).toEqual([]);
                expect(mockExecuteChild).not.toHaveBeenCalled();
            });
        });

        describe('executeChild configuration', () => {
            it('should use ParentClosePolicy.ABANDON for child workflows', async () => {
                await collectAllWorkflow({
                    request: {},
                    sources: ['gmail'],
                });

                expect(mockExecuteChild).toHaveBeenCalledWith(
                    indexSourceWorkflow,
                    expect.objectContaining({
                        parentClosePolicy: 2, // ParentClosePolicy.ABANDON
                    }),
                );
            });

            it('should pass request to child workflows', async () => {
                const request = { fullReindex: true, projectKeys: ['PROJ'] };

                await collectAllWorkflow({
                    request,
                    sources: ['jira'],
                });

                expect(mockExecuteChild).toHaveBeenCalledWith(
                    indexSourceWorkflow,
                    expect.objectContaining({
                        args: [{ source: 'jira', request }],
                    }),
                );
            });
        });
    });
});
