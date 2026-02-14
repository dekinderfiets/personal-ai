import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { convert } from 'html-to-text';

import { ConnectorResult, Cursor, DataSource,IndexDocument, IndexRequest } from '../types';
import { BaseConnector } from './base.connector';
import { GoogleAuthService } from './google-auth.service';

interface GmailMessage {
    id: string;
    threadId: string;
    labelIds: string[];
    historyId: string;
    payload: {
        mimeType: string;
        headers: Array<{ name: string; value: string }>;
        parts?: Array<{ mimeType: string; body: { data?: string } }>;
        body?: { data?: string };
    };
}

@Injectable()
export class GmailConnector extends BaseConnector {
    private readonly logger = new Logger(GmailConnector.name);

    constructor(
        private configService: ConfigService,
        private googleAuthService: GoogleAuthService,
    ) {
        super();
    }

    getSourceName(): string {
        return 'gmail';
    }

    isConfigured(): boolean {
        return !!(
            this.configService.get<string>('google.clientId') &&
            this.configService.get<string>('google.clientSecret') &&
            this.configService.get<string>('google.refreshToken')
        );
    }

    async fetch(cursor: Cursor | null, request: IndexRequest): Promise<ConnectorResult> {
        if (!this.isConfigured()) {
            this.logger.warn('Gmail not configured, skipping');
            return { documents: [], newCursor: {}, hasMore: false };
        }

        try {
            const token = await this.googleAuthService.getAccessToken(['https://www.googleapis.com/auth/gmail.readonly']);
            const documents: IndexDocument[] = [];

            // Parse syncToken from cursor
            let state: {
                mode: 'list' | 'history';
                nextPageToken?: string;
                historyId?: string;
            };

            if (cursor?.syncToken) {
                try {
                    state = JSON.parse(cursor.syncToken);
                } catch {
                    state = { mode: 'list' };
                }
            } else if (cursor?.lastSync && !request.fullReindex) {
                // If we have a lastSync but no syncToken, we need to find the historyId from the lastSync if possible,
                // but usually Gmail historyId is needed. If we don't have it, we must do a list.
                // However, the previous implementation saved syncToken as historyId.
                state = { mode: 'history', historyId: cursor.syncToken };
            } else {
                state = { mode: 'list' };
            }

            // Load settings for filtering
            const gmailSettings = (request as any).gmailSettings;
            const qParts: string[] = [];
            if (gmailSettings?.domains?.length) {
                const domainQuery = gmailSettings.domains.map((d: string) => `from:*@${d}`).join(' OR ');
                qParts.push(`(${domainQuery})`);
            }
            if (gmailSettings?.senders?.length) {
                const senderQuery = gmailSettings.senders.map((s: string) => `from:${s}`).join(' OR ');
                qParts.push(`(${senderQuery})`);
            }
            if (gmailSettings?.labels?.length) {
                const labelQuery = gmailSettings.labels.map((l: string) => `label:${l}`).join(' OR ');
                qParts.push(`(${labelQuery})`);
            }
            const q = qParts.length > 0 ? qParts.join(' ') : undefined;

            let messageIds: string[] = [];
            let nextState: typeof state;

            if (state.mode === 'history' && state.historyId) {
                try {
                    const response = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/history', {
                        headers: { 'Authorization': `Bearer ${token}` },
                        params: {
                            startHistoryId: state.historyId,
                            historyTypes: ['messageAdded'],
                            pageToken: state.nextPageToken,
                            maxResults: 50
                        },
                    });

                    if (response.data.history) {
                        const ids = new Set<string>();
                        response.data.history.forEach((h: any) =>
                            h.messagesAdded?.forEach((m: any) => ids.add(m.message.id))
                        );
                        messageIds = Array.from(ids);
                    }

                    nextState = {
                        mode: 'history',
                        historyId: response.data.historyId || state.historyId,
                        nextPageToken: response.data.nextPageToken
                    };
                } catch (error) {
                    if (axios.isAxiosError(error) && error.response?.status === 404) {
                        this.logger.warn(`Gmail historyId ${state.historyId} expired. Falling back to list.`);
                        state = { mode: 'list' };
                        // Continue to list mode below
                    } else {
                        throw error;
                    }
                }
            }

            if (state.mode === 'list') {
                const response = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
                    headers: { 'Authorization': `Bearer ${token}` },
                    params: {
                        maxResults: 50,
                        pageToken: state.nextPageToken,
                        q // Apply the filter query
                    },
                });

                if (response.data.messages) {
                    messageIds = response.data.messages.map((m: { id: string }) => m.id);
                }

                // If this is the first call of a list, we also want to capture the current historyId for future syncs
                let historyId = state.historyId;
                if (!state.nextPageToken) {
                    const profile = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
                        headers: { 'Authorization': `Bearer ${token}` },
                    });
                    historyId = profile.data.historyId;
                }

                nextState = {
                    mode: 'list',
                    historyId,
                    nextPageToken: response.data.nextPageToken
                };
            }

            for (const messageId of messageIds) {
                try {
                    const message = await this.getMessage(token, messageId);
                    const doc = this.parseMessage(message);
                    if (doc) {
                        documents.push(doc);
                    }
                } catch (error) {
                    this.logger.error(`Failed to fetch message ${messageId}: ${error.message}`);
                }
            }

            const hasMore = !!nextState!.nextPageToken;

            // If we finished a 'list', we should transition to 'history' for the next incremental sync
            if (!hasMore && nextState!.mode === 'list') {
                nextState = { mode: 'history', historyId: nextState!.historyId };
            }

            // Get the date of the last message in this batch for the cursor
            const lastDoc = documents[documents.length - 1] as IndexDocument | undefined;
            const batchLastSync = lastDoc ? (lastDoc.metadata as any).date : undefined;

            return {
                documents,
                newCursor: {
                    source: this.getSourceName() as DataSource,
                    syncToken: JSON.stringify(nextState!),
                    lastSync: batchLastSync,
                },
                hasMore,
                batchLastSync,
            };
        } catch (error) {
            this.logger.error(`Failed to fetch from Gmail: ${error.message}`);
            throw error;
        }
    }

    private async getMessage(token: string, messageId: string): Promise<GmailMessage> {
        const response = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: { format: 'full' },
        });
        return response.data;
    }

    private parseMessage(message: GmailMessage): IndexDocument | null {
        const headers = message.payload.headers;
        const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        const subject = getHeader('subject');
        const from = getHeader('from');
        const to = getHeader('to').split(',').map(s => s.trim()).filter(Boolean);
        const cc = getHeader('cc').split(',').map(s => s.trim()).filter(Boolean);
        const date = getHeader('date');

        let body = '';
        let _hasAttachments = false;

        const extractBody = (parts: any[]) => {
            for (const part of parts) {
                if (part.mimeType === 'text/plain' && part.body?.data) {
                    body = Buffer.from(part.body.data, 'base64').toString('utf-8');
                    return true;
                }
                if (part.mimeType === 'text/html' && part.body?.data) {
                    // Optionally convert HTML to text or prioritize text/plain
                    // For now, if HTML is found, we can take it, but prefer plain
                    if (!body) body = this.htmlToText(Buffer.from(part.body.data, 'base64').toString('utf-8'));
                }
                if (part.parts) {
                    if (extractBody(part.parts)) return true; // Found plain text in nested part
                } else if (part.filename) {
                    _hasAttachments = true;
                }
            }
            return false;
        };

        if (message.payload.parts) {
            extractBody(message.payload.parts);
        } else if (message.payload.body?.data && message.payload.mimeType === 'text/plain') {
            body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
        } else if (message.payload.body?.data && message.payload.mimeType === 'text/html') {
            body = this.htmlToText(Buffer.from(message.payload.body.data, 'base64').toString('utf-8'));
        }

        if (!body.trim() && !subject.trim()) return null;

        const content = [
            `# Email: ${subject}`,
            '',
            `**From**: ${from}`,
            `**To**: ${to.join(', ')}`,
            cc.length > 0 ? `**CC**: ${cc.join(', ')}` : '',
            `**Date**: ${new Date(date).toLocaleString()}`,
            '',
            '## Content',
            body
        ].filter(Boolean).join('\n');

        return {
            id: `gmail_${message.id}`,
            source: 'gmail',
            content,
            metadata: {
                id: message.id,
                source: 'gmail',
                type: 'email',
                title: subject,
                subject,
                from,
                to,
                cc,
                labels: message.labelIds,
                threadId: message.threadId,
                date: new Date(date).toISOString(),
                url: `https://mail.google.com/mail/u/0/#inbox/${message.threadId}`,
            },
        };
    }

    async listLabels(): Promise<any[]> {
        const token = await this.googleAuthService.getAccessToken(['https://www.googleapis.com/auth/gmail.readonly']);
        const response = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        return response.data.labels || [];
    }

    private htmlToText(html: string): string {
        return convert(html, {
            wordwrap: 130,
            selectors: [
                { selector: 'a', options: { ignoreHref: true } },
                { selector: 'img', format: 'skip' },
            ],
        });
    }
}
