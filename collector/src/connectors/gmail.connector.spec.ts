import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { GmailConnector } from './gmail.connector';
import { GoogleAuthService } from './google-auth.service';

jest.mock('axios');
jest.mock('html-to-text', () => ({
    convert: jest.fn((html: string) => html ? `[text]${html}` : ''),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GmailConnector', () => {
    let connector: GmailConnector;
    let mockGoogleAuth: jest.Mocked<GoogleAuthService>;

    const googleConfig: Record<string, string> = {
        'google.clientId': 'client-id',
        'google.clientSecret': 'client-secret',
        'google.refreshToken': 'refresh-token',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        const mockConfigService = {
            get: jest.fn((key: string) => googleConfig[key]),
        };
        mockGoogleAuth = {
            getAccessToken: jest.fn().mockResolvedValue('test-access-token'),
        } as any;
        connector = new GmailConnector(mockConfigService as any, mockGoogleAuth);
    });

    describe('getSourceName', () => {
        it('should return "gmail"', () => {
            expect(connector.getSourceName()).toBe('gmail');
        });
    });

    describe('isConfigured', () => {
        it('should return true when all Google config is present', () => {
            expect(connector.isConfigured()).toBe(true);
        });

        it('should return false when clientId is missing', () => {
            const config = { ...googleConfig, 'google.clientId': undefined };
            const mockCfg = { get: jest.fn((key: string) => config[key]) };
            const c = new GmailConnector(mockCfg as any, mockGoogleAuth);
            expect(c.isConfigured()).toBe(false);
        });

        it('should return false when clientSecret is missing', () => {
            const config = { ...googleConfig, 'google.clientSecret': undefined };
            const mockCfg = { get: jest.fn((key: string) => config[key]) };
            const c = new GmailConnector(mockCfg as any, mockGoogleAuth);
            expect(c.isConfigured()).toBe(false);
        });

        it('should return false when refreshToken is missing', () => {
            const config = { ...googleConfig, 'google.refreshToken': undefined };
            const mockCfg = { get: jest.fn((key: string) => config[key]) };
            const c = new GmailConnector(mockCfg as any, mockGoogleAuth);
            expect(c.isConfigured()).toBe(false);
        });
    });

    describe('fetch', () => {
        it('should return empty result when not configured', async () => {
            const mockCfg = { get: jest.fn().mockReturnValue(undefined) };
            const c = new GmailConnector(mockCfg as any, mockGoogleAuth);
            const result = await c.fetch(null, {});
            expect(result).toEqual({ documents: [], newCursor: {}, hasMore: false });
        });

        it('should fetch in list mode when no cursor', async () => {
            // List messages response
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages') {
                    return { data: { messages: [{ id: 'msg1' }] } };
                }
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') {
                    return { data: { historyId: 'hist-100' } };
                }
                if (url.includes('/messages/msg1')) {
                    return {
                        data: {
                            id: 'msg1',
                            threadId: 'thread1',
                            labelIds: ['INBOX'],
                            historyId: 'hist-50',
                            payload: {
                                mimeType: 'text/plain',
                                headers: [
                                    { name: 'Subject', value: 'Test Email' },
                                    { name: 'From', value: 'alice@test.com' },
                                    { name: 'To', value: 'bob@test.com' },
                                    { name: 'Cc', value: '' },
                                    { name: 'Date', value: '2024-01-15T10:00:00.000Z' },
                                ],
                                body: { data: Buffer.from('Hello World').toString('base64') },
                            },
                        },
                    };
                }
                return { data: {} };
            });

            const result = await connector.fetch(null, {});

            expect(result.documents.length).toBe(1);
            const doc = result.documents[0];
            expect(doc.id).toBe('gmail_msg1');
            expect(doc.source).toBe('gmail');
            expect(doc.metadata).toMatchObject({
                id: 'msg1',
                source: 'gmail',
                type: 'email',
                title: 'Test Email',
                subject: 'Test Email',
                from: 'alice@test.com',
                threadId: 'thread1',
                labels: ['INBOX'],
            });
            expect(doc.content).toContain('Hello World');
        });

        it('should fetch in history mode when cursor has historyId', async () => {
            const syncToken = JSON.stringify({ mode: 'history', historyId: 'hist-50' });

            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/history') {
                    return {
                        data: {
                            historyId: 'hist-100',
                            history: [{
                                messagesAdded: [{ message: { id: 'msg2' } }],
                            }],
                        },
                    };
                }
                if (url.includes('/messages/msg2')) {
                    return {
                        data: {
                            id: 'msg2',
                            threadId: 'thread2',
                            labelIds: ['INBOX'],
                            historyId: 'hist-100',
                            payload: {
                                mimeType: 'text/plain',
                                headers: [
                                    { name: 'Subject', value: 'History Email' },
                                    { name: 'From', value: 'carol@test.com' },
                                    { name: 'To', value: 'dave@test.com' },
                                    { name: 'Cc', value: '' },
                                    { name: 'Date', value: '2024-02-01T10:00:00.000Z' },
                                ],
                                body: { data: Buffer.from('History content').toString('base64') },
                            },
                        },
                    };
                }
                return { data: {} };
            });

            const cursor = { source: 'gmail' as const, lastSync: '2024-01-01', syncToken };
            const result = await connector.fetch(cursor, {});

            expect(result.documents.length).toBe(1);
            expect(result.documents[0].content).toContain('History content');
        });

        it('should fall back to list mode when historyId expired (404)', async () => {
            const syncToken = JSON.stringify({ mode: 'history', historyId: 'expired-hist' });

            const historyError = new Error('Not Found') as any;
            historyError.response = { status: 404 };
            historyError.isAxiosError = true;
            mockedAxios.isAxiosError.mockReturnValue(true);

            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/history') {
                    throw historyError;
                }
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages') {
                    return { data: { messages: [] } };
                }
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') {
                    return { data: { historyId: 'new-hist' } };
                }
                return { data: {} };
            });

            const cursor = { source: 'gmail' as const, lastSync: '2024-01-01', syncToken };
            const result = await connector.fetch(cursor, {});

            // Should have fallen back to list mode and succeeded
            expect(result.hasMore).toBe(false);
        });

        it('should construct query from gmailSettings with domains', async () => {
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages') {
                    return { data: { messages: [] } };
                }
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') {
                    return { data: { historyId: '100' } };
                }
                return { data: {} };
            });

            await connector.fetch(null, {
                gmailSettings: { domains: ['company.com', 'partner.com'], senders: [], labels: [] },
            } as any);

            const listCall = mockedAxios.get.mock.calls.find(
                c => c[0] === 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
            );
            expect(listCall).toBeDefined();
            const q = listCall![1]?.params?.q;
            expect(q).toContain('from:*@company.com');
            expect(q).toContain('from:*@partner.com');
        });

        it('should construct query from gmailSettings with senders and labels', async () => {
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages') {
                    return { data: { messages: [] } };
                }
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') {
                    return { data: { historyId: '100' } };
                }
                return { data: {} };
            });

            await connector.fetch(null, {
                gmailSettings: {
                    domains: [],
                    senders: ['boss@work.com'],
                    labels: ['IMPORTANT'],
                },
            } as any);

            const listCall = mockedAxios.get.mock.calls.find(
                c => c[0] === 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
            );
            const q = listCall![1]?.params?.q;
            expect(q).toContain('from:boss@work.com');
            expect(q).toContain('label:IMPORTANT');
        });

        it('should transition from list to history mode when list finishes', async () => {
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages') {
                    return { data: { messages: [] } }; // No messages, no nextPageToken
                }
                if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') {
                    return { data: { historyId: 'hist-200' } };
                }
                return { data: {} };
            });

            const result = await connector.fetch(null, {});

            expect(result.hasMore).toBe(false);
            const state = JSON.parse(result.newCursor.syncToken!);
            expect(state.mode).toBe('history');
            expect(state.historyId).toBe('hist-200');
        });
    });

    describe('parseMessage', () => {
        it('should prefer text/plain over text/html in multipart messages', () => {
            const message = {
                id: 'msg1',
                threadId: 'thread1',
                labelIds: ['INBOX'],
                historyId: '50',
                payload: {
                    mimeType: 'multipart/alternative',
                    headers: [
                        { name: 'Subject', value: 'Multi' },
                        { name: 'From', value: 'test@test.com' },
                        { name: 'To', value: 'me@test.com' },
                        { name: 'Cc', value: '' },
                        { name: 'Date', value: '2024-01-15T10:00:00.000Z' },
                    ],
                    parts: [
                        { mimeType: 'text/html', body: { data: Buffer.from('<b>HTML</b>').toString('base64') } },
                        { mimeType: 'text/plain', body: { data: Buffer.from('Plain text body').toString('base64') } },
                    ],
                },
            };

            const doc = (connector as any).parseMessage(message);
            expect(doc).not.toBeNull();
            expect(doc.content).toContain('Plain text body');
        });

        it('should use HTML when no text/plain available', () => {
            const message = {
                id: 'msg2',
                threadId: 'thread2',
                labelIds: [],
                historyId: '50',
                payload: {
                    mimeType: 'multipart/alternative',
                    headers: [
                        { name: 'Subject', value: 'HTML Only' },
                        { name: 'From', value: 'test@test.com' },
                        { name: 'To', value: 'me@test.com' },
                        { name: 'Cc', value: '' },
                        { name: 'Date', value: '2024-01-15T10:00:00.000Z' },
                    ],
                    parts: [
                        { mimeType: 'text/html', body: { data: Buffer.from('<p>HTML content</p>').toString('base64') } },
                    ],
                },
            };

            const doc = (connector as any).parseMessage(message);
            expect(doc).not.toBeNull();
            // html-to-text mock prepends [text]
            expect(doc.content).toContain('[text]');
        });

        it('should return null when both body and subject are empty', () => {
            const message = {
                id: 'msg3',
                threadId: 'thread3',
                labelIds: [],
                historyId: '50',
                payload: {
                    mimeType: 'text/plain',
                    headers: [
                        { name: 'Subject', value: '' },
                        { name: 'From', value: 'test@test.com' },
                        { name: 'To', value: '' },
                        { name: 'Cc', value: '' },
                        { name: 'Date', value: '2024-01-15T10:00:00.000Z' },
                    ],
                    body: { data: '' },
                },
            };

            const doc = (connector as any).parseMessage(message);
            expect(doc).toBeNull();
        });

        it('should extract body from non-multipart message', () => {
            const message = {
                id: 'msg4',
                threadId: 'thread4',
                labelIds: ['SENT'],
                historyId: '50',
                payload: {
                    mimeType: 'text/plain',
                    headers: [
                        { name: 'Subject', value: 'Simple' },
                        { name: 'From', value: 'me@test.com' },
                        { name: 'To', value: 'them@test.com' },
                        { name: 'Cc', value: '' },
                        { name: 'Date', value: '2024-01-15T10:00:00.000Z' },
                    ],
                    body: { data: Buffer.from('Simple body').toString('base64') },
                },
            };

            const doc = (connector as any).parseMessage(message);
            expect(doc).not.toBeNull();
            expect(doc.content).toContain('Simple body');
        });
    });
});
