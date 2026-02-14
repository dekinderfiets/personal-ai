import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { ConfluenceConnector } from './confluence.connector';

jest.mock('axios');
jest.mock('html-to-text', () => ({
    convert: jest.fn((html: string) => html ? `[text]${html}` : ''),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ConfluenceConnector', () => {
    let connector: ConfluenceConnector;

    const defaultConfig: Record<string, string> = {
        'confluence.baseUrl': 'https://test.atlassian.net',
        'confluence.username': 'user@test.com',
        'confluence.apiToken': 'api-token',
    };

    function createConnector(overrides: Record<string, string | undefined> = {}) {
        const config = { ...defaultConfig, ...overrides };
        const mockConfigService = {
            get: jest.fn((key: string) => config[key]),
        };
        return new ConfluenceConnector(mockConfigService as any);
    }

    const makePage = (overrides: any = {}) => ({
        id: '12345',
        type: 'page',
        title: 'Test Page',
        space: { key: 'DEV', name: 'Development' },
        history: {
            createdBy: { displayName: 'Alice' },
            createdDate: '2024-01-01T00:00:00.000Z',
            lastUpdated: { when: '2024-01-02T00:00:00.000Z' },
        },
        ancestors: [{ title: 'Parent Page' }],
        metadata: { labels: { results: [{ name: 'doc' }, { name: 'api' }] } },
        body: { storage: { value: '<p>Page content</p>' } },
        _links: { webui: '/display/DEV/Test+Page' },
        ...overrides,
    });

    const makeSearchResponse = (results: any[], hasNext = false, size?: number) => ({
        data: {
            results,
            size: size ?? results.length,
            _links: hasNext ? { next: '/next-page' } : {},
        },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        connector = createConnector();
    });

    describe('getSourceName', () => {
        it('should return "confluence"', () => {
            expect(connector.getSourceName()).toBe('confluence');
        });
    });

    describe('isConfigured', () => {
        it('should return true when all config is present', () => {
            expect(connector.isConfigured()).toBe(true);
        });

        it('should return false when baseUrl is missing', () => {
            expect(createConnector({ 'confluence.baseUrl': undefined }).isConfigured()).toBe(false);
        });

        it('should return false when username is missing', () => {
            expect(createConnector({ 'confluence.username': undefined }).isConfigured()).toBe(false);
        });

        it('should return false when apiToken is missing', () => {
            expect(createConnector({ 'confluence.apiToken': undefined }).isConfigured()).toBe(false);
        });
    });

    describe('fetch', () => {
        it('should return empty result when not configured', async () => {
            const c = createConnector({ 'confluence.baseUrl': undefined });
            const result = await c.fetch(null, {});
            expect(result).toEqual({ documents: [], newCursor: {}, hasMore: false });
        });

        it('should construct CQL with type filter by default', async () => {
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([makePage()]));

            await connector.fetch(null, {});

            const call = mockedAxios.get.mock.calls[0];
            expect(call[1]?.params.cql).toContain('type IN (page, blogpost)');
        });

        it('should include space keys in CQL', async () => {
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([makePage()]));

            await connector.fetch(null, { spaceKeys: ['DEV', 'OPS'] });

            const call = mockedAxios.get.mock.calls[0];
            expect(call[1]?.params.cql).toContain('space IN ("DEV","OPS")');
        });

        it('should include lastSync in CQL for incremental sync', async () => {
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([makePage()]));

            const cursor = { source: 'confluence' as const, lastSync: '2024-06-01T10:30:00.000Z' };
            await connector.fetch(cursor, {});

            const call = mockedAxios.get.mock.calls[0];
            expect(call[1]?.params.cql).toContain('lastModified >= "2024-06-01 10:30"');
        });

        it('should use syncToken as start offset for pagination', async () => {
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([makePage()]));

            const cursor = { source: 'confluence' as const, lastSync: '', syncToken: '50' };
            await connector.fetch(cursor, {});

            const call = mockedAxios.get.mock.calls[0];
            expect(call[1]?.params.start).toBe(50);
        });

        it('should produce correct document structure for pages', async () => {
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([makePage()]));

            const result = await connector.fetch(null, {});

            expect(result.documents).toHaveLength(1);
            const doc = result.documents[0];
            expect(doc.id).toBe('confluence_12345');
            expect(doc.source).toBe('confluence');
            expect(doc.metadata).toMatchObject({
                id: '12345',
                source: 'confluence',
                type: 'page',
                title: 'Test Page',
                space: 'DEV',
                spaceName: 'Development',
                author: 'Alice',
                labels: ['doc', 'api'],
                ancestors: ['Parent Page'],
                url: 'https://test.atlassian.net/wiki/display/DEV/Test+Page',
            });
        });

        it('should index comments as separate documents', async () => {
            const page = {
                ...makePage(),
                children: {
                    comment: {
                        results: [{
                            id: '99',
                            body: { storage: { value: '<p>Comment text</p>' } },
                            history: {
                                createdBy: { displayName: 'Bob' },
                                createdDate: '2024-01-03T00:00:00.000Z',
                                lastUpdated: { when: '2024-01-03T00:00:00.000Z' },
                            },
                        }],
                    },
                },
            };
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([page]));

            const result = await connector.fetch(null, {});

            const commentDoc = result.documents.find(d => d.metadata.type === 'comment');
            expect(commentDoc).toBeDefined();
            expect(commentDoc!.id).toBe('confluence_comment_99');
            expect(commentDoc!.metadata).toMatchObject({
                type: 'comment',
                parentId: '12345',
                author: 'Bob',
                ancestors: ['Parent Page', 'Test Page'],
            });
        });

        it('should set hasMore=true when next link is present and not cycling', async () => {
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([makePage()], true, 50));

            const result = await connector.fetch(null, {});

            expect(result.hasMore).toBe(true);
            expect(result.newCursor.syncToken).toBeDefined();
        });

        it('should set hasMore=false when no next link', async () => {
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([makePage()], false));

            const result = await connector.fetch(null, {});

            expect(result.hasMore).toBe(false);
        });

        it('should detect cycling and stop', async () => {
            const page = makePage();

            // First call: sees page for the first time
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([page], true, 50));
            await connector.fetch(null, {});

            // Second call: sees the same page again → cycling detected
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([page], true, 50));
            const cursor = { source: 'confluence' as const, lastSync: '', syncToken: '50' };
            const result = await connector.fetch(cursor, {});

            expect(result.hasMore).toBe(false);
        });

        it('should set batchLastSync from last page updatedAt', async () => {
            const page = makePage({
                history: {
                    createdBy: { displayName: 'Alice' },
                    createdDate: '2024-01-01T00:00:00.000Z',
                    lastUpdated: { when: '2024-06-15T12:00:00.000Z' },
                },
            });
            mockedAxios.get.mockResolvedValueOnce(makeSearchResponse([page]));

            const result = await connector.fetch(null, {});
            expect(result.batchLastSync).toBe('2024-06-15T12:00:00.000Z');
        });

        it('should throw on API error', async () => {
            mockedAxios.get.mockRejectedValueOnce(new Error('API error'));
            mockedAxios.isAxiosError.mockReturnValue(false);

            await expect(connector.fetch(null, {})).rejects.toThrow('API error');
        });
    });
});
