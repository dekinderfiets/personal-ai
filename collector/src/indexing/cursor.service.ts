import { Injectable, OnModuleDestroy,OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { Cursor, DataSource, IndexStatus } from '../types';

@Injectable()
export class CursorService implements OnModuleInit, OnModuleDestroy {
    public redis: Redis;
    private readonly CURSOR_PREFIX = 'index:cursor:';
    private readonly STATUS_PREFIX = 'index:status:';
    private readonly HASH_PREFIX = 'index:hashes:';
    private readonly LOCK_PREFIX = 'index:lock:';

    constructor(private configService: ConfigService) { }

    onModuleInit() {
        this.redis = new Redis(this.configService.get<string>('redis.url')!);
    }

    async onModuleDestroy() {
        await this.redis.quit();
    }

    private getCursorKey(source: DataSource): string {
        return `${this.CURSOR_PREFIX}${source}`;
    }

    private getStatusKey(source: DataSource): string {
        return `${this.STATUS_PREFIX}${source}`;
    }

    private getHashKey(source: DataSource): string {
        return `${this.HASH_PREFIX}${source}`;
    }

    private getLockKey(source: DataSource): string {
        return `${this.LOCK_PREFIX}${source}`;
    }

    async getCursor(source: DataSource): Promise<Cursor | null> {
        const data = await this.redis.get(this.getCursorKey(source));
        if (!data) return null;
        return JSON.parse(data);
    }

    async saveCursor(cursor: Cursor): Promise<void> {
        await this.redis.set(
            this.getCursorKey(cursor.source),
            JSON.stringify(cursor)
        );
    }

    async resetCursor(source: DataSource): Promise<void> {
        await this.redis.del(this.getCursorKey(source));
        await this.redis.del(this.getHashKey(source));
    }

    // --- Document Hash Methods (using Redis Hashes) ---

    async getDocumentHash(source: DataSource, documentId: string): Promise<string | null> {
        return this.redis.hget(this.getHashKey(source), documentId);
    }

    async bulkGetDocumentHashes(source: DataSource, documentIds: string[]): Promise<(string | null)[]> {
        if (documentIds.length === 0) return [];
        return this.redis.hmget(this.getHashKey(source), ...documentIds);
    }

    async setDocumentHash(source: DataSource, documentId: string, hash: string): Promise<void> {
        await this.redis.hset(this.getHashKey(source), documentId, hash);
    }

    async bulkSetDocumentHashes(source: DataSource, hashes: Record<string, string>): Promise<void> {
        if (Object.keys(hashes).length === 0) return;
        await this.redis.hset(this.getHashKey(source), hashes);
    }

    async removeDocumentHashes(source: DataSource, documentId: string): Promise<void> {
        const hashKey = this.getHashKey(source);
        let cursor = '0';
        const pattern = documentId.includes('*') ? documentId : `${documentId}*`;

        do {
            const [nextCursor, keys] = await this.redis.hscan(hashKey, cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;

            // keys is an array of [field, value, field, value, ...]
            const fieldsToDelete: string[] = [];
            for (let i = 0; i < keys.length; i += 2) {
                const field = keys[i];
                // We want exact match OR starting with documentId + underscore
                if (field === documentId || field.startsWith(`${documentId}_`)) {
                    fieldsToDelete.push(field);
                }
            }

            if (fieldsToDelete.length > 0) {
                await this.redis.hdel(hashKey, ...fieldsToDelete);
            }
        } while (cursor !== '0');
    }

    // --- Lock Methods ---

    async releaseLock(source: DataSource): Promise<void> {
        await this.redis.del(this.getLockKey(source));
    }

    // --- Status Methods ---

    async getJobStatus(source: DataSource): Promise<IndexStatus | null> {
        const data = await this.redis.get(this.getStatusKey(source));
        if (!data) return null;
        return JSON.parse(data);
    }

    async getAllJobStatus(sources: DataSource[]): Promise<IndexStatus[]> {
        const keys = sources.map(s => this.getStatusKey(s));
        if (keys.length === 0) return [];
        const results = await this.redis.mget(keys);
        return results.map((res, i) => {
            if (res) return JSON.parse(res);
            // Return a default idle status if not found in Redis
            return {
                source: sources[i],
                status: 'idle',
                lastSync: null,
                documentsIndexed: 0,
            };
        });
    }

    async saveJobStatus(status: IndexStatus): Promise<void> {
        // Expire after 24 hours to prevent stale statuses
        await this.redis.set(
            this.getStatusKey(status.source),
            JSON.stringify(status),
            'EX',
            24 * 60 * 60
        );
    }

    async resetStatus(source: DataSource): Promise<void> {
        await this.redis.del(this.getStatusKey(source));
    }
}
