import { ConfigService } from '@nestjs/config';
import { CursorService } from './cursor.service';
import { Cursor, DataSource, IndexStatus } from '../types';

// In-memory Redis mock that simulates real Redis behavior
function createRedisMock() {
    const store = new Map<string, string>();
    const hashes = new Map<string, Map<string, string>>();

    return {
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        set: jest.fn(async (key: string, value: string, ..._args: any[]) => {
            store.set(key, value);
            return 'OK';
        }),
        del: jest.fn(async (...keys: string[]) => {
            let count = 0;
            for (const key of keys) {
                if (store.delete(key)) count++;
                if (hashes.delete(key)) count++;
            }
            return count;
        }),
        mget: jest.fn(async (...keys: string[]) => {
            const flatKeys = keys.flat();
            return flatKeys.map(k => store.get(k) ?? null);
        }),
        hget: jest.fn(async (key: string, field: string) => {
            return hashes.get(key)?.get(field) ?? null;
        }),
        hmget: jest.fn(async (key: string, ...fields: string[]) => {
            const h = hashes.get(key);
            return fields.map(f => h?.get(f) ?? null);
        }),
        hset: jest.fn(async (key: string, ...args: any[]) => {
            if (!hashes.has(key)) hashes.set(key, new Map());
            const h = hashes.get(key)!;
            if (args.length === 1 && typeof args[0] === 'object') {
                for (const [f, v] of Object.entries(args[0])) {
                    h.set(f, v as string);
                }
            } else if (args.length === 2) {
                h.set(args[0], args[1]);
            }
            return 1;
        }),
        hdel: jest.fn(async (key: string, ...fields: string[]) => {
            const h = hashes.get(key);
            if (!h) return 0;
            let count = 0;
            for (const f of fields) {
                if (h.delete(f)) count++;
            }
            return count;
        }),
        hscan: jest.fn(async (key: string, cursor: string, ...args: any[]) => {
            const h = hashes.get(key);
            if (!h) return ['0', []];
            // Simple implementation: return all matching entries at once
            let pattern = '*';
            for (let i = 0; i < args.length; i += 2) {
                if (args[i] === 'MATCH') pattern = args[i + 1];
            }
            const result: string[] = [];
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            for (const [field, value] of h.entries()) {
                if (regex.test(field)) {
                    result.push(field, value);
                }
            }
            return ['0', result];
        }),
        quit: jest.fn(async () => 'OK'),
        // Expose internals for test assertions
        _store: store,
        _hashes: hashes,
    };
}

describe('CursorService', () => {
    let service: CursorService;
    let redisMock: ReturnType<typeof createRedisMock>;

    beforeEach(() => {
        redisMock = createRedisMock();
        const configService = {
            get: jest.fn().mockReturnValue('redis://localhost:6379'),
        } as unknown as ConfigService;

        service = new CursorService(configService);
        // Inject mock Redis directly
        service.redis = redisMock as any;
    });

    describe('key generation', () => {
        it('generates correct cursor key', async () => {
            await service.getCursor('gmail');
            expect(redisMock.get).toHaveBeenCalledWith('index:cursor:gmail');
        });

        it('generates correct status key', async () => {
            await service.getJobStatus('slack');
            expect(redisMock.get).toHaveBeenCalledWith('index:status:slack');
        });

        it('generates correct hash key', async () => {
            await service.getDocumentHash('jira', 'doc1');
            expect(redisMock.hget).toHaveBeenCalledWith('index:hashes:jira', 'doc1');
        });

        it('generates correct lock key', async () => {
            await service.releaseLock('drive');
            expect(redisMock.del).toHaveBeenCalledWith('index:lock:drive');
        });
    });

    describe('getCursor / saveCursor', () => {
        it('returns null when no cursor exists', async () => {
            const result = await service.getCursor('gmail');
            expect(result).toBeNull();
        });

        it('round-trips cursor through JSON serialization', async () => {
            const cursor: Cursor = {
                source: 'gmail',
                lastSync: '2024-01-15T10:00:00Z',
                syncToken: 'abc123',
                metadata: { configKey: 'test' },
            };

            await service.saveCursor(cursor);
            const retrieved = await service.getCursor('gmail');

            expect(retrieved).toEqual(cursor);
        });

        it('serializes cursor to JSON string in Redis', async () => {
            const cursor: Cursor = {
                source: 'jira',
                lastSync: '2024-06-01T00:00:00Z',
            };

            await service.saveCursor(cursor);
            expect(redisMock.set).toHaveBeenCalledWith(
                'index:cursor:jira',
                JSON.stringify(cursor),
            );
        });
    });

    describe('resetCursor', () => {
        it('deletes both cursor key and hash key', async () => {
            await service.resetCursor('slack');

            expect(redisMock.del).toHaveBeenCalledWith('index:cursor:slack');
            expect(redisMock.del).toHaveBeenCalledWith('index:hashes:slack');
        });

        it('deletes cursor and hash data from the store', async () => {
            // Set up data first
            const cursor: Cursor = { source: 'slack', lastSync: '2024-01-01T00:00:00Z' };
            await service.saveCursor(cursor);
            await service.setDocumentHash('slack', 'doc1', 'hash1');

            // Reset
            await service.resetCursor('slack');

            // Verify data is gone
            const result = await service.getCursor('slack');
            expect(result).toBeNull();
        });
    });

    describe('document hash operations', () => {
        it('bulkGetDocumentHashes returns empty array for empty input', async () => {
            const result = await service.bulkGetDocumentHashes('jira', []);
            expect(result).toEqual([]);
            expect(redisMock.hmget).not.toHaveBeenCalled();
        });

        it('bulkGetDocumentHashes retrieves multiple hashes', async () => {
            await service.setDocumentHash('jira', 'doc1', 'hash1');
            await service.setDocumentHash('jira', 'doc2', 'hash2');

            const result = await service.bulkGetDocumentHashes('jira', ['doc1', 'doc2', 'doc3']);
            expect(result).toEqual(['hash1', 'hash2', null]);
        });

        it('bulkSetDocumentHashes is no-op for empty object', async () => {
            await service.bulkSetDocumentHashes('jira', {});
            expect(redisMock.hset).not.toHaveBeenCalled();
        });

        it('bulkSetDocumentHashes stores multiple hashes at once', async () => {
            const hashes = { doc1: 'hash1', doc2: 'hash2' };
            await service.bulkSetDocumentHashes('jira', hashes);
            expect(redisMock.hset).toHaveBeenCalledWith('index:hashes:jira', hashes);
        });

        it('getDocumentHash returns stored hash', async () => {
            await service.setDocumentHash('github', 'file-abc', 'sha256:xyz');
            const result = await service.getDocumentHash('github', 'file-abc');
            expect(result).toBe('sha256:xyz');
        });

        it('getDocumentHash returns null for missing document', async () => {
            const result = await service.getDocumentHash('github', 'nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('removeDocumentHashes', () => {
        beforeEach(async () => {
            // Set up test data: doc123, doc123_chunk1, doc123_chunk2, doc456
            await service.setDocumentHash('gmail', 'doc123', 'hash1');
            await service.setDocumentHash('gmail', 'doc123_chunk1', 'hash2');
            await service.setDocumentHash('gmail', 'doc123_chunk2', 'hash3');
            await service.setDocumentHash('gmail', 'doc456', 'hash4');
        });

        it('removes exact match and underscore-prefixed matches', async () => {
            await service.removeDocumentHashes('gmail', 'doc123');

            // doc123, doc123_chunk1, doc123_chunk2 should be deleted
            expect(redisMock.hdel).toHaveBeenCalledWith(
                'index:hashes:gmail',
                'doc123', 'doc123_chunk1', 'doc123_chunk2',
            );
        });

        it('does not remove unrelated documents', async () => {
            await service.removeDocumentHashes('gmail', 'doc123');

            // doc456 should still exist
            const result = await service.getDocumentHash('gmail', 'doc456');
            expect(result).toBe('hash4');
        });

        it('handles no matches gracefully', async () => {
            await service.removeDocumentHashes('gmail', 'nonexistent');
            // hdel should not have been called since no fields matched the filter
            expect(redisMock.hdel).not.toHaveBeenCalled();
        });
    });

    describe('releaseLock', () => {
        it('deletes the lock key', async () => {
            await service.releaseLock('confluence');
            expect(redisMock.del).toHaveBeenCalledWith('index:lock:confluence');
        });
    });

    describe('getJobStatus / saveJobStatus', () => {
        it('returns null when no status exists', async () => {
            const result = await service.getJobStatus('gmail');
            expect(result).toBeNull();
        });

        it('round-trips status through JSON serialization with TTL', async () => {
            const status: IndexStatus = {
                source: 'gmail',
                status: 'running',
                lastSync: '2024-01-15T10:00:00Z',
                documentsIndexed: 42,
            };

            await service.saveJobStatus(status);

            // Verify TTL is set (24 hours = 86400 seconds)
            expect(redisMock.set).toHaveBeenCalledWith(
                'index:status:gmail',
                JSON.stringify(status),
                'EX',
                86400,
            );

            const retrieved = await service.getJobStatus('gmail');
            expect(retrieved).toEqual(status);
        });

        it('preserves error fields in status', async () => {
            const status: IndexStatus = {
                source: 'jira',
                status: 'error',
                lastSync: '2024-01-15T10:00:00Z',
                documentsIndexed: 0,
                error: 'Auth failed',
                lastError: 'Auth failed',
                lastErrorAt: '2024-01-15T10:01:00Z',
            };

            await service.saveJobStatus(status);
            const retrieved = await service.getJobStatus('jira');
            expect(retrieved).toEqual(status);
        });
    });

    describe('getAllJobStatus', () => {
        it('returns default idle status for missing sources', async () => {
            const results = await service.getAllJobStatus(['gmail', 'slack']);

            expect(results).toEqual([
                { source: 'gmail', status: 'idle', lastSync: null, documentsIndexed: 0 },
                { source: 'slack', status: 'idle', lastSync: null, documentsIndexed: 0 },
            ]);
        });

        it('mixes stored and default statuses', async () => {
            const gmailStatus: IndexStatus = {
                source: 'gmail',
                status: 'completed',
                lastSync: '2024-01-15T10:00:00Z',
                documentsIndexed: 100,
            };
            await service.saveJobStatus(gmailStatus);

            const results = await service.getAllJobStatus(['gmail', 'slack']);
            expect(results[0]).toEqual(gmailStatus);
            expect(results[1]).toEqual({
                source: 'slack',
                status: 'idle',
                lastSync: null,
                documentsIndexed: 0,
            });
        });

        it('returns empty array for empty sources', async () => {
            const results = await service.getAllJobStatus([]);
            expect(results).toEqual([]);
        });
    });
});
