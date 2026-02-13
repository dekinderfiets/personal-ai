import { GitHubConnector } from './github.connector';
import { ConfigService } from '@nestjs/config';
import { FileProcessorService } from '../indexing/file-processor.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GitHubConnector', () => {
    let connector: GitHubConnector;
    let mockFileProcessor: { process: jest.Mock };
    let mockApiGet: jest.Mock;

    const githubConfig: Record<string, string> = {
        'github.token': 'ghp_test_token',
        'github.username': 'testuser',
    };

    beforeEach(() => {
        jest.clearAllMocks();

        mockApiGet = jest.fn();
        mockedAxios.create.mockReturnValue({
            get: mockApiGet,
            defaults: {},
            interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
        } as any);

        const mockConfigService = {
            get: jest.fn((key: string) => githubConfig[key]),
        };
        mockFileProcessor = {
            process: jest.fn().mockResolvedValue({ content: 'processed', chunks: undefined, language: 'js' }),
        };

        connector = new GitHubConnector(mockConfigService as any, mockFileProcessor as any);
    });

    describe('getSourceName', () => {
        it('should return "github"', () => {
            expect(connector.getSourceName()).toBe('github');
        });
    });

    describe('isConfigured', () => {
        it('should return true when token and username are set', () => {
            expect(connector.isConfigured()).toBe(true);
        });

        it('should return false when token is missing', () => {
            const cfg = { get: jest.fn((key: string) => key === 'github.username' ? 'user' : '') };
            const c = new GitHubConnector(cfg as any, mockFileProcessor as any);
            expect(c.isConfigured()).toBe(false);
        });

        it('should return false when username is missing', () => {
            const cfg = { get: jest.fn((key: string) => key === 'github.token' ? 'token' : '') };
            const c = new GitHubConnector(cfg as any, mockFileProcessor as any);
            expect(c.isConfigured()).toBe(false);
        });
    });

    describe('fetch', () => {
        it('should return empty result when not configured', async () => {
            const cfg = { get: jest.fn().mockReturnValue('') };
            const c = new GitHubConnector(cfg as any, mockFileProcessor as any);
            const result = await c.fetch(null, {});
            expect(result).toEqual({ documents: [], newCursor: {}, hasMore: false });
        });

        describe('phase: repos', () => {
            it('should list repos and create repo documents', async () => {
                mockApiGet.mockResolvedValueOnce({
                    data: [{
                        id: 1,
                        full_name: 'testuser/repo1',
                        name: 'repo1',
                        description: 'A test repo',
                        html_url: 'https://github.com/testuser/repo1',
                        owner: { login: 'testuser' },
                        language: 'TypeScript',
                        topics: ['test', 'demo'],
                        created_at: '2024-01-01T00:00:00Z',
                        updated_at: '2024-06-01T00:00:00Z',
                        pushed_at: '2024-06-01T00:00:00Z',
                        private: false,
                        fork: false,
                        stargazers_count: 42,
                        default_branch: 'main',
                    }],
                });

                const result = await connector.fetch(null, {});

                expect(result.documents.length).toBe(1);
                const doc = result.documents[0];
                expect(doc.id).toBe('github_repo_testuser_repo1');
                expect(doc.source).toBe('github');
                expect(doc.metadata).toMatchObject({
                    type: 'repository',
                    title: 'testuser/repo1',
                    repo: 'testuser/repo1',
                    author: 'testuser',
                    labels: ['test', 'demo'],
                });
                expect(doc.content).toContain('testuser/repo1');
                expect(doc.content).toContain('TypeScript');
                expect(doc.content).toContain('42');

                // Should transition to prs phase
                const state = JSON.parse(result.newCursor.syncToken!);
                expect(state.phase).toBe('prs');
                expect(state.repos).toEqual(['testuser/repo1']);
            });
        });

        describe('phase: prs', () => {
            const makePRsState = () => JSON.stringify({
                phase: 'prs',
                repoIdx: 0,
                page: 1,
                repos: ['testuser/repo1'],
                repoDefaultBranches: { 'testuser/repo1': 'main' },
                indexFiles: true,
            });

            it('should fetch PRs with reviews and comments', async () => {
                mockApiGet.mockImplementation(async (url: string) => {
                    if (url.includes('/pulls') && !url.includes('/reviews') && !url.includes('/comments')) {
                        return {
                            data: [{
                                id: 200,
                                number: 5,
                                title: 'Feature PR',
                                body: 'Adds feature',
                                state: 'open',
                                user: { login: 'testuser' },
                                labels: [{ name: 'feature' }],
                                milestone: null,
                                assignees: [],
                                html_url: 'https://github.com/testuser/repo1/pull/5',
                                created_at: '2024-01-01T00:00:00Z',
                                updated_at: '2024-01-02T00:00:00Z',
                                merged_at: null,
                                draft: false,
                                head: { ref: 'feature-branch' },
                                base: { ref: 'main' },
                            }],
                        };
                    }
                    if (url.includes('/reviews')) {
                        return {
                            data: [{
                                id: 300,
                                user: { login: 'reviewer' },
                                body: 'LGTM',
                                state: 'APPROVED',
                                html_url: 'https://github.com/testuser/repo1/pull/5#pullrequestreview-300',
                                submitted_at: '2024-01-03T00:00:00Z',
                            }],
                        };
                    }
                    if (url.includes('/comments')) {
                        return {
                            data: [{
                                id: 400,
                                user: { login: 'commenter' },
                                body: 'Nice work!',
                                html_url: 'https://github.com/testuser/repo1/pull/5#discussion_r400',
                                created_at: '2024-01-04T00:00:00Z',
                                updated_at: '2024-01-04T00:00:00Z',
                            }],
                        };
                    }
                    return { data: [] };
                });

                const cursor = {
                    source: 'github' as const,
                    lastSync: '2024-01-01',
                    syncToken: makePRsState(),
                };
                const result = await connector.fetch(cursor, {});

                expect(result.documents.length).toBe(3);

                const prDoc = result.documents.find(d => d.metadata.type === 'pull_request');
                expect(prDoc).toBeDefined();
                expect(prDoc!.id).toBe('github_pr_testuser_repo1_5');
                expect(prDoc!.content).toContain('feature-branch');

                const reviewDoc = result.documents.find(d => d.metadata.type === 'pr_review');
                expect(reviewDoc).toBeDefined();
                expect(reviewDoc!.metadata.author).toBe('reviewer');

                const commentDoc = result.documents.find(d => d.metadata.type === 'pr_comment');
                expect(commentDoc).toBeDefined();
                expect(commentDoc!.metadata.author).toBe('commenter');
            });

            it('should transition to files phase after PRs when indexFiles is true', async () => {
                mockApiGet.mockResolvedValueOnce({ data: [] }); // no PRs

                const cursor = {
                    source: 'github' as const,
                    lastSync: '',
                    syncToken: makePRsState(),
                };
                const result = await connector.fetch(cursor, {});

                const newState = JSON.parse(result.newCursor.syncToken!);
                expect(newState.phase).toBe('files');
            });

            it('should skip files phase when indexFiles is false', async () => {
                const state = JSON.stringify({
                    phase: 'prs',
                    repoIdx: 0,
                    page: 1,
                    repos: ['testuser/repo1'],
                    repoDefaultBranches: { 'testuser/repo1': 'main' },
                    indexFiles: false,
                });
                mockApiGet.mockResolvedValueOnce({ data: [] }); // no PRs

                const result = await connector.fetch(
                    { source: 'github' as const, lastSync: '', syncToken: state },
                    { indexFiles: false },
                );

                // Single repo, no more phases -> done
                expect(result.hasMore).toBe(false);
            });
        });

        describe('phase: files', () => {
            const makeFilesState = () => JSON.stringify({
                phase: 'files',
                repoIdx: 0,
                page: 1,
                repos: ['testuser/repo1'],
                repoDefaultBranches: { 'testuser/repo1': 'main' },
                indexFiles: true,
            });

            it('should fetch and index repository files', async () => {
                mockApiGet.mockImplementation(async (url: string) => {
                    if (url.includes('/git/trees/')) {
                        return {
                            data: {
                                tree: [
                                    { path: 'src/index.ts', type: 'blob', sha: 'abc1234', size: 100 },
                                    { path: 'node_modules/pkg/index.js', type: 'blob', sha: 'def5678', size: 50 },
                                ],
                                truncated: false,
                            },
                        };
                    }
                    if (url.includes('/contents/src/index.ts')) {
                        return { data: 'const x = 1;' };
                    }
                    return { data: {} };
                });

                mockFileProcessor.process.mockResolvedValueOnce({ content: 'const x = 1;', language: 'ts' });

                const cursor = {
                    source: 'github' as const,
                    lastSync: '2024-01-01',
                    syncToken: makeFilesState(),
                };
                const result = await connector.fetch(cursor, {});

                // node_modules should be filtered out by SKIP_DIRECTORIES
                expect(result.documents.length).toBe(1);
                const doc = result.documents[0];
                expect(doc.metadata.type).toBe('file');
                expect(doc.metadata.filePath).toBe('src/index.ts');
            });

            it('should set preChunked when content has multiple chunks', async () => {
                mockApiGet.mockImplementation(async (url: string) => {
                    if (url.includes('/git/trees/')) {
                        return {
                            data: {
                                tree: [{ path: 'big-file.ts', type: 'blob', sha: 'abc1234', size: 100 }],
                                truncated: false,
                            },
                        };
                    }
                    if (url.includes('/contents/big-file.ts')) {
                        return { data: 'lots of code' };
                    }
                    return { data: {} };
                });

                mockFileProcessor.process.mockResolvedValueOnce({ content: 'lots of code', chunks: ['chunk1', 'chunk2', 'chunk3'], language: 'ts' });

                const cursor = {
                    source: 'github' as const,
                    lastSync: '2024-01-01',
                    syncToken: makeFilesState(),
                };
                const result = await connector.fetch(cursor, {});

                expect(result.documents.length).toBe(1);
                expect(result.documents[0].preChunked).toEqual({ chunks: ['chunk1', 'chunk2', 'chunk3'] });
            });

            it('should NOT set preChunked when content is a single chunk', async () => {
                mockApiGet.mockImplementation(async (url: string) => {
                    if (url.includes('/git/trees/')) {
                        return {
                            data: {
                                tree: [{ path: 'small.ts', type: 'blob', sha: 'abc1234', size: 50 }],
                                truncated: false,
                            },
                        };
                    }
                    if (url.includes('/contents/small.ts')) {
                        return { data: 'const x = 1;' };
                    }
                    return { data: {} };
                });

                mockFileProcessor.process.mockResolvedValueOnce({ content: 'const x = 1;', language: 'ts' });

                const cursor = {
                    source: 'github' as const,
                    lastSync: '2024-01-01',
                    syncToken: makeFilesState(),
                };
                const result = await connector.fetch(cursor, {});

                expect(result.documents.length).toBe(1);
                expect(result.documents[0].preChunked).toBeUndefined();
            });
        });
    });

    describe('isIndexableFile', () => {
        const makeItem = (path: string, size?: number) => ({
            path,
            mode: '100644',
            type: 'blob' as const,
            sha: 'abc123',
            size,
            url: '',
        });

        it('should accept normal source files', () => {
            expect((connector as any).isIndexableFile(makeItem('src/app.ts'))).toBe(true);
            expect((connector as any).isIndexableFile(makeItem('README.md'))).toBe(true);
            expect((connector as any).isIndexableFile(makeItem('Dockerfile'))).toBe(true);
        });

        it('should skip files in SKIP_DIRECTORIES', () => {
            expect((connector as any).isIndexableFile(makeItem('node_modules/pkg/index.js'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('dist/bundle.js'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('.git/config'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('vendor/lib/utils.rb'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('build/output.js'))).toBe(false);
        });

        it('should skip files with SKIP_EXTENSIONS', () => {
            expect((connector as any).isIndexableFile(makeItem('image.png'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('video.mp4'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('archive.zip'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('font.woff2'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('styles.css.map'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('deps.lock'))).toBe(false);
        });

        it('should skip SKIP_FILENAMES', () => {
            expect((connector as any).isIndexableFile(makeItem('package-lock.json'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('yarn.lock'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('pnpm-lock.yaml'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('go.sum'))).toBe(false);
        });

        it('should skip minified files', () => {
            expect((connector as any).isIndexableFile(makeItem('app.min.js'))).toBe(false);
            expect((connector as any).isIndexableFile(makeItem('styles.min.css'))).toBe(false);
        });

        it('should skip files exceeding MAX_FILE_SIZE', () => {
            expect((connector as any).isIndexableFile(makeItem('huge.ts', 600 * 1024))).toBe(false);
        });

        it('should accept files at or under MAX_FILE_SIZE', () => {
            expect((connector as any).isIndexableFile(makeItem('normal.ts', 100 * 1024))).toBe(true);
        });
    });
});
