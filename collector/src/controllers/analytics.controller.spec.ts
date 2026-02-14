import { HttpException } from '@nestjs/common';

import { AnalyticsController } from './analytics.controller';

describe('AnalyticsController', () => {
    let controller: AnalyticsController;
    let mockAnalyticsService: any;
    let mockHealthService: any;
    let mockSettingsService: any;

    beforeEach(() => {
        mockAnalyticsService = {
            getSystemStats: jest.fn(),
            getSourceStats: jest.fn(),
            getAllRecentRuns: jest.fn(),
            getRecentRuns: jest.fn(),
            getDailyStats: jest.fn(),
        };
        mockHealthService = {
            checkAllHealth: jest.fn(),
            checkHealth: jest.fn(),
        };
        mockSettingsService = {
            getSettings: jest.fn(),
            saveSettings: jest.fn(),
        };
        controller = new AnalyticsController(mockAnalyticsService, mockHealthService, mockSettingsService);
    });

    describe('getSystemStats', () => {
        it('should delegate with valid sources list', async () => {
            const stats = { totalDocuments: 100 };
            mockAnalyticsService.getSystemStats.mockResolvedValue(stats);

            const result = await controller.getSystemStats();

            expect(result).toEqual(stats);
            expect(mockAnalyticsService.getSystemStats).toHaveBeenCalledWith(
                ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar', 'github'],
            );
        });
    });

    describe('getSourceStats', () => {
        it('should throw 400 for invalid source', async () => {
            await expect(controller.getSourceStats('bad')).rejects.toThrow(HttpException);
        });

        it('should delegate for valid source', async () => {
            const stats = { totalRuns: 5 };
            mockAnalyticsService.getSourceStats.mockResolvedValue(stats);

            const result = await controller.getSourceStats('jira');

            expect(result).toEqual(stats);
        });
    });

    describe('getAllRecentRuns', () => {
        it('should use default limit of 20', async () => {
            mockAnalyticsService.getAllRecentRuns.mockResolvedValue([]);

            await controller.getAllRecentRuns(undefined);

            expect(mockAnalyticsService.getAllRecentRuns).toHaveBeenCalledWith(
                expect.any(Array),
                20,
            );
        });

        it('should parse limit string', async () => {
            mockAnalyticsService.getAllRecentRuns.mockResolvedValue([]);

            await controller.getAllRecentRuns('10');

            expect(mockAnalyticsService.getAllRecentRuns).toHaveBeenCalledWith(
                expect.any(Array),
                10,
            );
        });
    });

    describe('getRecentRuns', () => {
        it('should throw 400 for invalid source', async () => {
            await expect(controller.getRecentRuns('bad', undefined)).rejects.toThrow(HttpException);
        });

        it('should delegate with parsed limit', async () => {
            mockAnalyticsService.getRecentRuns.mockResolvedValue([]);

            await controller.getRecentRuns('gmail', '5');

            expect(mockAnalyticsService.getRecentRuns).toHaveBeenCalledWith('gmail', 5);
        });

        it('should use default limit of 20', async () => {
            mockAnalyticsService.getRecentRuns.mockResolvedValue([]);

            await controller.getRecentRuns('gmail', undefined);

            expect(mockAnalyticsService.getRecentRuns).toHaveBeenCalledWith('gmail', 20);
        });
    });

    describe('getDailyStats', () => {
        it('should throw 400 for invalid source', async () => {
            await expect(controller.getDailyStats('bad', undefined)).rejects.toThrow(HttpException);
        });

        it('should use default of 30 days', async () => {
            mockAnalyticsService.getDailyStats.mockResolvedValue([]);

            await controller.getDailyStats('slack', undefined);

            expect(mockAnalyticsService.getDailyStats).toHaveBeenCalledWith('slack', 30);
        });

        it('should parse days param', async () => {
            mockAnalyticsService.getDailyStats.mockResolvedValue([]);

            await controller.getDailyStats('slack', '7');

            expect(mockAnalyticsService.getDailyStats).toHaveBeenCalledWith('slack', 7);
        });
    });

    describe('health endpoints', () => {
        it('getAllHealth should delegate to healthService', async () => {
            const health = [{ source: 'gmail', healthy: true }];
            mockHealthService.checkAllHealth.mockResolvedValue(health);

            const result = await controller.getAllHealth();

            expect(result).toEqual(health);
        });

        it('getSourceHealth should throw 400 for invalid source', async () => {
            await expect(controller.getSourceHealth('nope')).rejects.toThrow(HttpException);
        });

        it('getSourceHealth should delegate for valid source', async () => {
            const health = { source: 'drive', healthy: true };
            mockHealthService.checkHealth.mockResolvedValue(health);

            const result = await controller.getSourceHealth('drive');

            expect(result).toEqual(health);
        });
    });

    describe('exportConfig', () => {
        it('should set correct headers and send JSON', async () => {
            mockSettingsService.getSettings.mockResolvedValue({ projectKeys: ['PROJ'] });

            const mockRes = {
                setHeader: jest.fn(),
                send: jest.fn(),
            };

            await controller.exportConfig(mockRes as any);

            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                expect.stringContaining('attachment; filename=collector-config-'),
            );

            const sentBody = JSON.parse(mockRes.send.mock.calls[0][0]);
            expect(sentBody.version).toBe(1);
            expect(sentBody.exportedAt).toBeDefined();
            expect(sentBody.settings).toBeDefined();
            expect(Object.keys(sentBody.settings)).toHaveLength(7);
        });
    });

    describe('importConfig', () => {
        it('should throw 400 for missing settings object', async () => {
            await expect(controller.importConfig({} as any)).rejects.toThrow(HttpException);
        });

        it('should throw 400 for non-object settings', async () => {
            await expect(controller.importConfig({ settings: 'bad' } as any)).rejects.toThrow(HttpException);
        });

        it('should skip invalid sources', async () => {
            const result = await controller.importConfig({
                settings: { badSource: { key: 'val' } },
            });

            expect(result.skipped).toContain('badSource');
            expect(result.imported).toHaveLength(0);
        });

        it('should import valid sources and skip invalid settings', async () => {
            mockSettingsService.saveSettings.mockResolvedValue(undefined);

            const result = await controller.importConfig({
                settings: {
                    gmail: { domains: ['example.com'], senders: [], labels: [] },
                    invalidSource: { key: 'val' },
                    slack: null as any,
                },
            });

            expect(result.imported).toContain('gmail');
            expect(result.skipped).toContain('invalidSource');
            expect(result.skipped).toContain('slack');
            expect(mockSettingsService.saveSettings).toHaveBeenCalledTimes(1);
        });
    });
});
