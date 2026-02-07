import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { convert } from 'html-to-text';
import { BaseConnector } from './base.connector';
import { Cursor, IndexRequest, ConnectorResult, IndexDocument, DataSource } from '../types';

interface JiraIssue {
    id: string;
    key: string;
    fields: {
        summary: string;
        description: any;
        issuetype: { name: string };
        status: { name: string };
        priority: { name: string } | null;
        assignee: { displayName: string } | null;
        reporter: { displayName: string };
        labels: string[];
        components: { name: string }[];
        project: { key: string };
        created: string;
        updated: string;
        comment?: {
            comments: Array<{
                id: string;
                body: any;
                author: { displayName: string };
                created: string;
                updated: string;
            }>;
        };
        [key: string]: any;
    };
    renderedFields?: {
        description: string | null;
        comment?: {
            comments: Array<{
                id: string;
                body: string;
            }>;
        };
    };
}

@Injectable()
export class JiraConnector extends BaseConnector {
    private readonly logger = new Logger(JiraConnector.name);
    private readonly pageSize = 50;
    private baseUrl: string;
    private authHeader: string;
    private sprintFieldId: string;

    constructor(private configService: ConfigService) {
        super();
        this.baseUrl = this.configService.get<string>('jira.baseUrl')!;
        const username = this.configService.get<string>('jira.username');
        const apiToken = this.configService.get<string>('jira.apiToken');
        this.sprintFieldId = this.configService.get<string>('jira.sprintFieldId')!;

        if (this.baseUrl && username && apiToken) {
            const token = Buffer.from(`${username}:${apiToken}`).toString('base64');
            this.authHeader = `Basic ${token}`;
        }
    }

    getSourceName(): string {
        return 'jira';
    }

    isConfigured(): boolean {
        return !!(this.baseUrl && this.authHeader);
    }

    async fetch(cursor: Cursor | null, request: IndexRequest): Promise<ConnectorResult> {
        if (!this.isConfigured()) {
            this.logger.warn('Jira not configured, skipping');
            return { documents: [], newCursor: {}, hasMore: false };
        }

        const startAt = cursor?.syncToken ? parseInt(cursor.syncToken) : 0;

        // Build JQL query
        let jql = 'ORDER BY updated ASC';
        const conditions = [];

        if (request.projectKeys?.length) {
            conditions.push(`project IN (${request.projectKeys.join(',')})`);
        }

        // For incremental sync, only fetch issues updated since last sync
        if (cursor?.lastSync && !request.fullReindex) {
            // Jira format: "YYYY-MM-DD HH:mm"
            const lastSync = new Date(cursor.lastSync).toISOString().replace('T', ' ').slice(0, 16);
            conditions.push(`updated >= "${lastSync}"`);
        }

        if (conditions.length > 0) {
            jql = `${conditions.join(' AND ')} ${jql}`;
        }

        try {
            const response = await axios.get<{
                issues: JiraIssue[];
                total: number;
                maxResults: number;
                startAt: number;
            }>(`${this.baseUrl}/rest/api/3/search`, {
                headers: {
                    'Authorization': this.authHeader,
                    'Accept': 'application/json',
                },
                params: {
                    jql,
                    startAt,
                    maxResults: this.pageSize,
                    expand: 'renderedFields',
                    fields: `summary,description,issuetype,status,priority,assignee,reporter,labels,components,project,created,updated,comment,${this.sprintFieldId}`,
                },
            });

            const documents: IndexDocument[] = [];

            for (const issue of response.data.issues) {
                // Index the issue itself
                const content = this.buildIssueContent(issue);
                documents.push({
                    id: issue.key,
                    source: 'jira',
                    content,
                    metadata: {
                        id: issue.key,
                        source: 'jira',
                        type: 'issue',
                        title: issue.fields.summary,
                        project: issue.fields.project.key,
                        issueType: issue.fields.issuetype.name,
                        status: issue.fields.status.name,
                        priority: issue.fields.priority?.name || 'None',
                        assignee: issue.fields.assignee?.displayName || null,
                        reporter: issue.fields.reporter.displayName,
                        labels: issue.fields.labels,
                        components: issue.fields.components?.map(c => c.name) || [],
                        sprint: this.getSprintName(issue.fields[this.sprintFieldId]),
                        createdAt: issue.fields.created,
                        updatedAt: issue.fields.updated,
                        url: `${this.baseUrl}/browse/${issue.key}`,
                    },
                });

                // Index comments separately
                if (issue.fields.comment?.comments) {
                    for (let i = 0; i < issue.fields.comment.comments.length; i++) {
                        const comment = issue.fields.comment.comments[i];
                        const renderedComment = issue.renderedFields?.comment?.comments?.[i];

                        const commentBody = renderedComment ? this.stripHtml(renderedComment.body) :
                            (typeof comment.body === 'string' ? comment.body : 'JSON content');

                        documents.push({
                            id: `${issue.key}_comment_${comment.id}`,
                            source: 'jira',
                            content: `Comment on ${issue.key} by ${comment.author.displayName}:\n${commentBody}`,
                            metadata: {
                                id: `${issue.key}_comment_${comment.id}`,
                                source: 'jira',
                                type: 'comment',
                                title: `Comment on ${issue.key} by ${comment.author.displayName}`,
                                parentId: issue.key,
                                project: issue.fields.project.key,
                                reporter: comment.author.displayName,
                                createdAt: comment.created,
                                updatedAt: comment.updated,
                                url: `${this.baseUrl}/browse/${issue.key}?focusedCommentId=${comment.id}`,
                            },
                        });
                    }
                }
            }

            const hasMore = startAt + response.data.issues.length < response.data.total;
            const newStartAt = startAt + response.data.issues.length;

            // Get the updatedAt timestamp of the last issue in this batch for the cursor
            const lastIssue = response.data.issues[response.data.issues.length - 1];
            const batchLastSync = lastIssue ? lastIssue.fields.updated : undefined;

            return {
                documents,
                newCursor: {
                    source: this.getSourceName() as DataSource,
                    syncToken: hasMore ? newStartAt.toString() : undefined,
                    lastSync: batchLastSync || cursor?.lastSync, // Use batchLastSync if available, otherwise keep previous
                },
                hasMore,
                batchLastSync,
            };
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 410) {
                this.logger.warn(`Jira API returned 410 Gone (startAt=${startAt}). Aborting this sync cycle.`);
                return {
                    documents: [],
                    newCursor: {
                        source: this.getSourceName() as DataSource,
                        // Keep existing cursor to try again later
                        lastSync: cursor?.lastSync
                    },
                    hasMore: false
                };
            }
            this.logger.error(`Failed to fetch from Jira: ${error.message}`);
            throw error;
        }
    }

    private stripHtml(html: string | null): string {
        if (!html) return '';
        return convert(html, {
            wordwrap: 130,
            selectors: [
                { selector: 'a', options: { ignoreHref: true } },
                { selector: 'img', format: 'skip' },
            ],
        });
    }

    private buildIssueContent(issue: JiraIssue): string {
        const description = issue.renderedFields?.description ?
            this.stripHtml(issue.renderedFields.description) :
            (typeof issue.fields.description === 'string' ? issue.fields.description : '');

        const parts = [
            `# [${issue.key}] ${issue.fields.summary}`,
            '',
            `## Metadata`,
            `- **Type**: ${issue.fields.issuetype.name}`,
            `- **Status**: ${issue.fields.status.name}`,
            `- **Priority**: ${issue.fields.priority?.name || 'None'}`,
            `- **Project**: ${issue.fields.project.key}`,
        ];

        if (issue.fields.assignee) {
            parts.push(`- **Assignee**: ${issue.fields.assignee.displayName}`);
        }

        if (issue.fields.reporter) {
            parts.push(`- **Reporter**: ${issue.fields.reporter.displayName}`);
        }

        if (issue.fields.labels.length > 0) {
            parts.push(`- **Labels**: ${issue.fields.labels.join(', ')}`);
        }

        if (description) {
            parts.push('', '## Description', description);
        }

        return parts.join('\n');
    }

    private getSprintName(sprintField: { name: string }[] | null | undefined): string | null {
        if (!sprintField || sprintField.length === 0) return null;
        // The sprint field is an array, usually the last one is the active one
        return sprintField[sprintField.length - 1].name;
    }

    async fetchIssue(issueKey: string): Promise<IndexDocument[]> {
        if (!this.isConfigured()) {
            this.logger.warn(`Jira not configured, cannot fetch issue ${issueKey}`);
            return [];
        }

        try {
            const response = await axios.get<JiraIssue>(`${this.baseUrl}/rest/api/3/issue/${issueKey}`, {
                headers: {
                    'Authorization': this.authHeader,
                    'Accept': 'application/json',
                },
                params: {
                    expand: 'renderedFields',
                    fields: `summary,description,issuetype,status,priority,assignee,reporter,labels,components,project,created,updated,comment,${this.sprintFieldId}`,
                },
            });

            const issue = response.data;
            const documents: IndexDocument[] = [];

            // Index the issue itself
            const content = this.buildIssueContent(issue);
            documents.push({
                id: issue.key,
                source: 'jira',
                content,
                metadata: {
                    id: issue.key,
                    source: 'jira',
                    type: 'issue',
                    title: issue.fields.summary,
                    project: issue.fields.project.key,
                    issueType: issue.fields.issuetype.name,
                    status: issue.fields.status.name,
                    priority: issue.fields.priority?.name || 'None',
                    assignee: issue.fields.assignee?.displayName || null,
                    reporter: issue.fields.reporter.displayName,
                    labels: issue.fields.labels,
                    components: issue.fields.components?.map(c => c.name) || [],
                    sprint: this.getSprintName(issue.fields[this.sprintFieldId]),
                    createdAt: issue.fields.created,
                    updatedAt: issue.fields.updated,
                    url: `${this.baseUrl}/browse/${issue.key}`,
                },
            });

            // Index comments separately
            if (issue.fields.comment?.comments) {
                for (let i = 0; i < issue.fields.comment.comments.length; i++) {
                    const comment = issue.fields.comment.comments[i];
                    const renderedComment = issue.renderedFields?.comment?.comments?.[i];

                    const commentBody = renderedComment ? this.stripHtml(renderedComment.body) :
                        (typeof comment.body === 'string' ? comment.body : 'JSON content');

                    documents.push({
                        id: `${issue.key}_comment_${comment.id}`,
                        source: 'jira',
                        content: `Comment on ${issue.key} by ${comment.author.displayName}:\n${commentBody}`,
                        metadata: {
                            id: `${issue.key}_comment_${comment.id}`,
                            source: 'jira',
                            type: 'comment',
                            title: `Comment on ${issue.key} by ${comment.author.displayName}`,
                            parentId: issue.key,
                            project: issue.fields.project.key,
                            reporter: comment.author.displayName,
                            createdAt: comment.created,
                            updatedAt: comment.updated,
                            url: `${this.baseUrl}/browse/${issue.key}?focusedCommentId=${comment.id}`,
                        },
                    });
                }
            }
            return documents;

        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                this.logger.log(`Issue ${issueKey} not found. It may have been deleted.`);
                // Here you might want to trigger a deletion from the index
                // For now, we just return an empty array.
                return [];
            }
            this.logger.error(`Failed to fetch issue ${issueKey} from Jira: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    async listProjects(): Promise<any[]> {
        if (!this.isConfigured()) return [];
        try {
            const response = await axios.get(`${this.baseUrl}/rest/api/3/project`, {
                headers: {
                    'Authorization': this.authHeader,
                    'Accept': 'application/json',
                },
            });
            return response.data;
        } catch (error) {
            this.logger.error(`Failed to list Jira projects: ${error.message}`);
            return [];
        }
    }
}
