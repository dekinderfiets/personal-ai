jest.mock('@temporalio/activity', () => ({
    Context: {
        current: () => ({
            heartbeat: jest.fn(),
        }),
    },
}));

import { ActivityDeps,createActivities } from './activities';

describe('createActivities', () => {
    let deps: {
        indexingService: any;
        settingsService: any;
        cursorService: any;
        analyticsService: any;
    };
    let activities: ReturnType<typeof createActivities>;

    beforeEach(() => {
        deps = {
            indexingService: {
                applySettingsToRequest: jest.fn(),
                extractConfigKey: jest.fn().mockReturnValue('config-key-1'),
                getConnector: jest.fn(),
                addRelevanceWeights: jest.fn(),
                processIndexingBatch: jest.fn(),
                updateCursorAfterBatch: jest.fn(),
                updateStatus: jest.fn(),
            },
            settingsService: {
                getSettings: jest.fn(),
            },
            cursorService: {
                getCursor: jest.fn(),
            },
            analyticsService: {
                recordRunStart: jest.fn(),
                recordRunComplete: jest.fn(),
            },
        };
        activities = createActivities(deps as unknown as ActivityDeps);
    });

    describe('loadSettings', () => {
        it('should merge settings when available', async () => {
            deps.settingsService.getSettings.mockResolvedValue({ projectKeys: ['PROJ'] });
            deps.cursorService.getCursor.mockResolvedValue(null);

            const result = await activities.loadSettings('jira', {});

            expect(deps.indexingService.applySettingsToRequest).toHaveBeenCalledWith(
                'jira',
                { projectKeys: ['PROJ'] },
                expect.any(Object),
            );
            expect(result.configKey).toBe('config-key-1');
            expect(result.configChanged).toBe(false);
        });

        it('should not apply settings when none exist', async () => {
            deps.settingsService.getSettings.mockResolvedValue(null);
            deps.cursorService.getCursor.mockResolvedValue(null);

            await activities.loadSettings('gmail', {});

            expect(deps.indexingService.applySettingsToRequest).not.toHaveBeenCalled();
        });

        it('should detect config change and set fullReindex', async () => {
            deps.settingsService.getSettings.mockResolvedValue(null);
            deps.cursorService.getCursor.mockResolvedValue({
                source: 'jira',
                lastSync: '2024-01-01',
                metadata: { configKey: 'old-config-key' },
            });
            deps.indexingService.extractConfigKey.mockReturnValue('new-config-key');

            const result = await activities.loadSettings('jira', {});

            expect(result.configChanged).toBe(true);
            expect(result.request.fullReindex).toBe(true);
        });

        it('should not trigger fullReindex if already requested', async () => {
            deps.settingsService.getSettings.mockResolvedValue(null);
            deps.cursorService.getCursor.mockResolvedValue({
                source: 'jira',
                lastSync: '2024-01-01',
                metadata: { configKey: 'old-key' },
            });
            deps.indexingService.extractConfigKey.mockReturnValue('new-key');

            const result = await activities.loadSettings('jira', { fullReindex: true });

            // fullReindex was already true, so configChanged should be false
            expect(result.configChanged).toBe(false);
        });

        it('should not trigger configChanged when configKey matches', async () => {
            deps.settingsService.getSettings.mockResolvedValue(null);
            deps.cursorService.getCursor.mockResolvedValue({
                source: 'jira',
                lastSync: '2024-01-01',
                metadata: { configKey: 'same-key' },
            });
            deps.indexingService.extractConfigKey.mockReturnValue('same-key');

            const result = await activities.loadSettings('jira', {});

            expect(result.configChanged).toBe(false);
            expect(result.request.fullReindex).toBeUndefined();
        });
    });

    describe('fetchBatch', () => {
        it('should call connector.fetch and serialize result', async () => {
            const mockConnector = {
                isConfigured: jest.fn().mockReturnValue(true),
                fetch: jest.fn().mockResolvedValue({
                    documents: [
                        { id: 'doc1', source: 'gmail', content: 'hello', metadata: { id: 'doc1', source: 'gmail' } },
                    ],
                    newCursor: { source: 'gmail', lastSync: '2024-01-01' },
                    hasMore: false,
                }),
            };
            deps.indexingService.getConnector.mockReturnValue(mockConnector);

            const result = await activities.fetchBatch('gmail', null, {});

            expect(mockConnector.fetch).toHaveBeenCalled();
            expect(result.documents).toHaveLength(1);
            expect(result.documents[0].id).toBe('doc1');
            expect(result.hasMore).toBe(false);
        });

        it('should throw error when connector is not configured', async () => {
            const mockConnector = {
                isConfigured: jest.fn().mockReturnValue(false),
            };
            deps.indexingService.getConnector.mockReturnValue(mockConnector);

            await expect(activities.fetchBatch('slack', null, {})).rejects.toThrow(
                'Connector for slack is not configured.',
            );
        });

        it('should include preChunked data when present', async () => {
            const mockConnector = {
                isConfigured: jest.fn().mockReturnValue(true),
                fetch: jest.fn().mockResolvedValue({
                    documents: [
                        {
                            id: 'doc1',
                            source: 'jira',
                            content: 'code',
                            metadata: {},
                            preChunked: { chunks: ['a', 'b'] },
                        },
                    ],
                    newCursor: {},
                    hasMore: false,
                }),
            };
            deps.indexingService.getConnector.mockReturnValue(mockConnector);

            const result = await activities.fetchBatch('jira', null, {});

            expect(result.documents[0]).toHaveProperty('preChunked');
        });
    });

    describe('processBatch', () => {
        it('should add relevance weights and process batch', async () => {
            const docs = [{ id: 'doc1', source: 'gmail', content: 'test', metadata: {} }];
            const docsWithWeights = [{ ...docs[0], metadata: { relevance_score: 0.5 } }];
            deps.indexingService.addRelevanceWeights.mockReturnValue(docsWithWeights);
            deps.indexingService.processIndexingBatch.mockResolvedValue(1);

            const result = await activities.processBatch('gmail', docs as any, false);

            expect(deps.indexingService.addRelevanceWeights).toHaveBeenCalledWith('gmail', docs);
            expect(deps.indexingService.processIndexingBatch).toHaveBeenCalledWith(
                'gmail',
                docsWithWeights,
                false,
            );
            expect(result).toEqual({ processed: 1 });
        });
    });

    describe('updateCursorAfterBatch', () => {
        it('should delegate to indexingService', async () => {
            const cursor = { source: 'gmail', lastSync: '2024-01-02' };
            deps.indexingService.updateCursorAfterBatch.mockResolvedValue(cursor);

            const result = await activities.updateCursorAfterBatch(
                'gmail',
                { newCursor: { lastSync: '2024-01-02' }, batchLastSync: '2024-01-02' },
                'config-key',
            );

            expect(deps.indexingService.updateCursorAfterBatch).toHaveBeenCalledWith(
                'gmail',
                expect.objectContaining({ newCursor: { lastSync: '2024-01-02' }, batchLastSync: '2024-01-02' }),
                'config-key',
            );
            expect(result).toEqual(cursor);
        });
    });

    describe('updateStatus', () => {
        it('should delegate to indexingService', async () => {
            deps.indexingService.updateStatus.mockResolvedValue(undefined);

            await activities.updateStatus('slack', { status: 'running' });

            expect(deps.indexingService.updateStatus).toHaveBeenCalledWith('slack', { status: 'running' });
        });
    });

    describe('recordRunStart', () => {
        it('should delegate to analyticsService', async () => {
            deps.analyticsService.recordRunStart.mockResolvedValue('run-123');

            const result = await activities.recordRunStart('jira');

            expect(result).toBe('run-123');
            expect(deps.analyticsService.recordRunStart).toHaveBeenCalledWith('jira');
        });
    });

    describe('recordRunComplete', () => {
        it('should delegate to analyticsService', async () => {
            deps.analyticsService.recordRunComplete.mockResolvedValue(undefined);

            const details = {
                documentsProcessed: 10,
                documentsNew: 5,
                documentsUpdated: 3,
                documentsSkipped: 2,
                startedAt: '2024-01-01T00:00:00Z',
            };

            await activities.recordRunComplete('jira', details);

            expect(deps.analyticsService.recordRunComplete).toHaveBeenCalledWith('jira', details);
        });

        it('should pass error details when present', async () => {
            deps.analyticsService.recordRunComplete.mockResolvedValue(undefined);

            const details = {
                documentsProcessed: 0,
                documentsNew: 0,
                documentsUpdated: 0,
                documentsSkipped: 0,
                startedAt: '2024-01-01T00:00:00Z',
                error: 'Connection failed',
            };

            await activities.recordRunComplete('jira', details);

            expect(deps.analyticsService.recordRunComplete).toHaveBeenCalledWith('jira', details);
        });
    });
});
