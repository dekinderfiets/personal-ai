import { HttpException } from '@nestjs/common';

import { IndexController } from './index.controller';

describe('IndexController', () => {
    let controller: IndexController;
    let mockIndexingService: any;
    let mockSettingsService: any;

    beforeEach(() => {
        mockIndexingService = {
            startIndexing: jest.fn(),
            indexAll: jest.fn(),
            getStatus: jest.fn(),
            getAllStatus: jest.fn(),
            getAllSourceInfo: jest.fn(),
            resetStatusOnly: jest.fn(),
            resetCursor: jest.fn(),
            resetAll: jest.fn(),
            deleteDocument: jest.fn(),
            getJiraProjects: jest.fn(),
            getSlackChannels: jest.fn(),
            getDriveFolders: jest.fn(),
            getConfluenceSpaces: jest.fn(),
            getCalendars: jest.fn(),
            getGmailLabels: jest.fn(),
        };
        mockSettingsService = {
            getSettings: jest.fn(),
            saveSettings: jest.fn(),
            isSourceEnabled: jest.fn().mockResolvedValue(true),
            getEnabledSources: jest.fn().mockResolvedValue(['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar']),
            setSourceEnabled: jest.fn().mockResolvedValue(undefined),
        };
        controller = new IndexController(mockIndexingService, mockSettingsService);
    });

    describe('triggerIndexing', () => {
        it('should throw 400 for invalid source', async () => {
            await expect(controller.triggerIndexing('invalid', {})).rejects.toThrow(HttpException);
        });

        it('should return started status when indexing starts', async () => {
            mockIndexingService.startIndexing.mockResolvedValue({
                started: true,
                message: 'Workflow started',
            });

            const result = await controller.triggerIndexing('gmail', {});

            expect(result).toEqual({
                status: 'started',
                source: 'gmail',
                message: 'Workflow started',
            });
            expect(mockIndexingService.startIndexing).toHaveBeenCalledWith('gmail', {});
        });

        it('should return already_running when indexing is in progress', async () => {
            mockIndexingService.startIndexing.mockResolvedValue({
                started: false,
                message: 'Already running',
            });

            const result = await controller.triggerIndexing('slack', { fullReindex: true });

            expect(result).toEqual({
                status: 'already_running',
                source: 'slack',
                message: 'Already running',
            });
        });

        it('should accept all valid sources', async () => {
            mockIndexingService.startIndexing.mockResolvedValue({ started: true, message: 'ok' });
            const sources = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'];

            for (const source of sources) {
                await controller.triggerIndexing(source, {});
                expect(mockIndexingService.startIndexing).toHaveBeenCalledWith(source, {});
            }
        });
    });

    describe('triggerAllIndexing', () => {
        it('should delegate to indexAll', async () => {
            const expected = { started: ['gmail', 'slack'], skipped: [] };
            mockIndexingService.indexAll.mockResolvedValue(expected);

            const result = await controller.triggerAllIndexing({});

            expect(result).toEqual(expected);
            expect(mockIndexingService.indexAll).toHaveBeenCalledWith({});
        });
    });

    describe('getSourceStatus', () => {
        it('should throw 400 for invalid source', async () => {
            await expect(controller.getSourceStatus('bad')).rejects.toThrow(HttpException);
        });

        it('should delegate to getStatus for valid source', async () => {
            const status = { source: 'jira', status: 'idle', lastSync: null, documentsIndexed: 0 };
            mockIndexingService.getStatus.mockResolvedValue(status);

            const result = await controller.getSourceStatus('jira');

            expect(result).toEqual(status);
        });
    });

    describe('getAllStatus', () => {
        it('should delegate to getAllStatus', async () => {
            const statuses = [{ source: 'gmail', status: 'idle' }];
            mockIndexingService.getAllStatus.mockResolvedValue(statuses);

            const result = await controller.getAllStatus();

            expect(result).toEqual(statuses);
        });
    });

    describe('GET /index/sources', () => {
        it('should return source info array', async () => {
            const mockSourceInfo = [
                { source: 'gmail', status: 'completed', documentsIndexed: 100, lastSync: '2026-02-14T10:00:00Z', lastError: null, lastErrorAt: null, workflowId: 'index-gmail', executionTime: 5000 },
            ];
            jest.spyOn(mockIndexingService, 'getAllSourceInfo').mockResolvedValue(mockSourceInfo as any);

            const result = await controller.getAllSourceInfo();
            expect(result).toEqual(mockSourceInfo);
        });
    });

    describe('resetStatus', () => {
        it('should throw 400 for invalid source', async () => {
            await expect(controller.resetStatus('nope')).rejects.toThrow(HttpException);
        });

        it('should reset status and return message', async () => {
            mockIndexingService.resetStatusOnly.mockResolvedValue(undefined);

            const result = await controller.resetStatus('drive');

            expect(result).toEqual({ message: 'Status reset for drive' });
            expect(mockIndexingService.resetStatusOnly).toHaveBeenCalledWith('drive');
        });
    });

    describe('deleteCollection', () => {
        it('should throw 400 for invalid source', async () => {
            await expect(controller.deleteCollection('nope')).rejects.toThrow(HttpException);
        });

        it('should reset cursor and return message', async () => {
            mockIndexingService.resetCursor.mockResolvedValue(undefined);

            const result = await controller.deleteCollection('confluence');

            expect(result).toEqual({ message: 'Collection reset for confluence' });
            expect(mockIndexingService.resetCursor).toHaveBeenCalledWith('confluence');
        });
    });

    describe('resetAll', () => {
        it('should delegate to resetAll', async () => {
            mockIndexingService.resetAll.mockResolvedValue(undefined);

            const result = await controller.resetAll();

            expect(result).toEqual({ message: 'Cursor and status reset for all sources' });
        });
    });

    describe('deleteDocument', () => {
        it('should throw 400 for invalid source', async () => {
            await expect(controller.deleteDocument('bad', 'doc1')).rejects.toThrow(HttpException);
        });

        it('should delete document and return message', async () => {
            mockIndexingService.deleteDocument.mockResolvedValue(undefined);

            const result = await controller.deleteDocument('jira', 'doc-123');

            expect(result).toEqual({ message: 'Document doc-123 deleted from jira' });
            expect(mockIndexingService.deleteDocument).toHaveBeenCalledWith('jira', 'doc-123');
        });
    });

    describe('settings endpoints', () => {
        it('getSettings should throw 400 for invalid source', async () => {
            await expect(controller.getSettings('nope')).rejects.toThrow(HttpException);
        });

        it('getSettings should delegate for valid source', async () => {
            const settings = { projectKeys: ['PROJ'] };
            mockSettingsService.getSettings.mockResolvedValue(settings);

            const result = await controller.getSettings('jira');

            expect(result).toEqual(settings);
        });

        it('saveSettings should throw 400 for invalid source', async () => {
            await expect(controller.saveSettings('nope', {} as any)).rejects.toThrow(HttpException);
        });

        it('saveSettings should delegate for valid source', async () => {
            mockSettingsService.saveSettings.mockResolvedValue(undefined);
            const settings = { channelIds: ['C1'] };

            const result = await controller.saveSettings('slack', settings as any);

            expect(result).toEqual({ message: 'Settings saved for slack' });
            expect(mockSettingsService.saveSettings).toHaveBeenCalledWith('slack', settings);
        });
    });

    describe('discovery endpoints', () => {
        it('discoverJiraProjects delegates correctly', async () => {
            mockIndexingService.getJiraProjects.mockResolvedValue([{ key: 'PROJ' }]);
            const result = await controller.discoverJiraProjects();
            expect(result).toEqual([{ key: 'PROJ' }]);
        });

        it('discoverSlackChannels delegates correctly', async () => {
            mockIndexingService.getSlackChannels.mockResolvedValue([{ id: 'C1' }]);
            const result = await controller.discoverSlackChannels();
            expect(result).toEqual([{ id: 'C1' }]);
        });

        it('discoverDriveFolders delegates with parentId', async () => {
            mockIndexingService.getDriveFolders.mockResolvedValue([]);
            await controller.discoverDriveFolders('parent123');
            expect(mockIndexingService.getDriveFolders).toHaveBeenCalledWith('parent123');
        });

        it('discoverConfluenceSpaces delegates correctly', async () => {
            mockIndexingService.getConfluenceSpaces.mockResolvedValue([{ key: 'SPACE' }]);
            const result = await controller.discoverConfluenceSpaces();
            expect(result).toEqual([{ key: 'SPACE' }]);
        });

        it('discoverCalendars delegates correctly', async () => {
            mockIndexingService.getCalendars.mockResolvedValue([{ id: 'cal1' }]);
            const result = await controller.discoverCalendars();
            expect(result).toEqual([{ id: 'cal1' }]);
        });

        it('discoverGmailLabels delegates correctly', async () => {
            mockIndexingService.getGmailLabels.mockResolvedValue([{ id: 'INBOX' }]);
            const result = await controller.discoverGmailLabels();
            expect(result).toEqual([{ id: 'INBOX' }]);
        });

        it('should throw 403 for disabled source on discovery', async () => {
            mockSettingsService.isSourceEnabled.mockResolvedValue(false);
            await expect(controller.discoverJiraProjects()).rejects.toThrow(HttpException);
            await expect(controller.discoverSlackChannels()).rejects.toThrow(HttpException);
            await expect(controller.discoverDriveFolders()).rejects.toThrow(HttpException);
            await expect(controller.discoverConfluenceSpaces()).rejects.toThrow(HttpException);
            await expect(controller.discoverCalendars()).rejects.toThrow(HttpException);
            await expect(controller.discoverGmailLabels()).rejects.toThrow(HttpException);
        });
    });

    describe('disabled source enforcement', () => {
        it('should reject indexing a disabled source with 403', async () => {
            mockSettingsService.isSourceEnabled.mockResolvedValue(false);

            await expect(controller.triggerIndexing('gmail', {})).rejects.toThrow(HttpException);
            try {
                await controller.triggerIndexing('gmail', {});
            } catch (e: any) {
                expect(e.getStatus()).toBe(403);
            }
            expect(mockIndexingService.startIndexing).not.toHaveBeenCalled();
        });

        it('should allow indexing an enabled source', async () => {
            mockSettingsService.isSourceEnabled.mockResolvedValue(true);
            mockIndexingService.startIndexing.mockResolvedValue({ started: true, message: 'ok' });

            const result = await controller.triggerIndexing('gmail', {});

            expect(result.status).toBe('started');
            expect(mockIndexingService.startIndexing).toHaveBeenCalled();
        });
    });

    describe('enabled-sources endpoints', () => {
        it('getEnabledSources should return enabled sources list', async () => {
            mockSettingsService.getEnabledSources.mockResolvedValue(['jira', 'gmail']);

            const result = await controller.getEnabledSources();

            expect(result).toEqual(['jira', 'gmail']);
        });

        it('setSourceEnabled should delegate to settingsService', async () => {
            const result = await controller.setSourceEnabled('calendar', { enabled: false });

            expect(mockSettingsService.setSourceEnabled).toHaveBeenCalledWith('calendar', false);
            expect(result).toEqual({ message: 'Source calendar disabled' });
        });

        it('setSourceEnabled should throw 400 for invalid source', async () => {
            await expect(controller.setSourceEnabled('bad', { enabled: true })).rejects.toThrow(HttpException);
        });

        it('setSourceEnabled should return correct message when enabling', async () => {
            const result = await controller.setSourceEnabled('slack', { enabled: true });

            expect(mockSettingsService.setSourceEnabled).toHaveBeenCalledWith('slack', true);
            expect(result).toEqual({ message: 'Source slack enabled' });
        });
    });
});
