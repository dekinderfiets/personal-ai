import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import * as path from 'path';
import { BaseConnector } from './base.connector';
import { FileProcessorService, ProcessedFile } from '../indexing/file-processor.service';
import { Cursor, IndexRequest, ConnectorResult, IndexDocument, GitHubDocument, DataSource } from '../types';

interface GitHubRepo {
    id: number;
    full_name: string;
    name: string;
    description: string | null;
    html_url: string;
    owner: { login: string };
    language: string | null;
    topics: string[];
    created_at: string;
    updated_at: string;
    pushed_at: string;
    private: boolean;
    fork: boolean;
    stargazers_count: number;
    default_branch: string;
}

interface GitHubPR {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: string;
    user: { login: string };
    labels: { name: string }[];
    milestone: { title: string } | null;
    assignees: { login: string }[];
    html_url: string;
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    draft: boolean;
    head: { ref: string };
    base: { ref: string };
}

interface GitHubReview {
    id: number;
    user: { login: string };
    body: string | null;
    state: string;
    html_url: string;
    submitted_at: string;
}

interface GitHubComment {
    id: number;
    user: { login: string };
    body: string;
    html_url: string;
    created_at: string;
    updated_at: string;
}

interface GitHubTreeItem {
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url: string;
}

const SKIP_DIRECTORIES = new Set([
    'node_modules', 'vendor', 'dist', 'build', '.git', '__pycache__',
    '.next', 'coverage', '.cache', 'target', 'out', 'bin', 'obj',
    '.gradle', 'venv', '.venv', '.tox', '.mypy_cache', '.pytest_cache',
]);

const SKIP_EXTENSIONS = new Set([
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff',
    // Media
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.webm',
    // Archives
    '.zip', '.tar', '.gz', '.bz2', '.rar', '.7z',
    // Binaries
    '.exe', '.dll', '.so', '.dylib', '.bin',
    // Fonts
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    // Office docs
    '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls',
    // Compiled
    '.pyc', '.class', '.o', '.obj', '.pdb',
    // Lock files
    '.lock',
    // Source maps
    '.map',
]);

const SKIP_FILENAMES = new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'go.sum',
    'Cargo.lock', 'Gemfile.lock', 'composer.lock', 'poetry.lock',
]);

const MAX_FILE_SIZE = 512 * 1024; // 512KB
const FILE_FETCH_BATCH_SIZE = 5;
const FILE_FETCH_BATCH_DELAY = 200;
const FILES_PER_CURSOR_BATCH = 50;

@Injectable()
export class GitHubConnector extends BaseConnector {
    private readonly logger = new Logger(GitHubConnector.name);
    private readonly token: string;
    private readonly username: string;
    private api: AxiosInstance;

    constructor(
        private configService: ConfigService,
        private fileProcessorService: FileProcessorService,
    ) {
        super();
        this.token = this.configService.get<string>('github.token') || '';
        this.username = this.configService.get<string>('github.username') || '';

        this.api = axios.create({
            baseURL: 'https://api.github.com',
            headers: {
                ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });
    }

    getSourceName(): string {
        return 'github';
    }

    isConfigured(): boolean {
        return !!(this.token && this.username);
    }

    async fetch(cursor: Cursor | null, request: IndexRequest): Promise<ConnectorResult> {
        if (!this.isConfigured()) {
            this.logger.warn('GitHub not configured, skipping');
            return { documents: [], newCursor: {}, hasMore: false };
        }

        // Parse sync state from cursor
        let state: {
            phase: 'repos' | 'prs' | 'files';
            repoIdx: number;
            page: number;
            repos: string[];
            repoDefaultBranches: Record<string, string>;
            indexFiles?: boolean;
            fileOffset?: number;
        };

        if (cursor?.syncToken) {
            try {
                state = JSON.parse(cursor.syncToken);
            } catch {
                state = { phase: 'repos', repoIdx: 0, page: 1, repos: [], repoDefaultBranches: {} };
            }
        } else {
            state = { phase: 'repos', repoIdx: 0, page: 1, repos: [], repoDefaultBranches: {} };
        }

        // Always respect the current request's indexFiles setting over stale cursor state
        state.indexFiles = request.indexFiles !== false;

        // Phase 1: Fetch repos list
        if (state.phase === 'repos') {
            const repos = await this.listRepositories(request.repos);
            state.repos = repos.map(r => r.full_name);
            state.repoDefaultBranches = {};
            for (const repo of repos) {
                state.repoDefaultBranches[repo.full_name] = repo.default_branch;
            }
            state.indexFiles = request.indexFiles !== false;
            state.phase = 'prs';
            state.repoIdx = 0;
            state.page = 1;
            state.fileOffset = 0;

            // Create repo documents
            const documents: IndexDocument[] = repos.map(repo => this.repoToDocument(repo));

            return {
                documents,
                newCursor: {
                    source: 'github' as DataSource,
                    syncToken: JSON.stringify(state),
                },
                hasMore: state.repos.length > 0,
                batchLastSync: new Date().toISOString(),
            };
        }

        if (state.repos.length === 0) {
            return { documents: [], newCursor: {}, hasMore: false };
        }

        const repoFullName = state.repos[state.repoIdx];
        const documents: IndexDocument[] = [];

        // Phase 2: Fetch PRs, reviews, and comments
        if (state.phase === 'prs') {
            const { items, hasNextPage } = await this.fetchPullRequests(repoFullName, state.page);

            for (const pr of items) {
                const prDocs = await this.fetchPRDetails(repoFullName, pr);
                documents.push(...prDocs);
            }

            if (hasNextPage) {
                state.page++;
            } else {
                // After PRs, enter files phase if enabled; otherwise advance to next repo
                if (state.indexFiles) {
                    state.phase = 'files';
                    state.page = 1;
                } else {
                    state.repoIdx++;
                    state.page = 1;
                    if (state.repoIdx >= state.repos.length) {
                        state.phase = 'repos';
                        state.repoIdx = 0;
                    }
                }
            }

            const hasMore = state.phase !== 'repos';

            return {
                documents,
                newCursor: {
                    source: 'github' as DataSource,
                    syncToken: hasMore ? JSON.stringify(state) : undefined,
                },
                hasMore,
                batchLastSync: new Date().toISOString(),
            };
        }

        // Phase 3: Fetch file contents from repository
        if (state.phase === 'files') {
            const branch = state.repoDefaultBranches[repoFullName] || 'main';
            const { documents: fileDocs, hasMore: moreFiles, nextOffset } =
                await this.fetchRepoFiles(repoFullName, branch, state.fileOffset || 0);
            documents.push(...fileDocs);

            this.logger.log(`Indexed ${fileDocs.length} files from ${repoFullName} (offset ${state.fileOffset || 0})`);

            if (moreFiles) {
                // More files in this repo
                state.fileOffset = nextOffset;
            } else {
                // Done with this repo's files, move to next repo
                state.repoIdx++;
                state.phase = 'prs';
                state.page = 1;
                state.fileOffset = 0;

                if (state.repoIdx >= state.repos.length) {
                    state.phase = 'repos';
                    state.repoIdx = 0;
                }
            }

            const hasMore = state.phase !== 'repos' || moreFiles;

            return {
                documents,
                newCursor: {
                    source: 'github' as DataSource,
                    syncToken: hasMore ? JSON.stringify(state) : undefined,
                },
                hasMore,
                batchLastSync: new Date().toISOString(),
            };
        }

        return { documents: [], newCursor: {}, hasMore: false };
    }

    async listRepositories(filterRepos?: string[]): Promise<GitHubRepo[]> {
        if (!this.isConfigured()) return [];

        try {
            const repos: GitHubRepo[] = [];
            let page = 1;

            while (true) {
                const response = await this.api.get<GitHubRepo[]>('/user/repos', {
                    params: {
                        sort: 'updated',
                        direction: 'desc',
                        per_page: 100,
                        page,
                        type: 'all',
                    },
                });

                repos.push(...response.data);
                if (response.data.length < 100) break;
                page++;
            }

            if (filterRepos && filterRepos.length > 0) {
                return repos.filter(r => filterRepos.includes(r.full_name) || filterRepos.includes(r.name));
            }

            return repos;
        } catch (error) {
            this.logger.error(`Failed to list repositories: ${(error as Error).message}`);
            return [];
        }
    }

    private repoToDocument(repo: GitHubRepo): GitHubDocument {
        const content = [
            `# ${repo.full_name}`,
            '',
            repo.description || 'No description',
            '',
            `- **Language**: ${repo.language || 'Unknown'}`,
            `- **Topics**: ${repo.topics?.join(', ') || 'None'}`,
            `- **Stars**: ${repo.stargazers_count}`,
            `- **Default Branch**: ${repo.default_branch}`,
            `- **Private**: ${repo.private}`,
            `- **Fork**: ${repo.fork}`,
        ].join('\n');

        return {
            id: `github_repo_${repo.full_name.replace('/', '_')}`,
            source: 'github',
            content,
            metadata: {
                id: `github_repo_${repo.full_name.replace('/', '_')}`,
                source: 'github',
                type: 'repository',
                title: repo.full_name,
                repo: repo.full_name,
                author: repo.owner.login,
                labels: repo.topics || [],
                createdAt: repo.created_at,
                updatedAt: repo.updated_at,
                url: repo.html_url,
            },
        };
    }

    // ----------------------------------------------------------------
    // PR indexing
    // ----------------------------------------------------------------

    private async fetchPullRequests(
        repoFullName: string,
        page: number,
    ): Promise<{ items: GitHubPR[]; hasNextPage: boolean }> {
        try {
            const response = await this.api.get<GitHubPR[]>(`/repos/${repoFullName}/pulls`, {
                params: {
                    state: 'all',
                    sort: 'updated',
                    direction: 'desc',
                    per_page: 50,
                    page,
                },
            });

            return {
                items: response.data,
                hasNextPage: response.data.length === 50,
            };
        } catch (error) {
            this.logger.error(`Failed to fetch PRs for ${repoFullName}: ${(error as Error).message}`);
            return { items: [], hasNextPage: false };
        }
    }

    private async fetchPRDetails(
        repoFullName: string,
        pr: GitHubPR,
    ): Promise<IndexDocument[]> {
        const documents: IndexDocument[] = [this.prToDocument(repoFullName, pr)];

        try {
            // Fetch reviews
            const reviewsResponse = await this.api.get<GitHubReview[]>(
                `/repos/${repoFullName}/pulls/${pr.number}/reviews`,
            );
            for (const review of reviewsResponse.data) {
                if (review.body) {
                    documents.push(this.reviewToDocument(repoFullName, pr.number, pr.title, review));
                }
            }

            // Fetch PR comments
            const commentsResponse = await this.api.get<GitHubComment[]>(
                `/repos/${repoFullName}/pulls/${pr.number}/comments`,
            );
            for (const comment of commentsResponse.data) {
                documents.push(this.commentToDocument(repoFullName, pr.number, pr.title, comment));
            }
        } catch (error) {
            this.logger.warn(`Failed to fetch PR #${pr.number} details for ${repoFullName}: ${(error as Error).message}`);
        }

        return documents;
    }

    private prToDocument(repoFullName: string, pr: GitHubPR): GitHubDocument {
        const content = [
            `# PR [${repoFullName}#${pr.number}] ${pr.title}`,
            '',
            `**State**: ${pr.state}${pr.merged_at ? ' (merged)' : ''}`,
            `**Author**: ${pr.user.login}`,
            `**Branch**: ${pr.head.ref} → ${pr.base.ref}`,
            `**Labels**: ${pr.labels.map(l => l.name).join(', ') || 'None'}`,
            `**Draft**: ${pr.draft}`,
            '',
            pr.body || 'No description',
        ].join('\n');

        return {
            id: `github_pr_${repoFullName.replace('/', '_')}_${pr.number}`,
            source: 'github',
            content,
            metadata: {
                id: `github_pr_${repoFullName.replace('/', '_')}_${pr.number}`,
                source: 'github',
                type: 'pull_request',
                title: pr.title,
                repo: repoFullName,
                number: pr.number,
                state: pr.merged_at ? 'merged' : pr.state,
                author: pr.user.login,
                labels: pr.labels.map(l => l.name),
                milestone: pr.milestone?.title || null,
                assignees: pr.assignees.map(a => a.login),
                createdAt: pr.created_at,
                updatedAt: pr.updated_at,
                url: pr.html_url,
                is_assigned_to_me: pr.assignees.some(a => a.login === this.username),
                is_author: pr.user.login === this.username,
            },
        };
    }

    private reviewToDocument(repoFullName: string, prNumber: number, prTitle: string, review: GitHubReview): GitHubDocument {
        const content = [
            `## PR Review on ${repoFullName}#${prNumber}: ${prTitle}`,
            '',
            `**Reviewer**: ${review.user.login}`,
            `**State**: ${review.state}`,
            '',
            review.body || '',
        ].join('\n');

        return {
            id: `github_review_${repoFullName.replace('/', '_')}_${prNumber}_${review.id}`,
            source: 'github',
            content,
            metadata: {
                id: `github_review_${repoFullName.replace('/', '_')}_${prNumber}_${review.id}`,
                source: 'github',
                type: 'pr_review',
                title: `Review on ${repoFullName}#${prNumber} by ${review.user.login}`,
                repo: repoFullName,
                number: prNumber,
                state: review.state,
                author: review.user.login,
                createdAt: review.submitted_at,
                updatedAt: review.submitted_at,
                url: review.html_url,
                parentId: `github_pr_${repoFullName.replace('/', '_')}_${prNumber}`,
            },
        };
    }

    private commentToDocument(repoFullName: string, prNumber: number, prTitle: string, comment: GitHubComment): GitHubDocument {
        const content = [
            `## PR Comment on ${repoFullName}#${prNumber}: ${prTitle}`,
            '',
            `**Author**: ${comment.user.login}`,
            '',
            comment.body,
        ].join('\n');

        return {
            id: `github_comment_${repoFullName.replace('/', '_')}_${prNumber}_${comment.id}`,
            source: 'github',
            content,
            metadata: {
                id: `github_comment_${repoFullName.replace('/', '_')}_${prNumber}_${comment.id}`,
                source: 'github',
                type: 'pr_comment',
                title: `Comment on ${repoFullName}#${prNumber} by ${comment.user.login}`,
                repo: repoFullName,
                number: prNumber,
                author: comment.user.login,
                createdAt: comment.created_at,
                updatedAt: comment.updated_at,
                url: comment.html_url,
                parentId: `github_pr_${repoFullName.replace('/', '_')}_${prNumber}`,
            },
        };
    }

    // ----------------------------------------------------------------
    // File indexing
    // ----------------------------------------------------------------

    private async fetchRepoFiles(
        repoFullName: string,
        branch: string,
        offset: number = 0,
    ): Promise<{ documents: GitHubDocument[]; hasMore: boolean; nextOffset: number }> {
        const [owner, repo] = repoFullName.split('/');
        const documents: GitHubDocument[] = [];

        try {
            // Get the full file tree in a single API call
            const response = await this.api.get<{ tree: GitHubTreeItem[]; truncated: boolean }>(
                `/repos/${repoFullName}/git/trees/${branch}`,
                { params: { recursive: 1 } },
            );

            const tree = response.data.tree;
            if (response.data.truncated) {
                this.logger.warn(`File tree for ${repoFullName} was truncated by GitHub API`);
            }

            // Filter to indexable files
            const candidateFiles = tree
                .filter(item => item.type === 'blob')
                .filter(item => this.isIndexableFile(item));

            const batch = candidateFiles.slice(offset, offset + FILES_PER_CURSOR_BATCH);

            this.logger.log(
                `Fetching files ${offset + 1}-${offset + batch.length} of ${candidateFiles.length} in ${repoFullName}`,
            );

            // Fetch file contents in batches
            for (let i = 0; i < batch.length; i += FILE_FETCH_BATCH_SIZE) {
                const chunk = batch.slice(i, i + FILE_FETCH_BATCH_SIZE);
                const batchResults = await Promise.allSettled(
                    chunk.map(item => this.fetchFileContent(repoFullName, item, owner, repo, branch)),
                );

                for (const result of batchResults) {
                    if (result.status === 'fulfilled' && result.value) {
                        documents.push(result.value);
                    }
                }

                // Rate limiting delay between batches
                if (i + FILE_FETCH_BATCH_SIZE < batch.length) {
                    await new Promise(resolve => setTimeout(resolve, FILE_FETCH_BATCH_DELAY));
                }
            }

            const nextOffset = offset + FILES_PER_CURSOR_BATCH;
            const hasMore = nextOffset < candidateFiles.length;

            return { documents, hasMore, nextOffset };
        } catch (error) {
            this.logger.error(`Failed to fetch file tree for ${repoFullName}: ${(error as Error).message}`);
            return { documents, hasMore: false, nextOffset: offset };
        }
    }

    private isIndexableFile(item: GitHubTreeItem): boolean {
        // Size check
        if (item.size && item.size > MAX_FILE_SIZE) return false;

        const filePath = item.path;
        const ext = path.extname(filePath).toLowerCase();
        const basename = path.basename(filePath);

        // Skip known binary/non-text extensions
        if (SKIP_EXTENSIONS.has(ext)) return false;

        // Skip minified files
        if (basename.endsWith('.min.js') || basename.endsWith('.min.css')) return false;

        // Skip known lock/generated filenames
        if (SKIP_FILENAMES.has(basename)) return false;

        // Skip files in excluded directories
        const parts = filePath.split('/');
        for (const part of parts) {
            if (SKIP_DIRECTORIES.has(part)) return false;
        }

        return true;
    }

    private async fetchFileContent(
        repoFullName: string,
        item: GitHubTreeItem,
        owner: string,
        repo: string,
        branch: string,
    ): Promise<GitHubDocument | null> {
        try {
            const response = await this.api.get<string>(
                `/repos/${repoFullName}/contents/${item.path}`,
                {
                    headers: { Accept: 'application/vnd.github.raw+json' },
                    responseType: 'text',
                    params: { ref: branch },
                },
            );

            const content = response.data;
            const result = await this.fileProcessorService.process(content, item.path);
            if (!result) return null;

            const ext = path.extname(item.path).toLowerCase();
            const sha7 = item.sha.substring(0, 7);
            const pathHash = crypto.createHash('md5').update(item.path).digest('hex').substring(0, 12);
            const docId = `github_file_${owner}_${repo}_${sha7}_${pathHash}`;
            const now = new Date().toISOString();

            const fileHeader = [
                `# ${item.path}`,
                `Repository: ${repoFullName}`,
                result.language ? `Language: ${result.language}` : '',
                '',
            ].filter(Boolean).join('\n');

            const fullContent = fileHeader + result.content;

            const doc: GitHubDocument = {
                id: docId,
                source: 'github',
                content: fullContent,
                metadata: {
                    id: docId,
                    source: 'github',
                    type: 'file',
                    title: item.path,
                    repo: repoFullName,
                    author: owner,
                    createdAt: now,
                    updatedAt: now,
                    url: `https://github.com/${repoFullName}/blob/${sha7}/${item.path}`,
                    parentId: `github_repo_${repoFullName.replace('/', '_')}`,
                    filePath: item.path,
                    fileExtension: ext,
                    fileLanguage: result.language,
                    fileSha: item.sha,
                    fileSize: item.size,
                },
            };

            if (result.chunks && result.chunks.length > 1) {
                doc.preChunked = { chunks: result.chunks };
            }

            return doc;
        } catch (error) {
            this.logger.warn(`Failed to fetch file ${item.path} from ${repoFullName}: ${(error as Error).message}`);
            return null;
        }
    }
}
