import { SlackConnector } from './slack.connector';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SlackConnector', () => {
    let connector: SlackConnector;

    function createConnector(token?: string) {
        const mockConfigService = {
            get: jest.fn((key: string) => {
                if (key === 'slack.userToken') return token ?? 'xoxp-test-token';
                return undefined;
            }),
        };
        return new SlackConnector(mockConfigService as any);
    }

    // Helper to set up standard mock responses for a fetch flow
    function setupFetchMocks(options: {
        channels?: any[];
        messages?: any[];
        nextCursor?: string;
        users?: Record<string, any>;
        threadReplies?: any[];
    } = {}) {
        const {
            channels = [{ id: 'C1', name: 'general', is_member: true }],
            messages = [],
            nextCursor,
            users = {},
            threadReplies = [],
        } = options;

        mockedAxios.get.mockImplementation(async (url: string, config?: any) => {
            if (url === 'https://slack.com/api/conversations.list') {
                return { data: { ok: true, channels, response_metadata: {} } };
            }
            if (url === 'https://slack.com/api/conversations.history') {
                return {
                    data: {
                        ok: true,
                        messages,
                        response_metadata: nextCursor ? { next_cursor: nextCursor } : {},
                    },
                };
            }
            if (url === 'https://slack.com/api/conversations.replies') {
                return { data: { ok: true, messages: threadReplies } };
            }
            if (url === 'https://slack.com/api/users.info') {
                const userId = config?.params?.user;
                const user = users[userId] || { id: userId, real_name: `User ${userId}`, name: userId };
                return { data: { ok: true, user } };
            }
            return { data: {} };
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        connector = createConnector();
    });

    describe('getSourceName', () => {
        it('should return "slack"', () => {
            expect(connector.getSourceName()).toBe('slack');
        });
    });

    describe('isConfigured', () => {
        it('should return true when token is set', () => {
            expect(connector.isConfigured()).toBe(true);
        });

        it('should return false when token is missing', () => {
            const c = createConnector(undefined);
            // The constructor sets token to configService.get('slack.userToken')!
            // If token is undefined, isConfigured returns false
            const noTokenConnector = createConnector('');
            expect(noTokenConnector.isConfigured()).toBe(false);
        });
    });

    describe('fetch', () => {
        it('should return empty result when not configured', async () => {
            const c = createConnector('');
            const result = await c.fetch(null, {});
            expect(result).toEqual({ documents: [], newCursor: {}, hasMore: false });
        });

        it('should return empty result when no channels', async () => {
            setupFetchMocks({ channels: [] });
            const result = await connector.fetch(null, {});
            expect(result).toEqual({ documents: [], newCursor: {}, hasMore: false });
        });

        it('should produce correct message document structure', async () => {
            const messages = [{
                ts: '1700000000.000100',
                text: 'Hello world',
                user: 'U1',
            }];
            setupFetchMocks({
                messages,
                users: { U1: { id: 'U1', real_name: 'Alice', name: 'alice' } },
            });

            const result = await connector.fetch(null, {});

            expect(result.documents.length).toBe(1);
            const doc = result.documents[0];
            expect(doc.id).toBe('slack_C1_1700000000.000100');
            expect(doc.source).toBe('slack');
            expect(doc.metadata).toMatchObject({
                source: 'slack',
                type: 'message',
                channel: 'general',
                channelId: 'C1',
                author: 'Alice',
                authorId: 'U1',
            });
        });

        it('should handle thread starter and index replies', async () => {
            const threadTs = '1700000000.000100';
            const messages = [{
                ts: threadTs,
                text: 'Thread starter',
                user: 'U1',
                reply_count: 1,
                // No thread_ts means this is the thread starter
            }];
            const threadReplies = [
                { ts: threadTs, text: 'Thread starter', user: 'U1' }, // the starter itself
                { ts: '1700000001.000200', text: 'Reply message', user: 'U2', thread_ts: threadTs },
            ];
            setupFetchMocks({
                messages,
                threadReplies,
                users: {
                    U1: { id: 'U1', real_name: 'Alice', name: 'alice' },
                    U2: { id: 'U2', real_name: 'Bob', name: 'bob' },
                },
            });

            const result = await connector.fetch(null, {});

            // Should have the thread starter + the reply
            expect(result.documents.length).toBe(2);
            expect(result.documents[0].metadata.type).toBe('message');
            expect(result.documents[1].metadata.type).toBe('thread_reply');
            expect((result.documents[1].metadata as any).parentId).toBe('slack_C1_1700000000.000100');
        });

        it('should compute reaction metadata correctly', async () => {
            const messages = [{
                ts: '1700000000.000100',
                text: 'Reacted message',
                user: 'U1',
                reactions: [
                    { name: 'thumbsup', count: 5 },
                    { name: 'heart', count: 3 },
                    { name: 'smile', count: 10 },
                    { name: 'rocket', count: 1 },
                ],
            }];
            setupFetchMocks({ messages });

            const result = await connector.fetch(null, {});

            const doc = result.documents[0];
            expect((doc.metadata as any).reactionCount).toBe(19);
            // Top 3 sorted by count: smile(10), thumbsup(5), heart(3)
            expect((doc.metadata as any).topReactions).toEqual(['smile', 'thumbsup', 'heart']);
        });

        it('should set reactionCount=0 and topReactions=[] when no reactions', async () => {
            const messages = [{
                ts: '1700000000.000100',
                text: 'No reactions',
                user: 'U1',
            }];
            setupFetchMocks({ messages });

            const result = await connector.fetch(null, {});

            expect((result.documents[0].metadata as any).reactionCount).toBe(0);
            expect((result.documents[0].metadata as any).topReactions).toEqual([]);
        });

        it('should replace mentions in text with user names', async () => {
            const messages = [{
                ts: '1700000000.000100',
                text: 'Hey <@U1> and <@U2|bob>, check this',
                user: 'U3',
            }];
            setupFetchMocks({
                messages,
                users: {
                    U1: { id: 'U1', real_name: 'Alice', name: 'alice' },
                    U2: { id: 'U2', real_name: 'Bob', name: 'bob' },
                    U3: { id: 'U3', real_name: 'Carol', name: 'carol' },
                },
            });

            const result = await connector.fetch(null, {});

            expect(result.documents[0].content).toContain('@Alice');
            expect(result.documents[0].content).toContain('@Bob');
            expect(result.documents[0].content).not.toContain('<@U1>');
        });

        it('should track mentioned user names in metadata', async () => {
            const messages = [{
                ts: '1700000000.000100',
                text: 'Hey <@U1>',
                user: 'U2',
            }];
            setupFetchMocks({
                messages,
                users: {
                    U1: { id: 'U1', real_name: 'Alice', name: 'alice' },
                    U2: { id: 'U2', real_name: 'Bob', name: 'bob' },
                },
            });

            const result = await connector.fetch(null, {});
            expect((result.documents[0].metadata as any).mentionedUsers).toEqual(['Alice']);
        });

        it('should handle channel pagination (channelIdx advancing)', async () => {
            const channels = [
                { id: 'C1', name: 'ch1', is_member: true },
                { id: 'C2', name: 'ch2', is_member: true },
            ];
            // First call: no messages in ch1, no next_cursor → advance channelIdx
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === 'https://slack.com/api/conversations.list') {
                    return { data: { ok: true, channels, response_metadata: {} } };
                }
                if (url === 'https://slack.com/api/conversations.history') {
                    return { data: { ok: true, messages: [], response_metadata: {} } };
                }
                return { data: {} };
            });

            const result = await connector.fetch(null, {});

            expect(result.hasMore).toBe(true);
            const state = JSON.parse(result.newCursor.syncToken!);
            expect(state.channelIdx).toBe(1);
        });

        it('should set hasMore=false when all channels processed', async () => {
            const channels = [{ id: 'C1', name: 'ch1', is_member: true }];
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === 'https://slack.com/api/conversations.list') {
                    return { data: { ok: true, channels, response_metadata: {} } };
                }
                if (url === 'https://slack.com/api/conversations.history') {
                    return { data: { ok: true, messages: [], response_metadata: {} } };
                }
                return { data: {} };
            });

            const result = await connector.fetch(null, {});

            expect(result.hasMore).toBe(false);
        });

        it('should maintain nextCursor for pagination within a channel', async () => {
            setupFetchMocks({
                messages: [{ ts: '1700000000.000100', text: 'msg', user: 'U1' }],
                nextCursor: 'cursor-abc',
            });

            const result = await connector.fetch(null, {});

            expect(result.hasMore).toBe(true);
            const state = JSON.parse(result.newCursor.syncToken!);
            expect(state.nextCursor).toBe('cursor-abc');
            expect(state.channelIdx).toBe(0); // still on the same channel
        });

        it('should skip messages without user that are not bot_message', async () => {
            const messages = [
                { ts: '1700000000.000100', text: 'System message', subtype: 'channel_join' },
                { ts: '1700000000.000200', text: 'Real message', user: 'U1' },
            ];
            setupFetchMocks({ messages });

            const result = await connector.fetch(null, {});

            expect(result.documents.length).toBe(1);
            expect(result.documents[0].content).toContain('Real message');
        });

        it('should mark thread reply type correctly', async () => {
            const messages = [{
                ts: '1700000000.000200',
                text: 'A reply',
                user: 'U1',
                thread_ts: '1700000000.000100', // different from ts → it's a reply
            }];
            setupFetchMocks({ messages });

            const result = await connector.fetch(null, {});

            expect(result.documents[0].metadata.type).toBe('thread_reply');
        });

        it('should use lastSync from cursor as oldest parameter', async () => {
            setupFetchMocks({ messages: [] });

            const cursor = { source: 'slack' as const, lastSync: '2024-06-01T00:00:00.000Z' };
            await connector.fetch(cursor, {});

            // The oldest should be derived from lastSync timestamp
            const historyCall = mockedAxios.get.mock.calls.find(c => c[0] === 'https://slack.com/api/conversations.history');
            expect(historyCall).toBeDefined();
            // 2024-06-01T00:00:00.000Z in epoch seconds = 1717200000
            const oldest = historyCall![1]?.params?.oldest;
            expect(parseFloat(oldest)).toBeGreaterThan(0);
        });
    });

    describe('extractMentionedUsers', () => {
        it('should extract user IDs from mention patterns', () => {
            const text = 'Hey <@U12345> and <@U67890|bob>';
            const result = (connector as any).extractMentionedUsers(text);
            expect(result).toEqual(['U12345', 'U67890']);
        });

        it('should return empty array when no mentions', () => {
            const result = (connector as any).extractMentionedUsers('No mentions here');
            expect(result).toEqual([]);
        });
    });

    describe('slackApi rate limiting', () => {
        it('should retry on 429 status', async () => {
            const rateLimitError = {
                response: { status: 429, headers: { 'retry-after': '0' } },
            };

            mockedAxios.get
                .mockRejectedValueOnce(rateLimitError)
                .mockResolvedValueOnce({ data: { ok: true, result: 'success' } });

            const result = await (connector as any).slackApi('https://slack.com/api/test', {});

            expect(result.data.ok).toBe(true);
            expect(mockedAxios.get).toHaveBeenCalledTimes(2);
        });

        it('should throw after max retries', async () => {
            const rateLimitError = {
                response: { status: 429, headers: { 'retry-after': '0' } },
            };

            mockedAxios.get
                .mockRejectedValueOnce(rateLimitError)
                .mockRejectedValueOnce(rateLimitError)
                .mockRejectedValueOnce(rateLimitError);

            await expect(
                (connector as any).slackApi('https://slack.com/api/test', {}),
            ).rejects.toThrow('Slack API rate limit exceeded after retries');
        });

        it('should throw non-429 errors immediately', async () => {
            const serverError = { response: { status: 500 } };
            mockedAxios.get.mockRejectedValueOnce(serverError);

            await expect(
                (connector as any).slackApi('https://slack.com/api/test', {}),
            ).rejects.toEqual(serverError);
        });
    });
});
