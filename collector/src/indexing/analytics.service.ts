import { Injectable, Logger, OnModuleDestroy,OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { DataSource } from '../types';

export interface IndexingRun {
    id: string;
    source: DataSource;
    startedAt: string;
    completedAt?: string;
    status: 'running' | 'completed' | 'error';
    documentsProcessed: number;
    documentsNew: number;
    documentsUpdated: number;
    documentsSkipped: number;
    error?: string;
    durationMs?: number;
}

export interface SourceStats {
    source: DataSource;
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    averageDurationMs: number;
    totalDocumentsProcessed: number;
}

export interface SystemStats {
    sources: SourceStats[];
    totalDocumentsAcrossAllSources: number;
    totalRunsAcrossAllSources: number;
    recentRuns: IndexingRun[];
}

@Injectable()
export class AnalyticsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AnalyticsService.name);
    private redis: Redis;

    private readonly RUNS_PREFIX = 'index:analytics:runs:';
    private readonly STATS_PREFIX = 'index:analytics:stats:';
    private readonly DAILY_PREFIX = 'index:analytics:daily:';
    private readonly MAX_RUNS_PER_SOURCE = 100;

    constructor(private configService: ConfigService) {}

    onModuleInit() {
        this.redis = new Redis(this.configService.get<string>('redis.url')!);
    }

    async onModuleDestroy() {
        await this.redis.quit();
    }

    async recordRunStart(source: DataSource): Promise<string> {
        const runId = `${source}_${Date.now()}`;
        const run: IndexingRun = {
            id: runId,
            source,
            startedAt: new Date().toISOString(),
            status: 'running',
            documentsProcessed: 0,
            documentsNew: 0,
            documentsUpdated: 0,
            documentsSkipped: 0,
        };

        await this.redis.lpush(
            `${this.RUNS_PREFIX}${source}`,
            JSON.stringify(run),
        );
        await this.redis.ltrim(`${this.RUNS_PREFIX}${source}`, 0, this.MAX_RUNS_PER_SOURCE - 1);

        return runId;
    }

    async recordRunComplete(
        source: DataSource,
        details: {
            runId?: string;
            documentsProcessed: number;
            documentsNew: number;
            documentsUpdated: number;
            documentsSkipped: number;
            startedAt: string;
            error?: string;
        },
    ): Promise<void> {
        const completedAt = new Date().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(details.startedAt).getTime();

        const run: IndexingRun = {
            id: details.runId || `${source}_${Date.now()}`,
            source,
            startedAt: details.startedAt,
            completedAt,
            status: details.error ? 'error' : 'completed',
            documentsProcessed: details.documentsProcessed,
            documentsNew: details.documentsNew,
            documentsUpdated: details.documentsUpdated,
            documentsSkipped: details.documentsSkipped,
            error: details.error,
            durationMs,
        };

        const key = `${this.RUNS_PREFIX}${source}`;

        // If we have a runId, find and replace the "running" entry to avoid duplicates
        let replaced = false;
        if (details.runId) {
            const existingRuns = await this.redis.lrange(key, 0, -1);
            const index = existingRuns.findIndex(r => {
                try {
                    return JSON.parse(r).id === details.runId;
                } catch { return false; }
            });
            if (index !== -1) {
                await this.redis.lset(key, index, JSON.stringify(run));
                replaced = true;
            }
        }

        if (!replaced) {
            await this.redis.lpush(key, JSON.stringify(run));
            await this.redis.ltrim(key, 0, this.MAX_RUNS_PER_SOURCE - 1);
        }

        // Update aggregate stats
        await this.updateAggregateStats(source, run);

        // Update daily counter
        const today = new Date().toISOString().split('T')[0];
        const dailyKey = `${this.DAILY_PREFIX}${source}:${today}`;
        await this.redis.hincrby(dailyKey, 'runs', 1);
        await this.redis.hincrby(dailyKey, 'documents', details.documentsProcessed);
        if (details.error) {
            await this.redis.hincrby(dailyKey, 'errors', 1);
        }
        await this.redis.expire(dailyKey, 90 * 24 * 60 * 60); // Keep 90 days
    }

    private async updateAggregateStats(source: DataSource, run: IndexingRun): Promise<void> {
        const statsKey = `${this.STATS_PREFIX}${source}`;
        const existing = await this.redis.get(statsKey);

        const stats: SourceStats = existing
            ? JSON.parse(existing)
            : {
                source,
                totalRuns: 0,
                successfulRuns: 0,
                failedRuns: 0,
                lastRunAt: null,
                lastSuccessAt: null,
                averageDurationMs: 0,
                totalDocumentsProcessed: 0,
            };

        stats.totalRuns++;
        stats.totalDocumentsProcessed += run.documentsProcessed;
        stats.lastRunAt = run.completedAt || run.startedAt;

        if (run.status === 'completed') {
            stats.successfulRuns++;
            stats.lastSuccessAt = run.completedAt || run.startedAt;
        } else if (run.status === 'error') {
            stats.failedRuns++;
        }

        if (run.durationMs) {
            stats.averageDurationMs = Math.round(
                (stats.averageDurationMs * (stats.totalRuns - 1) + run.durationMs) / stats.totalRuns,
            );
        }

        await this.redis.set(statsKey, JSON.stringify(stats));
    }

    async getSourceStats(source: DataSource): Promise<SourceStats> {
        const statsKey = `${this.STATS_PREFIX}${source}`;
        const data = await this.redis.get(statsKey);

        if (!data) {
            return {
                source,
                totalRuns: 0,
                successfulRuns: 0,
                failedRuns: 0,
                lastRunAt: null,
                lastSuccessAt: null,
                averageDurationMs: 0,
                totalDocumentsProcessed: 0,
            };
        }

        return JSON.parse(data);
    }

    async getRecentRuns(source: DataSource, limit = 20): Promise<IndexingRun[]> {
        // Fetch extra to account for potential duplicates we need to deduplicate
        const runs = await this.redis.lrange(`${this.RUNS_PREFIX}${source}`, 0, (limit * 2) - 1);
        const parsed: IndexingRun[] = runs.map(r => JSON.parse(r));

        // Deduplicate by source+startedAt: prefer completed/error over running
        // Old entries may have different IDs for the same run, but share startedAt
        const byKey = new Map<string, IndexingRun>();
        for (const run of parsed) {
            const key = `${run.source}:${run.startedAt}`;
            const existing = byKey.get(key);
            if (!existing || (existing.status === 'running' && run.status !== 'running')) {
                byKey.set(key, run);
            }
        }

        return Array.from(byKey.values()).slice(0, limit);
    }

    async getAllRecentRuns(sources: DataSource[], limit = 20): Promise<IndexingRun[]> {
        const allRuns: IndexingRun[] = [];
        for (const source of sources) {
            const runs = await this.getRecentRuns(source, limit);
            allRuns.push(...runs);
        }
        allRuns.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        return allRuns.slice(0, limit);
    }

    async getSystemStats(sources: DataSource[]): Promise<SystemStats> {
        const sourceStats = await Promise.all(sources.map(s => this.getSourceStats(s)));
        const recentRuns = await this.getAllRecentRuns(sources, 20);

        return {
            sources: sourceStats,
            totalDocumentsAcrossAllSources: sourceStats.reduce((sum, s) => sum + s.totalDocumentsProcessed, 0),
            totalRunsAcrossAllSources: sourceStats.reduce((sum, s) => sum + s.totalRuns, 0),
            recentRuns,
        };
    }

    async getDailyStats(source: DataSource, days = 30): Promise<{ date: string; runs: number; documents: number; errors: number }[]> {
        const results: { date: string; runs: number; documents: number; errors: number }[] = [];
        const now = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const dailyKey = `${this.DAILY_PREFIX}${source}:${dateStr}`;

            const data = await this.redis.hgetall(dailyKey);
            results.push({
                date: dateStr,
                runs: parseInt(data.runs || '0', 10),
                documents: parseInt(data.documents || '0', 10),
                errors: parseInt(data.errors || '0', 10),
            });
        }

        return results.reverse();
    }
}
