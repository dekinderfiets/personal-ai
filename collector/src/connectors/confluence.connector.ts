import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { convert } from 'html-to-text';
import { BaseConnector } from './base.connector';
import { Cursor, IndexRequest, ConnectorResult, IndexDocument, DataSource } from '../types';

interface ConfluencePage {
    id: string;
    type: string;
    title: string;
    space: { key: string; name: string; };
    history: {
        createdBy: { displayName: string };
        createdDate: string;
        lastUpdated?: { when: string; };
    };
    ancestors?: Array<{ title: string }>;
    metadata?: { labels?: { results: Array<{ name: string }>; }; };
    body?: { storage?: { value: string }; };
    _links: { webui: string; };
}

@Injectable()
export class ConfluenceConnector extends BaseConnector {
    private readonly logger = new Logger(ConfluenceConnector.name);
    private readonly pageSize = 50;
    private baseUrl: string;
    private authHeader: string;
    private seenPageIds = new Set<string>();

    constructor(private configService: ConfigService) {
        super();
        this.baseUrl = this.configService.get<string>('confluence.baseUrl')!.replace(/\/+$/, '');
        const username = this.configService.get<string>('confluence.username');
        const apiToken = this.configService.get<string>('confluence.apiToken');

        if (this.baseUrl && username && apiToken) {
            const token = Buffer.from(`${username}:${apiToken}`).toString('base64');
            this.authHeader = `Basic ${token}`;
        }
    }

    getSourceName(): string {
        return 'confluence';
    }

    isConfigured(): boolean {
        return !!(this.baseUrl && this.authHeader);
    }

    async fetch(cursor: Cursor | null, request: IndexRequest): Promise<ConnectorResult> {
        if (!this.isConfigured()) {
            this.logger.warn('Confluence not configured, skipping');
            return { documents: [], newCursor: {}, hasMore: false };
        }

        const documents: IndexDocument[] = [];
        const start = cursor?.syncToken ? parseInt(cursor.syncToken) : 0;

        const conditions = ['type IN (page, blogpost)'];
        if (request.spaceKeys?.length) {
            conditions.push(`space IN (${request.spaceKeys.map(k => `"${k}"`).join(',')})`);
        }
        if (cursor?.lastSync && !request.fullReindex) {
            // Confluence CQL format: "YYYY-MM-DD HH:mm" or "YYYY/MM/DD HH:mm"
            const lastSync = new Date(cursor.lastSync).toISOString().replace('T', ' ').slice(0, 16);
            conditions.push(`lastModified >= "${lastSync}"`);
        }
        const cql = `${conditions.join(' AND ')} ORDER BY lastModified asc`; // oldest first

        try {
            const response = await axios.get(
                `${this.baseUrl}/wiki/rest/api/content/search`, {
                headers: { 'Authorization': this.authHeader, 'Accept': 'application/json' },
                params: {
                    cql,
                    start,
                    limit: this.pageSize,
                    expand: 'body.storage,history,space,ancestors,metadata.labels,_links.webui,children.comment.body.storage,children.comment.history,children.comment.history.lastUpdated',
                },
                timeout: 30000,
            });

            for (const page of response.data.results as ConfluencePage[]) {
                // Index the page itself
                const content = this.extractTextContent(page);
                documents.push({
                    id: `confluence_${page.id}`,
                    source: 'confluence',
                    content,
                    metadata: {
                        id: page.id,
                        source: 'confluence',
                        type: page.type as 'page' | 'blogpost',
                        title: page.title,
                        space: page.space.key,
                        spaceName: page.space.name,
                        author: page.history.createdBy.displayName,
                        labels: page.metadata?.labels?.results.map(l => l.name) || [],
                        ancestors: page.ancestors?.map(a => a.title) || [],
                        createdAt: page.history.createdDate,
                        updatedAt: page.history.lastUpdated?.when || page.history.createdDate,
                        url: `${this.baseUrl}/wiki${page._links.webui}`,
                    },
                });

                // Index comments if available in expansion
                const comments = (page as any).children?.comment?.results;
                if (comments && Array.isArray(comments)) {
                    for (const comment of comments) {
                        const commentContent = this.stripHtml(comment.body?.storage?.value || '');
                        if (!commentContent.trim()) continue;

                        documents.push({
                            id: `confluence_comment_${comment.id}`,
                            source: 'confluence',
                            content: `Comment on ${page.title} by ${comment.history?.createdBy?.displayName || 'Unknown'}:\n${commentContent}`,
                            metadata: {
                                id: comment.id,
                                source: 'confluence',
                                type: 'comment',
                                parentId: page.id,
                                title: `Comment on ${page.title}`,
                                space: page.space.key,
                                spaceName: page.space.name,
                                author: comment.history?.createdBy?.displayName || 'Unknown',
                                labels: [],
                                ancestors: [...(page.ancestors?.map(a => a.title) || []), page.title],
                                createdAt: comment.history?.createdDate,
                                updatedAt: comment.history?.lastUpdated?.when || comment.history?.createdDate,
                                url: `${this.baseUrl}/wiki${page._links.webui}?focusedCommentId=${comment.id}#comment-${comment.id}`,
                            },
                        });
                    }
                }
            }

            // Detect cycling: Confluence API may return the same results after exhausting all pages
            const pageIds = (response.data.results as ConfluencePage[]).map(p => p.id);
            const allSeen = pageIds.length > 0 && pageIds.every(id => this.seenPageIds.has(id));
            pageIds.forEach(id => this.seenPageIds.add(id));

            const hasNextLink = !!response.data._links?.next;
            const isLastPage = allSeen || !hasNextLink || response.data.size < this.pageSize;
            const nextStart = start + response.data.size;

            if (allSeen) {
                this.logger.log(`Confluence: detected result cycling at start=${start}, stopping. Total unique pages seen: ${this.seenPageIds.size}`);
                this.seenPageIds.clear();
            }
            if (isLastPage) {
                this.seenPageIds.clear();
            }

            // Get the updatedAt timestamp of the last page in this batch for the cursor
            const lastPage = response.data.results[response.data.results.length - 1];
            const batchLastSync = lastPage ? (lastPage.history.lastUpdated?.when || lastPage.history.createdDate) : undefined;

            return {
                documents,
                newCursor: {
                    source: this.getSourceName() as DataSource,
                    syncToken: isLastPage ? undefined : nextStart.toString(),
                    lastSync: batchLastSync,
                },
                hasMore: !isLastPage,
                batchLastSync,
            };
        } catch (error) {
            this.logger.error(`Failed to fetch from Confluence: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    async listSpaces(): Promise<any[]> {
        if (!this.isConfigured()) return [];
        try {
            const response = await axios.get(`${this.baseUrl}/wiki/rest/api/space`, {
                headers: { 'Authorization': this.authHeader, 'Accept': 'application/json' },
                params: { limit: 50 },
            });
            return response.data.results || [];
        } catch (error) {
            this.logger.error(`Failed to list Confluence spaces: ${error.message}`);
            return [];
        }
    }

    private extractTextContent(page: ConfluencePage): string {
        const html = page.body?.storage?.value || '';
        const text = this.stripHtml(html);
        return `# ${page.title}\n\n**Space**: ${page.space.name} (${page.space.key})\n**Author**: ${page.history.createdBy.displayName}\n\n${text}`;
    }

    private stripHtml(html: string): string {
        return convert(html, {
            wordwrap: 130,
            selectors: [
                { selector: 'a', options: { ignoreHref: true } },
                { selector: 'img', format: 'skip' },
                { selector: 'pre', format: 'block', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
                { selector: 'code', format: 'inline' },
                { selector: 'table', format: 'dataTable' },
                { selector: 'h1', options: { uppercase: false, prefix: '# ' } },
                { selector: 'h2', options: { uppercase: false, prefix: '## ' } },
                { selector: 'h3', options: { uppercase: false, prefix: '### ' } },
            ],
        });
    }
}
