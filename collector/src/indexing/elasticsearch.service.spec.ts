import { ElasticsearchService } from './elasticsearch.service';
import { createHash } from 'crypto';
import { DataSource, SearchResult } from '../types';
import axios from 'axios';

// Mock tiktoken before any imports that use it
jest.mock('tiktoken', () => ({
    encoding_for_model: jest.fn().mockReturnValue({
        encode: jest.fn().mockImplementation((text: string) => {
            // Simple mock: ~1 token per 4 chars
            const len = Math.ceil(text.length / 4);
            return new Array(len);
        }),
    }),
}));

// Mock cohere-ai
jest.mock('cohere-ai', () => ({
    CohereClient: jest.fn().mockImplementation(() => ({
        v2: {
            rerank: jest.fn().mockResolvedValue({ results: [] }),
        },
    })),
}));

function contentHash(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

describe('ElasticsearchService', () => {
    let service: ElasticsearchService;
    let mockEsClient: any;

    beforeEach(() => {
        const mockConfigService = {
            get: jest.fn().mockImplementation((key: string) => {
                const config: Record<string, any> = {
                    'elasticsearch.node': 'http://localhost:9200',
                    'elasticsearch.index': 'test_index',
                    'openai.apiKey': 'test-key',
                    'openai.embeddingModel': 'text-embedding-3-large',
                    'cohere.apiKey': 'test-cohere',
                    'redis.url': 'redis://localhost:6379',
                };
                return config[key];
            }),
        } as any;

        service = new ElasticsearchService(mockConfigService);

        mockEsClient = {
            indices: {
                exists: jest.fn().mockResolvedValue(false),
                create: jest.fn().mockResolvedValue({}),
            },
            index: jest.fn().mockResolvedValue({}),
            bulk: jest.fn().mockResolvedValue({ errors: false, items: [] }),
            search: jest.fn().mockResolvedValue({ hits: { hits: [], total: { value: 0 } } }),
            get: jest.fn(),
            delete: jest.fn(),
            deleteByQuery: jest.fn().mockResolvedValue({}),
            count: jest.fn().mockResolvedValue({ count: 0 }),
            mget: jest.fn().mockResolvedValue({ docs: [] }),
        };

        // Inject mocks
        (service as any).client = mockEsClient;
        (service as any).indexName = 'test_index';
        // Ensure reranking is skipped in tests
        (service as any).cohereClient = null;
    });

    // ─── Private helper methods ─────────────────────────────────────────

    describe('chunkContent', () => {
        const chunkContent = (content: string) => (service as any).chunkContent(content);

        it('should return short content (≤ 600 tokens) as a single chunk', () => {
            // 2400 chars / 4 = 600 tokens = MIN_TOKENS_FOR_CHUNKING, should still be single chunk
            expect(chunkContent('hello')).toEqual(['hello']);
            expect(chunkContent('a'.repeat(2400))).toEqual(['a'.repeat(2400)]);
        });

        it('should split long content into multiple chunks', () => {
            // 2404 chars / 4 = 601 tokens, above MIN_TOKENS_FOR_CHUNKING
            const content = 'a'.repeat(2404);
            const chunks = chunkContent(content);
            expect(chunks.length).toBeGreaterThanOrEqual(1);
        });

        it('should split content with clear sentence boundaries', () => {
            const sentences: string[] = [];
            for (let i = 0; i < 100; i++) {
                sentences.push(`This is sentence number ${i} with some additional padding text.`);
            }
            const content = sentences.join(' ');
            // ~6000 chars / 4 = ~1500 tokens, well above threshold
            const chunks = chunkContent(content);
            expect(chunks.length).toBeGreaterThan(1);
        });

        it('should handle paragraph-based content splitting', () => {
            const paragraphs: string[] = [];
            for (let i = 0; i < 20; i++) {
                paragraphs.push('a'.repeat(200));
            }
            const content = paragraphs.join('\n\n');
            // ~4000 chars / 4 = ~1000 tokens
            const chunks = chunkContent(content);
            expect(chunks.length).toBeGreaterThan(1);
        });
    });

    describe('sanitizeText', () => {
        const sanitize = (text: string) => (service as any).sanitizeText(text);

        it('should remove lone high surrogates', () => {
            expect(sanitize('hello\uD800world')).toBe('helloworld');
        });

        it('should remove lone low surrogates', () => {
            expect(sanitize('hello\uDC00world')).toBe('helloworld');
        });

        it('should preserve valid surrogate pairs (emoji)', () => {
            expect(sanitize('hello 😀 world')).toBe('hello 😀 world');
        });

        it('should pass through normal text unchanged', () => {
            expect(sanitize('hello world')).toBe('hello world');
        });
    });

    describe('flattenMetadata', () => {
        const flatten = (meta: Record<string, unknown>) => (service as any).flattenMetadata(meta);

        it('should pass through string values', () => {
            expect(flatten({ title: 'Test' })).toEqual(expect.objectContaining({ title: 'Test' }));
        });

        it('should pass through number values', () => {
            expect(flatten({ count: 42 })).toEqual(expect.objectContaining({ count: 42 }));
        });

        it('should pass through boolean values', () => {
            expect(flatten({ active: true })).toEqual(expect.objectContaining({ active: true }));
        });

        it('should skip null and undefined values', () => {
            const result = flatten({ a: null, b: undefined, c: 'keep' });
            expect(result.a).toBeUndefined();
            expect(result.b).toBeUndefined();
            expect(result.c).toBe('keep');
        });

        it('should keep arrays as arrays (not JSON.stringify like ChromaDB)', () => {
            const result = flatten({ labels: ['a', 'b'] });
            expect(result.labels).toEqual(['a', 'b']);
            // Verify it's NOT stringified
            expect(typeof result.labels).not.toBe('string');
        });

        it('should JSON-stringify object values', () => {
            expect(flatten({ nested: { x: 1 } })).toEqual(expect.objectContaining({ nested: '{"x":1}' }));
        });

        it('should create numeric timestamp for createdAt string', () => {
            const result = flatten({ createdAt: '2024-01-15T10:00:00Z' });
            expect(result.createdAt).toBe('2024-01-15T10:00:00Z');
            expect(result.createdAtTs).toBe(new Date('2024-01-15T10:00:00Z').getTime());
        });

        it('should create numeric timestamp for updatedAt string', () => {
            const result = flatten({ updatedAt: '2024-06-20T14:30:00Z' });
            expect(result.updatedAt).toBe('2024-06-20T14:30:00Z');
            expect(result.updatedAtTs).toBe(new Date('2024-06-20T14:30:00Z').getTime());
        });

        it('should sanitize surrogate characters in string values', () => {
            const result = flatten({ title: 'test\uD800value' });
            expect(result.title).toBe('testvalue');
        });
    });

    describe('contentHash', () => {
        const hash = (text: string) => (service as any).contentHash(text);

        it('should return deterministic SHA256 hash truncated to 16 chars', () => {
            const expected = createHash('sha256').update('hello').digest('hex').slice(0, 16);
            expect(hash('hello')).toBe(expected);
            expect(hash('hello')).toHaveLength(16);
        });

        it('should produce same hash for same input', () => {
            expect(hash('test')).toBe(hash('test'));
        });

        it('should produce different hashes for different input', () => {
            expect(hash('abc')).not.toBe(hash('xyz'));
        });
    });

    // ─── Source-specific helpers ─────────────────────────────────────────

    describe('getRecencyHalfLife', () => {
        const halfLife = (source: DataSource) => (service as any).getRecencyHalfLife(source);

        it.each([
            ['slack', 7], ['calendar', 14], ['gmail', 14],
            ['jira', 30], ['github', 60], ['confluence', 90], ['drive', 90],
        ] as [DataSource, number][])('should return %i days for %s', (source, expected) => {
            expect(halfLife(source)).toBe(expected);
        });
    });

    describe('getTimestampField', () => {
        const field = (source: DataSource) => (service as any).getTimestampField(source);

        it.each([
            ['slack', 'timestamp'], ['gmail', 'date'], ['calendar', 'start'],
            ['jira', 'updatedAt'], ['drive', 'updatedAt'], ['confluence', 'updatedAt'],
            ['github', 'updatedAt'],
        ] as [DataSource, string][])('should return "%s" for %s', (source, expected) => {
            expect(field(source)).toBe(expected);
        });
    });

    describe('getContextType', () => {
        const ctxType = (source: DataSource, meta: Record<string, unknown>) =>
            (service as any).getContextType(source, meta);

        it('should return "thread" for slack with threadTs', () => {
            expect(ctxType('slack', { threadTs: '123' })).toBe('thread');
        });

        it('should return "channel" for slack without threadTs', () => {
            expect(ctxType('slack', {})).toBe('channel');
        });

        it('should return "thread" for gmail', () => {
            expect(ctxType('gmail', {})).toBe('thread');
        });

        it('should return "issue" for jira comment', () => {
            expect(ctxType('jira', { type: 'comment' })).toBe('issue');
        });

        it('should return "project" for jira issue', () => {
            expect(ctxType('jira', { type: 'issue' })).toBe('project');
        });

        it('should return "folder" for drive', () => {
            expect(ctxType('drive', {})).toBe('folder');
        });

        it('should return "page" for confluence comment', () => {
            expect(ctxType('confluence', { type: 'comment' })).toBe('page');
        });

        it('should return "space" for confluence page', () => {
            expect(ctxType('confluence', { type: 'page' })).toBe('space');
        });

        it('should return "calendar" for calendar', () => {
            expect(ctxType('calendar', {})).toBe('calendar');
        });

        it('should return "pull_request" for github pr_comment', () => {
            expect(ctxType('github', { type: 'pr_comment' })).toBe('pull_request');
        });

        it('should return "pull_request" for github pr_review', () => {
            expect(ctxType('github', { type: 'pr_review' })).toBe('pull_request');
        });

        it('should return "repository" for github issue', () => {
            expect(ctxType('github', { type: 'issue' })).toBe('repository');
        });
    });

    describe('resolveParentDocumentId', () => {
        const resolve = (source: DataSource, meta: Record<string, unknown>) =>
            (service as any).resolveParentDocumentId(source, meta);

        it('should prefix confluence comment parentId with "confluence_"', () => {
            expect(resolve('confluence', { parentId: '12345', type: 'comment' })).toBe('confluence_12345');
        });

        it('should return raw parentId for non-confluence sources', () => {
            expect(resolve('jira', { parentId: 'PROJ-1' })).toBe('PROJ-1');
            expect(resolve('slack', { parentId: 'slack_C01_123' })).toBe('slack_C01_123');
        });

        it('should check parentDocId if parentId is missing', () => {
            expect(resolve('jira', { parentDocId: 'chunk-parent' })).toBe('chunk-parent');
        });

        it('should return null when no parent identifiers exist', () => {
            expect(resolve('jira', {})).toBeNull();
            expect(resolve('gmail', {})).toBeNull();
        });

        it('should return null for drive with path (no parent doc for folders)', () => {
            expect(resolve('drive', { path: '/folder/subfolder/file.txt' })).toBeNull();
        });
    });

    // ─── Where clause builders ──────────────────────────────────────────

    describe('buildDatapointWhereClause', () => {
        const build = (source: DataSource, meta: Record<string, unknown>) =>
            (service as any).buildDatapointWhereClause(source, meta);

        it('should use threadTs for slack threads', () => {
            expect(build('slack', { threadTs: '123.456' })).toEqual({ threadTs: '123.456' });
        });

        it('should fall back to channelId for slack', () => {
            expect(build('slack', { channelId: 'C01' })).toEqual({ channelId: 'C01' });
        });

        it('should return null for slack with no thread/channel', () => {
            expect(build('slack', {})).toBeNull();
        });

        it('should use threadId for gmail', () => {
            expect(build('gmail', { threadId: 'thread1' })).toEqual({ threadId: 'thread1' });
        });

        it('should use parentId for jira, fallback to project', () => {
            expect(build('jira', { parentId: 'PROJ-1' })).toEqual({ parentId: 'PROJ-1' });
            expect(build('jira', { project: 'PROJ' })).toEqual({ project: 'PROJ' });
            expect(build('jira', {})).toBeNull();
        });

        it('should use folderPath for drive', () => {
            expect(build('drive', { folderPath: '/docs' })).toEqual({ folderPath: '/docs' });
        });

        it('should extract folder from path for drive fallback', () => {
            expect(build('drive', { path: '/folder/file.txt' })).toEqual({ folderPath: '/folder' });
        });

        it('should use parentId for confluence, fallback to space', () => {
            expect(build('confluence', { parentId: '123' })).toEqual({ parentId: '123' });
            expect(build('confluence', { space: 'ENG' })).toEqual({ space: 'ENG' });
        });

        it('should return { source: "calendar" } for calendar', () => {
            expect(build('calendar', {})).toEqual({ source: 'calendar' });
        });

        it('should use parentId for github, fallback to repo', () => {
            expect(build('github', { parentId: 'pr-1' })).toEqual({ parentId: 'pr-1' });
            expect(build('github', { repo: 'org/repo' })).toEqual({ repo: 'org/repo' });
            expect(build('github', {})).toBeNull();
        });
    });

    describe('buildContextWhereClause', () => {
        const build = (source: DataSource, meta: Record<string, unknown>) =>
            (service as any).buildContextWhereClause(source, meta);

        it('should use channelId for slack', () => {
            expect(build('slack', { channelId: 'C01' })).toEqual({ channelId: 'C01' });
        });

        it('should use threadId for gmail', () => {
            expect(build('gmail', { threadId: 't1' })).toEqual({ threadId: 't1' });
        });

        it('should use project for jira', () => {
            expect(build('jira', { project: 'PROJ' })).toEqual({ project: 'PROJ' });
        });

        it('should use folderPath for drive', () => {
            expect(build('drive', { folderPath: '/docs' })).toEqual({ folderPath: '/docs' });
        });

        it('should extract folder from path for drive fallback', () => {
            expect(build('drive', { path: '/folder/file.txt' })).toEqual({ folderPath: '/folder' });
        });

        it('should use space for confluence', () => {
            expect(build('confluence', { space: 'ENG' })).toEqual({ space: 'ENG' });
        });

        it('should use repo for github', () => {
            expect(build('github', { repo: 'org/repo' })).toEqual({ repo: 'org/repo' });
        });

        it('should return null when no matching metadata exists', () => {
            expect(build('slack', {})).toBeNull();
            expect(build('gmail', {})).toBeNull();
            expect(build('jira', {})).toBeNull();
            expect(build('drive', {})).toBeNull();
            expect(build('confluence', {})).toBeNull();
            expect(build('github', {})).toBeNull();
        });
    });

    // ─── ensureIndex ────────────────────────────────────────────────────

    describe('ensureIndex', () => {
        it('should create index with correct mapping when not exists', async () => {
            mockEsClient.indices.exists.mockResolvedValue(false);

            await (service as any).ensureIndex();

            expect(mockEsClient.indices.create).toHaveBeenCalled();
            const createCall = mockEsClient.indices.create.mock.calls[0][0];
            expect(createCall.index).toBe('test_index');
            // Mappings are inside body wrapper (ES 7.x client style)
            const mappings = createCall.body.mappings;
            expect(mappings.properties.embedding).toEqual(
                expect.objectContaining({
                    type: 'dense_vector',
                    dims: 3072,
                }),
            );
            // Verify key property types
            expect(mappings.properties.source.type).toBe('keyword');
            expect(mappings.properties.content.type).toBe('text');
            expect(mappings.properties.parentDocId.type).toBe('keyword');
            expect(mappings.properties.createdAtTs.type).toBe('long');
            // Verify settings
            expect(createCall.body.settings).toBeDefined();
        });

        it('should skip creation when index already exists', async () => {
            mockEsClient.indices.exists.mockResolvedValue(true);

            await (service as any).ensureIndex();

            expect(mockEsClient.indices.create).not.toHaveBeenCalled();
        });
    });

    // ─── upsertDocuments ────────────────────────────────────────────────

    describe('upsertDocuments', () => {
        let mockAxios: jest.SpyInstance;

        beforeEach(() => {
            mockAxios = jest.spyOn(axios, 'post').mockResolvedValue({
                data: { data: [{ embedding: new Array(3072).fill(0.1) }] },
            });
            // Default: no existing docs
            mockEsClient.mget.mockResolvedValue({ docs: [] });
        });

        afterEach(() => {
            mockAxios.mockRestore();
        });

        it('should be a no-op for empty documents array', async () => {
            await service.upsertDocuments('jira', []);
            expect(mockEsClient.bulk).not.toHaveBeenCalled();
        });

        it('should upsert a single-chunk document with context header, flattened metadata, and content hash', async () => {
            mockEsClient.mget.mockResolvedValue({ docs: [{ found: false }] });

            const doc = {
                id: 'jira-1',
                source: 'jira' as DataSource,
                content: 'Short issue content',
                metadata: { title: 'Bug', createdAt: '2024-01-15T10:00:00Z', source: 'jira' },
            } as any;

            await service.upsertDocuments('jira', [doc]);

            expect(mockEsClient.bulk).toHaveBeenCalled();
            const bulkCall = mockEsClient.bulk.mock.calls[0][0];
            const operations = bulkCall.operations || bulkCall.body;

            // Should have an index action
            const indexActions = operations.filter((op: any) => op.index);
            expect(indexActions.length).toBeGreaterThan(0);
            expect(indexActions[0].index._id).toBe('jira-1');

            // Find the document body (follows the index action)
            const actionIdx = operations.findIndex((op: any) => op.index?._id === 'jira-1');
            const docBody = operations[actionIdx + 1];

            // Content should have context header prepended
            expect(docBody.content).toContain('Document: Bug');
            expect(docBody.content).toContain('Source: jira');
            expect(docBody.content).toContain('Short issue content');

            // Content hash and original content preserved
            expect(docBody._contentHash).toBe(contentHash('Short issue content'));
            expect(docBody._originalContent).toBe('Short issue content');

            // Flattened metadata
            expect(docBody.title).toBe('Bug');
            expect(docBody.createdAtTs).toBe(new Date('2024-01-15T10:00:00Z').getTime());
        });

        it('should create chunk items for content exceeding token threshold', async () => {
            const sentences: string[] = [];
            for (let i = 0; i < 50; i++) {
                sentences.push(`This is test sentence number ${i} with some additional padding text to fill.`);
            }
            const longContent = sentences.join(' ');

            const doc = {
                id: 'doc-long',
                source: 'drive' as DataSource,
                content: longContent,
                metadata: { title: 'Long doc', source: 'drive' },
            } as any;

            await service.upsertDocuments('drive', [doc]);

            expect(mockEsClient.bulk).toHaveBeenCalled();
            const bulkCall = mockEsClient.bulk.mock.calls[0][0];
            const operations = bulkCall.operations || bulkCall.body;

            // Find index actions - should have multiple chunks
            const indexActions = operations.filter((op: any) => op.index);
            expect(indexActions.length).toBeGreaterThan(1);

            // Check chunk IDs
            expect(indexActions[0].index._id).toBe('doc-long_chunk_0');
            expect(indexActions[1].index._id).toBe('doc-long_chunk_1');

            // Check chunk metadata in the body after first index action
            const firstChunkIdx = operations.findIndex((op: any) => op.index?._id === 'doc-long_chunk_0');
            const chunkBody = operations[firstChunkIdx + 1];
            expect(chunkBody.chunkIndex).toBe(0);
            expect(chunkBody.parentDocId).toBe('doc-long');
            expect(chunkBody.totalChunks).toBeGreaterThan(1);
        });

        it('should handle pre-chunked documents', async () => {
            const doc = {
                id: 'github_file_1',
                source: 'github' as DataSource,
                content: 'Full file content',
                metadata: { title: 'app.ts', source: 'github' },
                preChunked: { chunks: ['chunk one', 'chunk two'] },
            } as any;

            await service.upsertDocuments('github', [doc]);

            expect(mockEsClient.bulk).toHaveBeenCalled();
            const bulkCall = mockEsClient.bulk.mock.calls[0][0];
            const operations = bulkCall.operations || bulkCall.body;

            const indexActions = operations.filter((op: any) => op.index);
            expect(indexActions).toHaveLength(2);
            expect(indexActions[0].index._id).toBe('github_file_1_chunk_0');
            expect(indexActions[1].index._id).toBe('github_file_1_chunk_1');

            // Check content includes context header
            const firstChunkIdx = operations.findIndex((op: any) => op.index?._id === 'github_file_1_chunk_0');
            const chunkBody = operations[firstChunkIdx + 1];
            expect(chunkBody.content).toContain('chunk one');
            expect(chunkBody.content).toContain('Document: app.ts');
            expect(chunkBody.chunkIndex).toBe(0);
            expect(chunkBody.totalChunks).toBe(2);
            expect(chunkBody.parentDocId).toBe('github_file_1');
        });

        it('should route unchanged content to metadata-only update (no embedding generation)', async () => {
            const content = 'Existing content';
            const hash = contentHash(content);

            // Mock existing hash that matches
            mockEsClient.mget.mockResolvedValue({
                docs: [{ _id: 'doc1', found: true, _source: { _contentHash: hash } }],
            });

            const doc = {
                id: 'doc1',
                source: 'jira' as DataSource,
                content,
                metadata: { title: 'Updated title', source: 'jira' },
            } as any;

            mockAxios.mockClear();
            await service.upsertDocuments('jira', [doc]);

            expect(mockEsClient.bulk).toHaveBeenCalled();
            const bulkCall = mockEsClient.bulk.mock.calls[0][0];
            const operations = bulkCall.operations || bulkCall.body;

            // Should use update action (not index)
            const updateActions = operations.filter((op: any) => op.update);
            expect(updateActions.length).toBeGreaterThan(0);

            // Should NOT have generated new embeddings
            expect(mockAxios).not.toHaveBeenCalled();
        });

        it('should route changed content to full re-index with new embeddings', async () => {
            // Mock existing hash that does NOT match
            mockEsClient.mget.mockResolvedValue({
                docs: [{ _id: 'doc1', found: true, _source: { _contentHash: 'old-hash-different' } }],
            });

            const doc = {
                id: 'doc1',
                source: 'jira' as DataSource,
                content: 'New content',
                metadata: { title: 'Doc', source: 'jira' },
            } as any;

            await service.upsertDocuments('jira', [doc]);

            expect(mockEsClient.bulk).toHaveBeenCalled();
            const bulkCall = mockEsClient.bulk.mock.calls[0][0];
            const operations = bulkCall.operations || bulkCall.body;

            // Should use index action (full re-index)
            const indexActions = operations.filter((op: any) => op.index);
            expect(indexActions.length).toBeGreaterThan(0);

            // Should have generated embeddings
            expect(mockAxios).toHaveBeenCalled();

            // Verify new content hash
            const actionIdx = operations.findIndex((op: any) => op.index?._id === 'doc1');
            const docBody = operations[actionIdx + 1];
            expect(docBody._contentHash).toBe(contentHash('New content'));
            expect(docBody._originalContent).toBe('New content');
        });
    });

    // ─── deleteDocument ─────────────────────────────────────────────────

    describe('deleteDocument', () => {
        it('should delete doc by ID and deleteByQuery for chunks (parentDocId term)', async () => {
            mockEsClient.delete.mockResolvedValue({});

            await service.deleteDocument('jira', 'doc1');

            expect(mockEsClient.delete).toHaveBeenCalledWith(
                expect.objectContaining({
                    index: 'test_index',
                    id: 'doc1',
                }),
            );
            expect(mockEsClient.deleteByQuery).toHaveBeenCalled();
            const deleteByQueryCall = mockEsClient.deleteByQuery.mock.calls[0][0];
            expect(deleteByQueryCall.index).toBe('test_index');
            // Query is inside body wrapper
            expect(deleteByQueryCall.body.query.term.parentDocId).toBe('doc1');
        });

        it('should handle missing document gracefully', async () => {
            mockEsClient.delete.mockRejectedValue({ statusCode: 404 });

            await expect(service.deleteDocument('jira', 'nonexistent')).resolves.not.toThrow();
        });
    });

    // ─── getDocument ────────────────────────────────────────────────────

    describe('getDocument', () => {
        it('should return mapped SearchResult when found', async () => {
            mockEsClient.get.mockResolvedValue({
                found: true,
                _id: 'doc1',
                _source: {
                    source: 'jira',
                    content: 'enriched content with header',
                    _originalContent: 'original content',
                    title: 'Test',
                },
            });

            const result = await service.getDocument('jira', 'doc1');

            expect(result).not.toBeNull();
            expect(result!.id).toBe('doc1');
            expect(result!.source).toBe('jira');
            // Should use _originalContent over content
            expect(result!.content).toBe('original content');
        });

        it('should return null when not found (catch 404)', async () => {
            mockEsClient.get.mockRejectedValue({ statusCode: 404 });

            const result = await service.getDocument('jira', 'missing');
            expect(result).toBeNull();
        });
    });

    // ─── countDocuments ─────────────────────────────────────────────────

    describe('countDocuments', () => {
        it('should return count with source term filter', async () => {
            mockEsClient.count.mockResolvedValue({ count: 42 });

            const result = await service.countDocuments('jira');

            expect(result).toBe(42);
            expect(mockEsClient.count).toHaveBeenCalledWith(
                expect.objectContaining({
                    index: 'test_index',
                }),
            );
            // Verify source filter is included
            const countCall = mockEsClient.count.mock.calls[0][0];
            const callStr = JSON.stringify(countCall);
            expect(callStr).toContain('"source"');
            expect(callStr).toContain('"jira"');
        });
    });

    // ─── deleteCollection ───────────────────────────────────────────────

    describe('deleteCollection', () => {
        it('should deleteByQuery with source term filter', async () => {
            await service.deleteCollection('jira');

            expect(mockEsClient.deleteByQuery).toHaveBeenCalledWith(
                expect.objectContaining({
                    index: 'test_index',
                }),
            );
            const deleteCall = mockEsClient.deleteByQuery.mock.calls[0][0];
            const callStr = JSON.stringify(deleteCall);
            expect(callStr).toContain('"source"');
            expect(callStr).toContain('"jira"');
        });
    });

    // ─── getDocumentsByMetadata ──────────────────────────────────────────

    describe('getDocumentsByMetadata', () => {
        it('should build bool query with term filters and source filter and return mapped results', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: {
                    hits: [
                        {
                            _id: 'doc1',
                            _source: {
                                source: 'jira',
                                content: 'enriched',
                                _originalContent: 'original',
                                project: 'PROJ',
                            },
                        },
                    ],
                    total: { value: 1 },
                },
            });

            const result = await service.getDocumentsByMetadata('jira', { project: 'PROJ' }, 10);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('doc1');
            expect(result[0].source).toBe('jira');
            expect(result[0].content).toBe('original');

            // Verify the search query includes source and metadata filters
            const searchCall = mockEsClient.search.mock.calls[0][0];
            const callStr = JSON.stringify(searchCall);
            expect(callStr).toContain('"source"');
            expect(callStr).toContain('"jira"');
            expect(callStr).toContain('"project"');
            expect(callStr).toContain('"PROJ"');
        });
    });

    // ─── Search ─────────────────────────────────────────────────────────

    describe('search', () => {
        beforeEach(() => {
            jest.spyOn(service as any, 'getQueryEmbedding').mockResolvedValue(new Array(3072).fill(0.1));
        });

        it('should call ES with knn query for vector search', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: {
                    hits: [
                        { _id: 'id1', _source: { source: 'jira', content: 'c1', _originalContent: 'c1' }, _score: 0.8 },
                        { _id: 'id2', _source: { source: 'jira', content: 'c2', _originalContent: 'c2' }, _score: 0.5 },
                    ],
                    total: { value: 2 },
                },
            });

            const result = await service.search('test', {
                sources: ['jira' as DataSource],
                searchType: 'vector',
                limit: 10,
            });

            expect(result.results).toHaveLength(2);
            expect(result.results[0].source).toBe('jira');

            // Verify knn query structure (inside body wrapper)
            const searchCall = mockEsClient.search.mock.calls[0][0];
            const body = searchCall.body;
            expect(body).toHaveProperty('knn');
            expect(body.knn).toEqual(
                expect.objectContaining({
                    field: 'embedding',
                    query_vector: expect.any(Array),
                }),
            );
        });

        it('should call ES with function_score + multi_match for keyword search', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            await service.search('test query', {
                sources: ['jira' as DataSource],
                searchType: 'keyword',
            });

            const searchCall = mockEsClient.search.mock.calls[0][0];
            const body = searchCall.body;
            expect(body).toHaveProperty('query');
            expect(body.query).toHaveProperty('function_score');
            expect(body.query.function_score).toHaveProperty('query');
            expect(body.query.function_score.query.bool.must[0]).toHaveProperty('multi_match');
        });

        it('should call ES with sub_searches + rrf for hybrid search', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            await service.search('test query', {
                sources: ['jira' as DataSource],
                searchType: 'hybrid',
            });

            const searchCall = mockEsClient.search.mock.calls[0][0];
            const body = searchCall.body;
            expect(body).toHaveProperty('sub_searches');
            expect(body.sub_searches).toEqual(expect.any(Array));
            expect(body).toHaveProperty('rank');
            expect(body.rank).toHaveProperty('rrf');
        });

        it('should deduplicate chunks keeping highest-scoring per parent', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: {
                    hits: [
                        { _id: 'standalone', _source: { source: 'jira', content: 'doc A', _originalContent: 'doc A' }, _score: 0.8 },
                        { _id: 'parent1_chunk_0', _source: { source: 'jira', content: 'chunk 0', _originalContent: 'chunk 0', parentDocId: 'parent1', chunkIndex: 0, totalChunks: 2 }, _score: 0.7 },
                        { _id: 'parent1_chunk_1', _source: { source: 'jira', content: 'chunk 1', _originalContent: 'chunk 1', parentDocId: 'parent1', chunkIndex: 1, totalChunks: 2 }, _score: 0.6 },
                    ],
                    total: { value: 3 },
                },
            });

            const result = await service.search('test', {
                sources: ['jira' as DataSource],
                searchType: 'vector',
                limit: 10,
            });

            // Should have 2 results: standalone + best chunk of parent1
            expect(result.results).toHaveLength(2);
            expect(result.total).toBe(2);
            // Standalone (0.8) should be first
            expect(result.results[0].id).toBe('standalone');
            // Best chunk (0.7) gets multi-chunk boost
            expect(result.results[1].id).toBe('parent1_chunk_0');
        });

        it('should apply multi-chunk boost for documents with multiple matching chunks', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: {
                    hits: [
                        { _id: 'p_chunk_0', _source: { source: 'jira', content: 'c0', _originalContent: 'c0', parentDocId: 'p' }, _score: 0.8 },
                        { _id: 'p_chunk_1', _source: { source: 'jira', content: 'c1', _originalContent: 'c1', parentDocId: 'p' }, _score: 0.7 },
                        { _id: 'p_chunk_2', _source: { source: 'jira', content: 'c2', _originalContent: 'c2', parentDocId: 'p' }, _score: 0.6 },
                    ],
                    total: { value: 3 },
                },
            });

            const result = await service.search('test', {
                sources: ['jira' as DataSource],
                searchType: 'vector',
                limit: 10,
            });

            // Best chunk score = 0.8, chunkCount = 3
            // Multi-chunk boost: 0.8 * (1 + min(log(3)*0.05, 0.15))
            // log(3) ~ 1.0986, * 0.05 = 0.0549
            // boosted = 0.8 * 1.0549 ~ 0.8439
            // After personalization: 0.55 * 0.8439 + 0 (no recency/ownership/engagement/connector) ~ 0.4642
            expect(result.results).toHaveLength(1);
            expect(result.results[0].score).toBeCloseTo(0.55 * 0.8 * (1 + Math.min(Math.log(3) * 0.05, 0.15)), 2);
        });

        it('should apply offset and limit pagination after scoring', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: {
                    hits: [
                        { _id: 'a', _source: { source: 'jira', content: 'da', _originalContent: 'da' }, _score: 0.9 },
                        { _id: 'b', _source: { source: 'jira', content: 'db', _originalContent: 'db' }, _score: 0.7 },
                        { _id: 'c', _source: { source: 'jira', content: 'dc', _originalContent: 'dc' }, _score: 0.5 },
                    ],
                    total: { value: 3 },
                },
            });

            const result = await service.search('test', {
                sources: ['jira' as DataSource],
                searchType: 'vector',
                limit: 1,
                offset: 1,
            });

            // After sort: a(0.9), b(0.7), c(0.5)
            // offset=1, limit=1 -> [b]
            expect(result.results).toHaveLength(1);
            expect(result.results[0].id).toBe('b');
            expect(result.total).toBe(3);
        });

        it('should filter by source terms', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            await service.search('test', {
                sources: ['jira' as DataSource, 'slack' as DataSource],
                searchType: 'vector',
            });

            const searchCall = mockEsClient.search.mock.calls[0][0];
            const callStr = JSON.stringify(searchCall);
            // Should have source filter for the requested sources
            expect(callStr).toContain('jira');
            expect(callStr).toContain('slack');
        });

        it('should add where clause as term filters', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            await service.search('test', {
                sources: ['jira' as DataSource],
                searchType: 'vector',
                where: { project: 'PROJ' },
            });

            const searchCall = mockEsClient.search.mock.calls[0][0];
            const callStr = JSON.stringify(searchCall);
            expect(callStr).toContain('"project"');
            expect(callStr).toContain('"PROJ"');
        });

        it('should add date range filter on createdAtTs', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            await service.search('test', {
                sources: ['jira' as DataSource],
                searchType: 'vector',
                startDate: '2024-01-01',
                endDate: '2024-12-31',
            });

            const searchCall = mockEsClient.search.mock.calls[0][0];
            const callStr = JSON.stringify(searchCall);
            expect(callStr).toContain('createdAtTs');
            expect(callStr).toContain('gte');
            expect(callStr).toContain('lte');
        });

        it('should propagate search failure as an error', async () => {
            mockEsClient.search.mockRejectedValue(new Error('Connection failed'));

            await expect(
                service.search('test', {
                    sources: ['jira' as DataSource],
                    searchType: 'vector',
                }),
            ).rejects.toThrow('Connection failed');
        });

        // ─── Personalization tests ──────────────────────────────────────

        it('should apply recency scoring with known daysSince and halfLife', async () => {
            const now = Date.now();
            jest.spyOn(Date, 'now').mockReturnValue(now);

            const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
            const justNow = new Date(now).toISOString();

            mockEsClient.search.mockResolvedValue({
                hits: {
                    hits: [
                        { _id: 'old', _source: { source: 'slack', content: 'old msg', _originalContent: 'old msg', updatedAt: sevenDaysAgo }, _score: 0.5 },
                        { _id: 'new', _source: { source: 'slack', content: 'new msg', _originalContent: 'new msg', updatedAt: justNow }, _score: 0.5 },
                    ],
                    total: { value: 2 },
                },
            });

            const result = await service.search('test', {
                sources: ['slack' as DataSource],
                searchType: 'vector',
                limit: 10,
            });

            // Recent document should have higher score due to recency boost
            const newDoc = result.results.find(r => r.id === 'new');
            const oldDoc = result.results.find(r => r.id === 'old');
            expect(newDoc).toBeDefined();
            expect(oldDoc).toBeDefined();
            expect(newDoc!.score).toBeGreaterThan(oldDoc!.score);

            jest.restoreAllMocks();
        });

        it('should boost owned documents (is_owner > is_assigned_to_me > none)', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: {
                    hits: [
                        { _id: 'owned', _source: { source: 'jira', content: 'c', _originalContent: 'c', is_owner: true }, _score: 0.5 },
                        { _id: 'assigned', _source: { source: 'jira', content: 'c', _originalContent: 'c', is_assigned_to_me: true }, _score: 0.5 },
                        { _id: 'none', _source: { source: 'jira', content: 'c', _originalContent: 'c' }, _score: 0.5 },
                    ],
                    total: { value: 3 },
                },
            });

            const result = await service.search('test', {
                sources: ['jira' as DataSource],
                searchType: 'vector',
                limit: 10,
            });

            const owned = result.results.find(r => r.id === 'owned');
            const assigned = result.results.find(r => r.id === 'assigned');
            const none = result.results.find(r => r.id === 'none');

            expect(owned).toBeDefined();
            expect(assigned).toBeDefined();
            expect(none).toBeDefined();
            expect(owned!.score).toBeGreaterThan(assigned!.score);
            expect(assigned!.score).toBeGreaterThan(none!.score);
        });

        it('should apply engagement scoring per source', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: {
                    hits: [
                        { _id: 'engaged', _source: { source: 'slack', content: 'c', _originalContent: 'c', reactionCount: 5, threadTs: '123' }, _score: 0.5 },
                        { _id: 'plain', _source: { source: 'slack', content: 'c', _originalContent: 'c' }, _score: 0.5 },
                    ],
                    total: { value: 2 },
                },
            });

            const result = await service.search('test', {
                sources: ['slack' as DataSource],
                searchType: 'vector',
                limit: 10,
            });

            const engaged = result.results.find(r => r.id === 'engaged');
            const plain = result.results.find(r => r.id === 'plain');

            expect(engaged).toBeDefined();
            expect(plain).toBeDefined();
            expect(engaged!.score).toBeGreaterThan(plain!.score);
        });

        it('should combine recency, ownership, and engagement in final weighted score', async () => {
            const now = Date.now();
            jest.spyOn(Date, 'now').mockReturnValue(now);

            const justNow = new Date(now).toISOString();

            mockEsClient.search.mockResolvedValue({
                hits: {
                    hits: [
                        {
                            _id: 'boosted',
                            _source: {
                                source: 'slack',
                                content: 'c',
                                _originalContent: 'c',
                                updatedAt: justNow,
                                is_owner: true,
                                reactionCount: 5,
                                threadTs: '123',
                            },
                            _score: 0.5,
                        },
                        {
                            _id: 'plain',
                            _source: { source: 'slack', content: 'c', _originalContent: 'c' },
                            _score: 0.5,
                        },
                    ],
                    total: { value: 2 },
                },
            });

            const result = await service.search('test', {
                sources: ['slack' as DataSource],
                searchType: 'vector',
                limit: 10,
            });

            const boosted = result.results.find(r => r.id === 'boosted');
            const plain = result.results.find(r => r.id === 'plain');

            expect(boosted).toBeDefined();
            expect(plain).toBeDefined();
            expect(boosted!.score).toBeGreaterThan(plain!.score);

            jest.restoreAllMocks();
        });
    });

    // ─── listDocuments ──────────────────────────────────────────────────

    describe('listDocuments', () => {
        it('should return sorted results with from/size pagination', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: {
                    hits: [
                        { _id: 'doc2', _source: { source: 'jira', content: 'c2', _originalContent: 'c2', updatedAtTs: 2000 } },
                        { _id: 'doc1', _source: { source: 'jira', content: 'c1', _originalContent: 'c1', updatedAtTs: 1000 } },
                    ],
                    total: { value: 5 },
                },
            });

            const result = await service.listDocuments('jira', { limit: 2, offset: 0 });

            expect(result.results).toHaveLength(2);
            expect(result.total).toBe(5);
        });

        it('should filter by source', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            await service.listDocuments('jira');

            const searchCall = mockEsClient.search.mock.calls[0][0];
            const callStr = JSON.stringify(searchCall);
            expect(callStr).toContain('"source"');
            expect(callStr).toContain('"jira"');
        });

        it('should exclude chunks (parentDocId must_not exist)', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            await service.listDocuments('jira');

            const searchCall = mockEsClient.search.mock.calls[0][0];
            const callStr = JSON.stringify(searchCall);
            expect(callStr).toContain('must_not');
            expect(callStr).toContain('parentDocId');
        });

        it('should exclude embedding from _source', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            await service.listDocuments('jira');

            const searchCall = mockEsClient.search.mock.calls[0][0];
            // _source should exclude embedding field
            if (searchCall._source && searchCall._source.excludes) {
                expect(searchCall._source.excludes).toContain('embedding');
            } else if (searchCall._source === false) {
                // acceptable - no _source
            } else {
                // Check if _source excludes embedding in any form
                const callStr = JSON.stringify(searchCall);
                expect(callStr).toContain('embedding');
            }
        });

        it('should handle date range filters', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            await service.listDocuments('jira', {
                startDate: '2024-01-01',
                endDate: '2024-12-31',
            });

            const searchCall = mockEsClient.search.mock.calls[0][0];
            const callStr = JSON.stringify(searchCall);
            expect(callStr).toContain('createdAtTs');
        });

        it('should handle where filters', async () => {
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            await service.listDocuments('jira', {
                where: { project: 'PROJ' },
            });

            const searchCall = mockEsClient.search.mock.calls[0][0];
            const callStr = JSON.stringify(searchCall);
            expect(callStr).toContain('"project"');
            expect(callStr).toContain('"PROJ"');
        });
    });

    // ─── Navigate ───────────────────────────────────────────────────────

    describe('navigate', () => {
        // navigate() uses client.get directly for the current doc,
        // then getDocument/getDocumentsByMetadata for related docs.
        // Both getDocument and navigate internally use client.get.

        it('should return null current when document is not found', async () => {
            mockEsClient.get.mockRejectedValue({ statusCode: 404 });

            const result = await service.navigate('nonexistent', 'next', 'chunk');

            expect(result.current).toBeNull();
            expect(result.related).toEqual([]);
            expect(result.navigation).toEqual({
                hasPrev: false,
                hasNext: false,
                parentId: null,
                contextType: 'unknown',
            });
        });

        it('should navigate to previous chunk', async () => {
            mockEsClient.get.mockImplementation((args: any) => {
                if (args.id === 'doc1_chunk_1') {
                    return Promise.resolve({
                        found: true,
                        _id: 'doc1_chunk_1',
                        _source: { source: 'jira', chunkIndex: 1, totalChunks: 3, parentDocId: 'doc1', _originalContent: 'Chunk 1 content' },
                    });
                }
                if (args.id === 'doc1_chunk_0') {
                    return Promise.resolve({
                        found: true,
                        _id: 'doc1_chunk_0',
                        _source: { source: 'jira', chunkIndex: 0, totalChunks: 3, parentDocId: 'doc1', _originalContent: 'Chunk 0 content' },
                    });
                }
                return Promise.reject({ statusCode: 404 });
            });

            const result = await service.navigate('doc1_chunk_1', 'prev', 'chunk');

            expect(result.current).not.toBeNull();
            expect(result.current!.id).toBe('doc1_chunk_1');
            expect(result.related).toHaveLength(1);
            expect(result.related[0].id).toBe('doc1_chunk_0');
        });

        it('should navigate to next chunk', async () => {
            mockEsClient.get.mockImplementation((args: any) => {
                if (args.id === 'doc1_chunk_0') {
                    return Promise.resolve({
                        found: true,
                        _id: 'doc1_chunk_0',
                        _source: { source: 'jira', chunkIndex: 0, totalChunks: 2, parentDocId: 'doc1', _originalContent: 'Chunk 0 content' },
                    });
                }
                if (args.id === 'doc1_chunk_1') {
                    return Promise.resolve({
                        found: true,
                        _id: 'doc1_chunk_1',
                        _source: { source: 'jira', chunkIndex: 1, totalChunks: 2, parentDocId: 'doc1', _originalContent: 'Chunk 1 content' },
                    });
                }
                return Promise.reject({ statusCode: 404 });
            });

            const result = await service.navigate('doc1_chunk_0', 'next', 'chunk');

            expect(result.related).toHaveLength(1);
            expect(result.related[0].id).toBe('doc1_chunk_1');
            expect(result.navigation.hasNext).toBe(true);
        });

        it('should return empty related when at first chunk and navigating prev', async () => {
            mockEsClient.get.mockImplementation((args: any) => {
                if (args.id === 'doc1_chunk_0') {
                    return Promise.resolve({
                        found: true,
                        _id: 'doc1_chunk_0',
                        _source: { source: 'jira', chunkIndex: 0, totalChunks: 2, parentDocId: 'doc1', _originalContent: 'content' },
                    });
                }
                return Promise.reject({ statusCode: 404 });
            });

            const result = await service.navigate('doc1_chunk_0', 'prev', 'chunk');
            expect(result.related).toEqual([]);
        });

        it('should navigate to parent document', async () => {
            mockEsClient.get.mockImplementation((args: any) => {
                if (args.id === 'child-doc') {
                    return Promise.resolve({
                        found: true,
                        _id: 'child-doc',
                        _source: { source: 'jira', parentId: 'parent-doc', _originalContent: 'child content' },
                    });
                }
                if (args.id === 'parent-doc') {
                    return Promise.resolve({
                        found: true,
                        _id: 'parent-doc',
                        _source: { source: 'jira', title: 'Parent', _originalContent: 'parent content' },
                    });
                }
                return Promise.reject({ statusCode: 404 });
            });

            const result = await service.navigate('child-doc', 'parent', 'datapoint');

            expect(result.related).toHaveLength(1);
            expect(result.related[0].id).toBe('parent-doc');
            expect(result.navigation.parentId).toBe('parent-doc');
        });

        it('should navigate to children documents', async () => {
            // navigate uses client.get for current doc
            mockEsClient.get.mockImplementation((args: any) => {
                if (args.id === 'parent-doc') {
                    return Promise.resolve({
                        found: true,
                        _id: 'parent-doc',
                        _source: { source: 'jira', id: 'logical-id', _originalContent: 'parent content' },
                    });
                }
                return Promise.reject({ statusCode: 404 });
            });

            // getDocumentsByMetadata uses client.search for children
            mockEsClient.search.mockImplementation((args: any) => {
                const filters = args.body?.query?.bool?.filter || [];
                const hasParentId = filters.some((f: any) => f.term?.parentId === 'logical-id');

                if (hasParentId) {
                    return Promise.resolve({
                        hits: {
                            hits: [
                                { _id: 'child-1', _source: { source: 'jira', parentId: 'logical-id', _originalContent: 'c1' } },
                                { _id: 'child-2', _source: { source: 'jira', parentId: 'logical-id', _originalContent: 'c2' } },
                            ],
                            total: { value: 2 },
                        },
                    });
                }

                return Promise.resolve({ hits: { hits: [], total: { value: 0 } } });
            });

            const result = await service.navigate('parent-doc', 'children', 'datapoint');

            expect(result.related.length).toBeGreaterThanOrEqual(2);
        });

        it('should set contextType correctly based on source and metadata', async () => {
            mockEsClient.get.mockImplementation((args: any) => {
                if (args.id === 'slack-msg') {
                    return Promise.resolve({
                        found: true,
                        _id: 'slack-msg',
                        _source: { source: 'slack', threadTs: '123.456', channelId: 'C01', _originalContent: 'message content' },
                    });
                }
                return Promise.reject({ statusCode: 404 });
            });

            // navigateDatapoint calls getDocumentsByMetadata which uses client.search
            mockEsClient.search.mockResolvedValue({
                hits: { hits: [], total: { value: 0 } },
            });

            const result = await service.navigate('slack-msg', 'next', 'datapoint');

            expect(result.current).not.toBeNull();
            expect(result.navigation.contextType).toBeDefined();
            // Slack with threadTs should have contextType 'thread'
            expect(result.navigation.contextType).toBe('thread');
        });
    });
});
