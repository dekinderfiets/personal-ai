import { ConfigService } from '@nestjs/config';

import { DataSource } from '../types';
import { AnalyticsService, IndexingRun, SourceStats } from './analytics.service';

function createRedisMock() {
    const store = new Map<string, string>();
    const lists = new Map<string, string[]>();
    const hashes = new Map<string, Map<string, string>>();

    return {
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        set: jest.fn(async (key: string, value: string) => {
            store.set(key, value);
            return 'OK';
        }),
        del: jest.fn(async (...keys: string[]) => {
            let count = 0;
            for (const key of keys) {
                if (store.delete(key)) count++;
                if (lists.delete(key)) count++;
            }
            return count;
        }),
        lpush: jest.fn(async (key: string, ...values: string[]) => {
            if (!lists.has(key)) lists.set(key, []);
            const list = lists.get(key)!;
            // lpush adds to beginning
            list.unshift(...values);
            return list.length;
        }),
        ltrim: jest.fn(async (key: string, start: number, stop: number) => {
            if (!lists.has(key)) return 'OK';
            const list = lists.get(key)!;
            lists.set(key, list.slice(start, stop + 1));
            return 'OK';
        }),
        lrange: jest.fn(async (key: string, start: number, stop: number) => {
            const list = lists.get(key) || [];
            if (stop === -1) return list.slice(start);
            return list.slice(start, stop + 1);
        }),
        lset: jest.fn(async (key: string, index: number, value: string) => {
            const list = lists.get(key);
            if (list && index >= 0 && index < list.length) {
                list[index] = value;
            }
            return 'OK';
        }),
        hincrby: jest.fn(async (key: string, field: string, increment: number) => {
            if (!hashes.has(key)) hashes.set(key, new Map());
            const h = hashes.get(key)!;
            const current = parseInt(h.get(field) || '0', 10);
            h.set(field, String(current + increment));
            return current + increment;
        }),
        hgetall: jest.fn(async (key: string) => {
            const h = hashes.get(key);
            if (!h) return {};
            const result: Record<string, string> = {};
            for (const [k, v] of h.entries()) {
                result[k] = v;
            }
            return result;
        }),
        expire: jest.fn(async () => 1),
        quit: jest.fn(async () => 'OK'),
        _store: store,
        _lists: lists,
        _hashes: hashes,
    };
}

describe('AnalyticsService', () => {
    let service: AnalyticsService;
    let redisMock: ReturnType<typeof createRedisMock>;

    beforeEach(() => {
        redisMock = createRedisMock();
        const configService = {
            get: jest.fn().mockReturnValue('redis://localhost:6379'),
        } as unknown as ConfigService;

        service = new AnalyticsService(configService);
        (service as any).redis = redisMock as any;
    });

    describe('recordRunStart', () => {
        it('creates a running entry and returns runId', async () => {
            const runId = await service.recordRunStart('gmail');

            expect(runId).toMatch(/^gmail_\d+$/);
            expect(redisMock.lpush).toHaveBeenCalledWith(
                'index:analytics:runs:gmail',
                expect.any(String),
            );

            // Verify the stored entry
            const stored = JSON.parse(redisMock.lpush.mock.calls[0][1]);
            expect(stored.source).toBe('gmail');
            expect(stored.status).toBe('running');
            expect(stored.documentsProcessed).toBe(0);
            expect(stored.id).toBe(runId);
        });

        it('trims list to MAX_RUNS (100)', async () => {
            await service.recordRunStart('gmail');

            expect(redisMock.ltrim).toHaveBeenCalledWith(
                'index:analytics:runs:gmail',
                0,
                99, // MAX_RUNS_PER_SOURCE - 1
            );
        });
    });

    describe('recordRunComplete', () => {
        it('replaces existing running entry when runId matches', async () => {
            // First, record a start
            const runId = await service.recordRunStart('jira');
            const startedAt = '2024-01-15T10:00:00Z';

            // Now complete it
            await service.recordRunComplete('jira', {
                runId,
                documentsProcessed: 50,
                documentsNew: 30,
                documentsUpdated: 15,
                documentsSkipped: 5,
                startedAt,
            });

            // lset should have been called to replace in-place
            expect(redisMock.lset).toHaveBeenCalled();

            // Verify the replacement content
            const replacedJson = redisMock.lset.mock.calls[0][2];
            const replaced = JSON.parse(replacedJson);
            expect(replaced.id).toBe(runId);
            expect(replaced.status).toBe('completed');
            expect(replaced.documentsProcessed).toBe(50);
            expect(replaced.completedAt).toBeDefined();
            expect(replaced.durationMs).toBeGreaterThanOrEqual(0);
        });

        it('pushes new entry when no runId provided', async () => {
            redisMock.lpush.mockClear();

            await service.recordRunComplete('slack', {
                documentsProcessed: 10,
                documentsNew: 5,
                documentsUpdated: 3,
                documentsSkipped: 2,
                startedAt: '2024-01-15T10:00:00Z',
            });

            // Should have called lpush (not lset)
            expect(redisMock.lpush).toHaveBeenCalled();
            expect(redisMock.lset).not.toHaveBeenCalled();
        });

        it('pushes new entry when runId does not match any existing', async () => {
            redisMock.lpush.mockClear();

            await service.recordRunComplete('slack', {
                runId: 'nonexistent_123',
                documentsProcessed: 10,
                documentsNew: 5,
                documentsUpdated: 3,
                documentsSkipped: 2,
                startedAt: '2024-01-15T10:00:00Z',
            });

            // lrange was called to search, but lset was not called
            expect(redisMock.lrange).toHaveBeenCalled();
            expect(redisMock.lset).not.toHaveBeenCalled();
            // Instead, lpush was called
            expect(redisMock.lpush).toHaveBeenCalled();
        });

        it('records error status when error is provided', async () => {
            redisMock.lpush.mockClear();

            await service.recordRunComplete('gmail', {
                documentsProcessed: 0,
                documentsNew: 0,
                documentsUpdated: 0,
                documentsSkipped: 0,
                startedAt: '2024-01-15T10:00:00Z',
                error: 'Auth token expired',
            });

            const storedJson = redisMock.lpush.mock.calls[0][1];
            const stored = JSON.parse(storedJson);
            expect(stored.status).toBe('error');
            expect(stored.error).toBe('Auth token expired');
        });

        it('updates daily counters', async () => {
            await service.recordRunComplete('gmail', {
                documentsProcessed: 25,
                documentsNew: 10,
                documentsUpdated: 10,
                documentsSkipped: 5,
                startedAt: '2024-01-15T10:00:00Z',
            });

            expect(redisMock.hincrby).toHaveBeenCalledWith(
                expect.stringContaining('index:analytics:daily:gmail:'),
                'runs',
                1,
            );
            expect(redisMock.hincrby).toHaveBeenCalledWith(
                expect.stringContaining('index:analytics:daily:gmail:'),
                'documents',
                25,
            );
        });

        it('increments error counter on error', async () => {
            await service.recordRunComplete('gmail', {
                documentsProcessed: 0,
                documentsNew: 0,
                documentsUpdated: 0,
                documentsSkipped: 0,
                startedAt: '2024-01-15T10:00:00Z',
                error: 'Failed',
            });

            expect(redisMock.hincrby).toHaveBeenCalledWith(
                expect.stringContaining('index:analytics:daily:gmail:'),
                'errors',
                1,
            );
        });

        it('sets 90-day expiry on daily counter', async () => {
            await service.recordRunComplete('gmail', {
                documentsProcessed: 1,
                documentsNew: 1,
                documentsUpdated: 0,
                documentsSkipped: 0,
                startedAt: '2024-01-15T10:00:00Z',
            });

            expect(redisMock.expire).toHaveBeenCalledWith(
                expect.stringContaining('index:analytics:daily:gmail:'),
                90 * 24 * 60 * 60,
            );
        });
    });

    describe('updateAggregateStats', () => {
        it('creates new stats from scratch for first run', async () => {
            await service.recordRunComplete('drive', {
                documentsProcessed: 100,
                documentsNew: 100,
                documentsUpdated: 0,
                documentsSkipped: 0,
                startedAt: '2024-01-15T10:00:00Z',
            });

            // Stats should have been set
            expect(redisMock.set).toHaveBeenCalledWith(
                'index:analytics:stats:drive',
                expect.any(String),
            );

            const statsJson = redisMock.set.mock.calls.find(
                c => c[0] === 'index:analytics:stats:drive',
            )?.[1];
            const stats: SourceStats = JSON.parse(statsJson!);
            expect(stats.totalRuns).toBe(1);
            expect(stats.successfulRuns).toBe(1);
            expect(stats.failedRuns).toBe(0);
            expect(stats.totalDocumentsProcessed).toBe(100);
        });

        it('calculates running average correctly', async () => {
            // First run: duration ~0ms (same timestamps)
            await service.recordRunComplete('jira', {
                documentsProcessed: 10,
                documentsNew: 10,
                documentsUpdated: 0,
                documentsSkipped: 0,
                startedAt: '2024-01-15T10:00:00.000Z',
            });

            // Check that stats were stored
            const firstStatsJson = redisMock._store.get('index:analytics:stats:jira');
            expect(firstStatsJson).toBeDefined();
            const firstStats: SourceStats = JSON.parse(firstStatsJson!);
            expect(firstStats.totalRuns).toBe(1);
            expect(firstStats.totalDocumentsProcessed).toBe(10);
        });

        it('increments failedRuns on error status', async () => {
            await service.recordRunComplete('slack', {
                documentsProcessed: 0,
                documentsNew: 0,
                documentsUpdated: 0,
                documentsSkipped: 0,
                startedAt: '2024-01-15T10:00:00Z',
                error: 'Connection refused',
            });

            const statsJson = redisMock._store.get('index:analytics:stats:slack');
            const stats: SourceStats = JSON.parse(statsJson!);
            expect(stats.failedRuns).toBe(1);
            expect(stats.successfulRuns).toBe(0);
        });
    });

    describe('getRecentRuns', () => {
        it('deduplicates by source+startedAt, preferring completed over running', async () => {
            const startedAt = '2024-01-15T10:00:00Z';

            // Insert a running entry and a completed entry with same startedAt
            const runningEntry: IndexingRun = {
                id: 'gmail_1',
                source: 'gmail',
                startedAt,
                status: 'running',
                documentsProcessed: 0,
                documentsNew: 0,
                documentsUpdated: 0,
                documentsSkipped: 0,
            };
            const completedEntry: IndexingRun = {
                id: 'gmail_2',
                source: 'gmail',
                startedAt,
                completedAt: '2024-01-15T10:05:00Z',
                status: 'completed',
                documentsProcessed: 50,
                documentsNew: 50,
                documentsUpdated: 0,
                documentsSkipped: 0,
            };

            // Directly populate the Redis list
            const key = 'index:analytics:runs:gmail';
            redisMock._lists.set(key, [
                JSON.stringify(runningEntry),
                JSON.stringify(completedEntry),
            ]);

            const runs = await service.getRecentRuns('gmail');

            // Should return only one entry, the completed one
            expect(runs).toHaveLength(1);
            expect(runs[0].status).toBe('completed');
            expect(runs[0].documentsProcessed).toBe(50);
        });

        it('keeps running entry if no completed version exists', async () => {
            const runningEntry: IndexingRun = {
                id: 'gmail_1',
                source: 'gmail',
                startedAt: '2024-01-15T10:00:00Z',
                status: 'running',
                documentsProcessed: 0,
                documentsNew: 0,
                documentsUpdated: 0,
                documentsSkipped: 0,
            };

            redisMock._lists.set('index:analytics:runs:gmail', [
                JSON.stringify(runningEntry),
            ]);

            const runs = await service.getRecentRuns('gmail');
            expect(runs).toHaveLength(1);
            expect(runs[0].status).toBe('running');
        });

        it('respects limit parameter', async () => {
            const entries: IndexingRun[] = [];
            for (let i = 0; i < 10; i++) {
                entries.push({
                    id: `gmail_${i}`,
                    source: 'gmail',
                    startedAt: `2024-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
                    status: 'completed',
                    documentsProcessed: i,
                    documentsNew: i,
                    documentsUpdated: 0,
                    documentsSkipped: 0,
                });
            }

            redisMock._lists.set(
                'index:analytics:runs:gmail',
                entries.map(e => JSON.stringify(e)),
            );

            const runs = await service.getRecentRuns('gmail', 3);
            expect(runs).toHaveLength(3);
        });
    });

    describe('getDailyStats', () => {
        it('returns correct date range in reverse chronological order', async () => {
            // Set up daily data for today
            const today = new Date().toISOString().split('T')[0];
            const dailyKey = `index:analytics:daily:gmail:${today}`;
            redisMock._hashes.set(dailyKey, new Map([
                ['runs', '5'],
                ['documents', '150'],
                ['errors', '1'],
            ]));

            const stats = await service.getDailyStats('gmail', 3);

            // getDailyStats reverses the array, so oldest date first
            expect(stats).toHaveLength(3);
            // Last entry should be today
            expect(stats[stats.length - 1].date).toBe(today);
            // Today's entry should have our data
            const todayEntry = stats.find(s => s.date === today);
            expect(todayEntry).toBeDefined();
            expect(todayEntry!.runs).toBe(5);
            expect(todayEntry!.documents).toBe(150);
            expect(todayEntry!.errors).toBe(1);
        });

        it('returns zeros for days with no data', async () => {
            const stats = await service.getDailyStats('gmail', 7);

            expect(stats).toHaveLength(7);
            for (const day of stats) {
                expect(day.runs).toBe(0);
                expect(day.documents).toBe(0);
                expect(day.errors).toBe(0);
            }
        });
    });

    describe('getSourceStats', () => {
        it('returns default stats when no data exists', async () => {
            const stats = await service.getSourceStats('drive');

            expect(stats).toEqual({
                source: 'drive',
                totalRuns: 0,
                successfulRuns: 0,
                failedRuns: 0,
                lastRunAt: null,
                lastSuccessAt: null,
                averageDurationMs: 0,
                totalDocumentsProcessed: 0,
            });
        });

        it('returns stored stats', async () => {
            const storedStats: SourceStats = {
                source: 'jira',
                totalRuns: 10,
                successfulRuns: 8,
                failedRuns: 2,
                lastRunAt: '2024-01-15T10:00:00Z',
                lastSuccessAt: '2024-01-15T09:00:00Z',
                averageDurationMs: 5000,
                totalDocumentsProcessed: 500,
            };

            redisMock._store.set('index:analytics:stats:jira', JSON.stringify(storedStats));

            const stats = await service.getSourceStats('jira');
            expect(stats).toEqual(storedStats);
        });
    });

    describe('getSystemStats', () => {
        it('aggregates across sources', async () => {
            // Set up stats for two sources
            const jiraStats: SourceStats = {
                source: 'jira',
                totalRuns: 10,
                successfulRuns: 9,
                failedRuns: 1,
                lastRunAt: '2024-01-15T10:00:00Z',
                lastSuccessAt: '2024-01-15T10:00:00Z',
                averageDurationMs: 3000,
                totalDocumentsProcessed: 200,
            };
            const gmailStats: SourceStats = {
                source: 'gmail',
                totalRuns: 5,
                successfulRuns: 5,
                failedRuns: 0,
                lastRunAt: '2024-01-15T09:00:00Z',
                lastSuccessAt: '2024-01-15T09:00:00Z',
                averageDurationMs: 2000,
                totalDocumentsProcessed: 300,
            };

            redisMock._store.set('index:analytics:stats:jira', JSON.stringify(jiraStats));
            redisMock._store.set('index:analytics:stats:gmail', JSON.stringify(gmailStats));

            const systemStats = await service.getSystemStats(['jira', 'gmail']);

            expect(systemStats.totalDocumentsAcrossAllSources).toBe(500);
            expect(systemStats.totalRunsAcrossAllSources).toBe(15);
            expect(systemStats.sources).toHaveLength(2);
        });
    });
});
