import { JiraConnector } from './jira.connector';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

jest.mock('axios');
jest.mock('html-to-text', () => ({
    convert: jest.fn((html: string) => html ? `[text]${html}` : ''),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('JiraConnector', () => {
    let connector: JiraConnector;

    const defaultConfig: Record<string, string> = {
        'jira.baseUrl': 'https://test.atlassian.net',
        'jira.username': 'user@test.com',
        'jira.apiToken': 'api-token-123',
        'jira.sprintFieldId': 'customfield_10020',
    };

    function createConnector(overrides: Record<string, string | undefined> = {}) {
        const config = { ...defaultConfig, ...overrides };
        const mockConfigService = {
            get: jest.fn((key: string) => config[key]),
        };
        return new JiraConnector(mockConfigService as any);
    }

    const makeIssue = (overrides: { fields?: any; renderedFields?: any; [key: string]: any } = {}) => {
        const { fields: fieldOverrides, renderedFields: rfOverrides, ...rest } = overrides;
        return {
            id: '10001',
            key: 'PROJ-1',
            ...rest,
            fields: {
                summary: 'Test issue',
                description: 'A description',
                issuetype: { name: 'Story' },
                status: { name: 'In Progress' },
                priority: { name: 'High' },
                assignee: { displayName: 'Alice' },
                reporter: { displayName: 'Bob' },
                labels: ['bug', 'urgent'],
                components: [{ name: 'Backend' }],
                project: { key: 'PROJ' },
                created: '2024-01-01T00:00:00.000Z',
                updated: '2024-01-02T00:00:00.000Z',
                comment: { comments: [] },
                issuelinks: [],
                customfield_10020: null,
                ...fieldOverrides,
            },
            renderedFields: {
                description: '<p>Rendered description</p>',
                comment: { comments: [] },
                ...rfOverrides,
            },
        };
    };

    const makeSearchResponse = (issues: any[], nextPageToken?: string) => ({
        data: {
            issues,
            total: issues.length,
            maxResults: 100,
            nextPageToken,
        },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        connector = createConnector();
    });

    describe('getSourceName', () => {
        it('should return "jira"', () => {
            expect(connector.getSourceName()).toBe('jira');
        });
    });

    describe('isConfigured', () => {
        it('should return true when all config is present', () => {
            expect(connector.isConfigured()).toBe(true);
        });

        it('should return false when baseUrl is missing', () => {
            const c = createConnector({ 'jira.baseUrl': undefined });
            expect(c.isConfigured()).toBe(false);
        });

        it('should return false when username is missing', () => {
            const c = createConnector({ 'jira.username': undefined });
            expect(c.isConfigured()).toBe(false);
        });

        it('should return false when apiToken is missing', () => {
            const c = createConnector({ 'jira.apiToken': undefined });
            expect(c.isConfigured()).toBe(false);
        });
    });

    describe('fetch', () => {
        it('should return empty result when not configured', async () => {
            const c = createConnector({ 'jira.baseUrl': undefined });
            const result = await c.fetch(null, {});
            expect(result).toEqual({ documents: [], newCursor: {}, hasMore: false });
        });

        it('should construct JQL with default date bound when no filters', async () => {
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([makeIssue()]));

            await connector.fetch(null, {});

            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://test.atlassian.net/rest/api/3/search/jql',
                expect.objectContaining({
                    jql: 'updated >= -365d ORDER BY updated ASC',
                }),
                expect.any(Object),
            );
        });

        it('should include project keys in JQL', async () => {
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([makeIssue()]));

            await connector.fetch(null, { projectKeys: ['PROJ', 'TEAM'] });

            const call = mockedAxios.post.mock.calls[0];
            expect((call[1] as any).jql).toContain('project IN (PROJ,TEAM)');
        });

        it('should add lastSync condition for incremental sync', async () => {
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([makeIssue()]));

            const cursor = { source: 'jira' as const, lastSync: '2024-06-01T10:30:00.000Z' };
            await connector.fetch(cursor, {});

            const call = mockedAxios.post.mock.calls[0];
            expect((call[1] as any).jql).toContain('updated >= "2024-06-01 10:30"');
        });

        it('should combine project keys and lastSync in JQL', async () => {
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([makeIssue()]));

            const cursor = { source: 'jira' as const, lastSync: '2024-06-01T10:30:00.000Z' };
            await connector.fetch(cursor, { projectKeys: ['PROJ'] });

            const call = mockedAxios.post.mock.calls[0];
            expect((call[1] as any).jql).toContain('project IN (PROJ)');
            expect((call[1] as any).jql).toContain('updated >= "2024-06-01 10:30"');
            expect((call[1] as any).jql).toContain('AND');
        });

        it('should skip lastSync filter on fullReindex and use default date bound', async () => {
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([makeIssue()]));

            const cursor = { source: 'jira' as const, lastSync: '2024-06-01T10:30:00.000Z' };
            await connector.fetch(cursor, { fullReindex: true });

            const call = mockedAxios.post.mock.calls[0];
            // fullReindex skips the lastSync condition, but -365d fallback is added
            expect((call[1] as any).jql).not.toContain('2024-06-01');
            expect((call[1] as any).jql).toContain('updated >= -365d');
        });

        it('should reuse JQL from cursor metadata when paginating with nextPageToken', async () => {
            const savedJql = 'project IN (OLD) ORDER BY updated ASC';
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([makeIssue()]));

            const cursor = {
                source: 'jira' as const,
                lastSync: '2024-01-01T00:00:00.000Z',
                syncToken: 'some-page-token',
                metadata: { jql: savedJql },
            };
            await connector.fetch(cursor, { projectKeys: ['NEW'] });

            const call = mockedAxios.post.mock.calls[0];
            // Should use the saved JQL, not build a new one with 'NEW'
            expect((call[1] as any).jql).toBe(savedJql);
            expect((call[1] as any).nextPageToken).toBe('some-page-token');
        });

        it('should produce correct document structure', async () => {
            const issue = makeIssue();
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([issue]));

            const result = await connector.fetch(null, {});

            expect(result.documents.length).toBeGreaterThanOrEqual(1);
            const doc = result.documents[0];
            expect(doc.id).toBe('PROJ-1');
            expect(doc.source).toBe('jira');
            expect(doc.metadata).toMatchObject({
                id: 'PROJ-1',
                source: 'jira',
                type: 'issue',
                title: 'Test issue',
                project: 'PROJ',
                issueType: 'Story',
                status: 'In Progress',
                priority: 'High',
                assignee: 'Alice',
                reporter: 'Bob',
                labels: ['bug', 'urgent'],
                components: ['Backend'],
                url: 'https://test.atlassian.net/browse/PROJ-1',
            });
        });

        it('should index comments as separate documents', async () => {
            const issue = makeIssue({
                fields: {
                    comment: {
                        comments: [{
                            id: '100',
                            body: 'Plain comment text',
                            author: { displayName: 'Carol' },
                            created: '2024-01-03T00:00:00.000Z',
                            updated: '2024-01-03T00:00:00.000Z',
                        }],
                    },
                },
                renderedFields: {
                    description: '<p>desc</p>',
                    comment: {
                        comments: [{ id: '100', body: '<p>Rendered comment</p>' }],
                    },
                },
            });
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([issue]));

            const result = await connector.fetch(null, {});

            const commentDoc = result.documents.find(d => d.metadata.type === 'comment');
            expect(commentDoc).toBeDefined();
            expect(commentDoc!.id).toBe('PROJ-1_comment_100');
            expect(commentDoc!.metadata).toMatchObject({
                type: 'comment',
                parentId: 'PROJ-1',
                reporter: 'Carol',
            });
            // Should use rendered HTML (converted via html-to-text mock)
            expect(commentDoc!.content).toContain('Carol');
        });

        it('should use plain text comment body when no rendered version', async () => {
            const issue = makeIssue({
                fields: {
                    comment: {
                        comments: [{
                            id: '200',
                            body: 'Plain body text',
                            author: { displayName: 'Dave' },
                            created: '2024-01-04T00:00:00.000Z',
                            updated: '2024-01-04T00:00:00.000Z',
                        }],
                    },
                },
                renderedFields: {
                    description: null,
                    comment: { comments: [] }, // No matching rendered comment
                },
            });
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([issue]));

            const result = await connector.fetch(null, {});
            const commentDoc = result.documents.find(d => d.metadata.type === 'comment');
            expect(commentDoc!.content).toContain('Plain body text');
        });

        it('should set hasMore=true when nextPageToken present', async () => {
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([makeIssue()], 'next-token'));

            const result = await connector.fetch(null, {});

            expect(result.hasMore).toBe(true);
            expect(result.newCursor.syncToken).toBe('next-token');
            expect(result.newCursor.metadata).toEqual({ jql: expect.any(String) });
        });

        it('should set hasMore=false when no nextPageToken', async () => {
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([makeIssue()]));

            const result = await connector.fetch(null, {});

            expect(result.hasMore).toBe(false);
            expect(result.newCursor.syncToken).toBeUndefined();
            expect(result.newCursor.metadata).toBeUndefined();
        });

        it('should handle stale token 400 error gracefully', async () => {
            const axiosError = new Error('Bad Request') as any;
            axiosError.response = { status: 400, data: {} };
            axiosError.isAxiosError = true;
            mockedAxios.post.mockRejectedValueOnce(axiosError);
            mockedAxios.isAxiosError.mockReturnValue(true);

            const cursor = {
                source: 'jira' as const,
                lastSync: '2024-01-01T00:00:00.000Z',
                syncToken: 'stale-token',
                metadata: { jql: 'some jql' },
            };
            const result = await connector.fetch(cursor, {});

            expect(result.documents).toEqual([]);
            expect(result.hasMore).toBe(false);
            expect(result.newCursor.syncToken).toBeUndefined();
            expect(result.newCursor.lastSync).toBe('2024-01-01T00:00:00.000Z');
        });

        it('should throw non-400 errors', async () => {
            const axiosError = new Error('Server Error') as any;
            axiosError.response = { status: 500, data: {} };
            axiosError.isAxiosError = true;
            mockedAxios.post.mockRejectedValueOnce(axiosError);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(connector.fetch(null, {})).rejects.toThrow('Server Error');
        });

        it('should set batchLastSync from last issue updated time', async () => {
            const issue = makeIssue({ fields: { updated: '2024-06-15T12:00:00.000Z' } });
            mockedAxios.post.mockResolvedValueOnce(makeSearchResponse([issue]));

            const result = await connector.fetch(null, {});
            expect(result.batchLastSync).toBe('2024-06-15T12:00:00.000Z');
        });
    });

    describe('buildIssueContent', () => {
        it('should format issue content with metadata', () => {
            const issue = makeIssue();
            const content = (connector as any).buildIssueContent(issue);

            expect(content).toContain('# [PROJ-1] Test issue');
            expect(content).toContain('**Type**: Story');
            expect(content).toContain('**Status**: In Progress');
            expect(content).toContain('**Priority**: High');
            expect(content).toContain('**Project**: PROJ');
            expect(content).toContain('**Assignee**: Alice');
            expect(content).toContain('**Reporter**: Bob');
            expect(content).toContain('**Labels**: bug, urgent');
        });

        it('should omit assignee when null', () => {
            const issue = makeIssue({ fields: { assignee: null } });
            const content = (connector as any).buildIssueContent(issue);
            expect(content).not.toContain('**Assignee**');
        });

        it('should include rendered description when available', () => {
            const issue = makeIssue({
                renderedFields: { description: '<p>HTML desc</p>' },
            });
            const content = (connector as any).buildIssueContent(issue);
            expect(content).toContain('## Description');
        });

        it('should use plain text description when no rendered version', () => {
            const issue = makeIssue({
                fields: { description: 'Plain desc' },
                renderedFields: { description: null },
            });
            const content = (connector as any).buildIssueContent(issue);
            expect(content).toContain('Plain desc');
        });
    });

    describe('getSprintName', () => {
        it('should return last sprint name from array', () => {
            const sprints = [{ name: 'Sprint 1' }, { name: 'Sprint 2' }, { name: 'Sprint 3' }];
            expect((connector as any).getSprintName(sprints)).toBe('Sprint 3');
        });

        it('should return null for null input', () => {
            expect((connector as any).getSprintName(null)).toBeNull();
        });

        it('should return null for undefined input', () => {
            expect((connector as any).getSprintName(undefined)).toBeNull();
        });

        it('should return null for empty array', () => {
            expect((connector as any).getSprintName([])).toBeNull();
        });

        it('should return the only sprint name for single-element array', () => {
            expect((connector as any).getSprintName([{ name: 'Only Sprint' }])).toBe('Only Sprint');
        });
    });

    describe('extractLinkedIssues', () => {
        it('should extract inward links', () => {
            const links = [{
                type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
                inwardIssue: { key: 'PROJ-2' },
            }];
            const result = (connector as any).extractLinkedIssues(links);
            expect(result).toEqual([{ type: 'Blocks', key: 'PROJ-2', direction: 'inward' }]);
        });

        it('should extract outward links', () => {
            const links = [{
                type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
                outwardIssue: { key: 'PROJ-3' },
            }];
            const result = (connector as any).extractLinkedIssues(links);
            expect(result).toEqual([{ type: 'Blocks', key: 'PROJ-3', direction: 'outward' }]);
        });

        it('should handle mixed inward and outward links', () => {
            const links = [
                { type: { name: 'Blocks', inward: '', outward: '' }, inwardIssue: { key: 'A-1' } },
                { type: { name: 'Relates', inward: '', outward: '' }, outwardIssue: { key: 'B-2' } },
            ];
            const result = (connector as any).extractLinkedIssues(links);
            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({ key: 'A-1', direction: 'inward' });
            expect(result[1]).toMatchObject({ key: 'B-2', direction: 'outward' });
        });

        it('should return empty array for null/undefined/empty', () => {
            expect((connector as any).extractLinkedIssues(null)).toEqual([]);
            expect((connector as any).extractLinkedIssues(undefined)).toEqual([]);
            expect((connector as any).extractLinkedIssues([])).toEqual([]);
        });

        it('should filter out links with neither inward nor outward issue', () => {
            const links = [{ type: { name: 'Orphan', inward: '', outward: '' } }];
            const result = (connector as any).extractLinkedIssues(links);
            expect(result).toEqual([]);
        });
    });

    describe('fetchIssue', () => {
        it('should return empty array when not configured', async () => {
            const c = createConnector({ 'jira.baseUrl': undefined });
            const result = await c.fetchIssue('PROJ-1');
            expect(result).toEqual([]);
        });

        it('should return empty array on 404', async () => {
            const error = new Error('Not found') as any;
            error.response = { status: 404 };
            error.isAxiosError = true;
            mockedAxios.get.mockRejectedValueOnce(error);
            mockedAxios.isAxiosError.mockReturnValue(true);

            const result = await connector.fetchIssue('PROJ-999');
            expect(result).toEqual([]);
        });
    });
});
