import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import { BaseConnector } from './base.connector';
import { Cursor, IndexRequest, ConnectorResult, IndexDocument, SlackDocument, DataSource } from '../types';

interface SlackMessage {
    ts: string;
    text: string;
    user: string;
    thread_ts?: string;
    reply_count?: number;
    files?: { name: string }[];
    subtype?: string;
    reactions?: { name: string; count: number }[];
}

interface SlackChannel {
    id: string;
    name: string;
    is_member?: boolean;
    is_im?: boolean;
    is_channel?: boolean;
    is_group?: boolean;
    is_mpim?: boolean;
}

interface SlackUser {
    id: string;
    real_name: string;
    name: string;
}

@Injectable()
export class SlackConnector extends BaseConnector implements OnModuleInit {
    private readonly logger = new Logger(SlackConnector.name);
    private readonly token: string;
    private teamId: string;
    private userCache: Map<string, SlackUser> = new Map();
    private channelsCache: SlackChannel[] | null = null;
    private channelsCacheTime: number = 0;
    private static readonly CHANNELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    constructor(private configService: ConfigService) {
        super();
        this.token = this.configService.get<string>('slack.userToken')!;
    }

    async onModuleInit() {
        if (this.isConfigured()) {
            try {
                const response = await axios.get('https://slack.com/api/auth.test', {
                    headers: { 'Authorization': `Bearer ${this.token}` },
                });
                if (response.data.ok) {
                    this.teamId = response.data.team_id;
                    this.logger.log(`Slack team ID: ${this.teamId}`);
                } else {
                    this.logger.error(`Failed to get Slack team ID: ${response.data.error}`);
                }
            } catch (error) {
                this.logger.error(`Error fetching Slack team ID: ${error.message}`);
            }
        }
    }

    getSourceName(): string {
        return 'slack';
    }

    isConfigured(): boolean {
        return !!this.token;
    }

    async fetch(cursor: Cursor | null, request: IndexRequest): Promise<ConnectorResult> {
        if (!this.isConfigured()) {
            this.logger.warn('Slack not fully configured, skipping');
            return { documents: [], newCursor: {}, hasMore: false };
        }

        const channels = await this.getChannels(request.channelIds);
        if (channels.length === 0) {
            return { documents: [], newCursor: {}, hasMore: false };
        }

        // Parse syncToken from cursor
        let state: {
            channelIdx: number;
            nextCursor?: string;
            latestSeenTs: string;
            oldest: string;
        };

        if (cursor?.syncToken) {
            try {
                state = JSON.parse(cursor.syncToken);
            } catch (e) {
                state = { channelIdx: 0, latestSeenTs: '0', oldest: '0' };
            }
        } else {
            const oldest = cursor?.lastSync ? (new Date(cursor.lastSync).getTime() / 1000).toString() : '0';
            state = { channelIdx: 0, latestSeenTs: oldest, oldest };
        }

        if (state.channelIdx >= channels.length) {
            return { documents: [], newCursor: { syncToken: JSON.stringify(state) }, hasMore: false };
        }

        const channel = channels[state.channelIdx];
        const { messages, next_cursor } = await this.getChannelMessages(channel.id, state.oldest, state.nextCursor);

        const documents: IndexDocument[] = [];
        let maxTs = parseFloat(state.latestSeenTs);

        for (const message of messages) {
            if (!message.user && message.subtype !== 'bot_message') continue;

            const isBot = message.subtype === 'bot_message';
            const messageTs = parseFloat(message.ts);
            if (messageTs > maxTs) {
                maxTs = messageTs;
            }

            const author = message.user ? await this.getUser(message.user) : null;
            const mentionedUsers = this.extractMentionedUsers(message.text);
            const mentionedUsersNames = await Promise.all(
                mentionedUsers.map(async (u) => {
                    const user = await this.getUser(u);
                    return user?.real_name || user?.name || u;
                })
            );

            // Replace mentions in text with readable names
            let formattedText = message.text;
            for (let i = 0; i < mentionedUsers.length; i++) {
                const userId = mentionedUsers[i];
                const userName = mentionedUsersNames[i];
                // Match <@userId> or <@userId|anything>
                const mentionRegex = new RegExp(`<@${userId}(\\|[^>]*)?>`, 'g');
                formattedText = formattedText.replace(mentionRegex, `@${userName}`);
            }

            const isThreadStarter = message.reply_count && message.reply_count > 0 && !message.thread_ts;
            const isIndividualMessage = !message.thread_ts || message.thread_ts === message.ts;

            // Compute reaction metadata
            const reactionCount = message.reactions
                ? message.reactions.reduce((sum, r) => sum + r.count, 0)
                : 0;
            const topReactions = message.reactions
                ? [...message.reactions].sort((a, b) => b.count - a.count).slice(0, 3).map(r => r.name)
                : [];

            // Build title with channel name and message text preview
            const textPreview = formattedText.replace(/\n+/g, ' ').substring(0, 80).trim();
            const title = `#${channel.name}: ${textPreview}`;

            documents.push({
                id: `slack_${channel.id}_${message.ts}`,
                source: 'slack',
                content: `### Message in #${channel.name}\n**Author**: ${author?.real_name || author?.name || message.user || 'Bot'}\n**Time**: ${new Date(messageTs * 1000).toLocaleString()}\n\n${formattedText}`,
                metadata: {
                    id: `slack_${channel.id}_${message.ts}`,
                    source: 'slack',
                    type: isIndividualMessage ? 'message' : 'thread_reply',
                    title,
                    channel: channel.name,
                    channelId: channel.id,
                    author: author?.real_name || author?.name || message.user || 'Bot',
                    authorId: message.user || '',
                    threadTs: message.thread_ts || null,
                    timestamp: new Date(messageTs * 1000).toISOString(),
                    hasAttachments: !!(message.files?.length),
                    mentionedUsers: mentionedUsersNames.filter(Boolean),
                    url: `https://app.slack.com/client/${this.teamId}/${channel.id}/p${message.ts.replace('.', '')}`,
                    reactionCount,
                    topReactions,
                    is_bot: isBot,
                },
            });

            // If it's a thread starter, fetch replies
            if (isThreadStarter) {
                const threadMessages = await this.getThreadMessages(channel.id, message.ts);
                this.logger.debug(`Fetching ${threadMessages.length} replies for thread ${message.ts}`);
                for (const reply of threadMessages) {
                    // Skip the first message as it's the thread starter we already indexed
                    if (reply.ts === message.ts) continue;
                    // Skip system messages (no user and not a bot)
                    if (!reply.user && reply.subtype !== 'bot_message') continue;

                    const replyAuthor = reply.user ? await this.getUser(reply.user) : null;
                    const replyTs = parseFloat(reply.ts);
                    const replyMentionedUsers = this.extractMentionedUsers(reply.text);
                    const replyMentionedUsersNames = await Promise.all(
                        replyMentionedUsers.map(async (u) => {
                            const user = await this.getUser(u);
                            return user?.real_name || user?.name || u;
                        })
                    );

                    // Replace mentions in reply text
                    let formattedReplyText = reply.text;
                    for (let i = 0; i < replyMentionedUsers.length; i++) {
                        const userId = replyMentionedUsers[i];
                        const userName = replyMentionedUsersNames[i];
                        const mentionRegex = new RegExp(`<@${userId}(\\|[^>]*)?>`, 'g');
                        formattedReplyText = formattedReplyText.replace(mentionRegex, `@${userName}`);
                    }

                    const isReplyBot = reply.subtype === 'bot_message';

                    // Compute reaction metadata for reply
                    const replyReactionCount = reply.reactions
                        ? reply.reactions.reduce((sum, r) => sum + r.count, 0)
                        : 0;
                    const replyTopReactions = reply.reactions
                        ? [...reply.reactions].sort((a, b) => b.count - a.count).slice(0, 3).map(r => r.name)
                        : [];

                    // Build title with channel name and reply text preview
                    const replyTextPreview = formattedReplyText.replace(/\n+/g, ' ').substring(0, 80).trim();
                    const replyTitle = `#${channel.name}: ${replyTextPreview}`;

                    documents.push({
                        id: `slack_${channel.id}_${reply.ts}`,
                        source: 'slack',
                        content: `### Thread Reply in #${channel.name}\n**Author**: ${replyAuthor?.real_name || replyAuthor?.name || reply.user || 'Bot'}\n**Time**: ${new Date(replyTs * 1000).toLocaleString()}\n**Context**: Reply to message ${message.ts}\n\n${formattedReplyText}`,
                        metadata: {
                            id: `slack_${channel.id}_${reply.ts}`,
                            source: 'slack',
                            type: 'thread_reply',
                            title: replyTitle,
                            parentId: `slack_${channel.id}_${message.ts}`,
                            channel: channel.name,
                            channelId: channel.id,
                            author: replyAuthor?.real_name || replyAuthor?.name || reply.user || 'Bot',
                            authorId: reply.user || '',
                            threadTs: message.ts,
                            timestamp: new Date(replyTs * 1000).toISOString(),
                            hasAttachments: !!(reply.files?.length),
                            mentionedUsers: replyMentionedUsersNames.filter(Boolean),
                            url: `https://app.slack.com/client/${this.teamId}/${channel.id}/p${reply.ts.replace('.', '')}`,
                            reactionCount: replyReactionCount,
                            topReactions: replyTopReactions,
                            is_bot: isReplyBot,
                        },
                    });
                }
            }
        }

        const newState = { ...state };
        newState.latestSeenTs = maxTs.toString();

        let hasMore = true;
        if (next_cursor) {
            newState.nextCursor = next_cursor;
        } else {
            newState.channelIdx++;
            newState.nextCursor = undefined;
            if (newState.channelIdx >= channels.length) {
                hasMore = false;
                // Prepare state for next incremental run
                newState.channelIdx = 0;
                newState.oldest = newState.latestSeenTs;
            }
        }

        return {
            documents,
            newCursor: {
                source: this.getSourceName() as DataSource,
                syncToken: JSON.stringify(newState),
                lastSync: newState.oldest, // The 'oldest' for the next fetch will be the 'latestSeenTs' of this batch
            },
            hasMore,
            batchLastSync: maxTs > 0 ? new Date(maxTs * 1000).toISOString() : undefined,
        };
    }

    public async getChannels(channelIds?: string[]): Promise<SlackChannel[]> {
        try {
            const now = Date.now();
            if (!this.channelsCache || now - this.channelsCacheTime > SlackConnector.CHANNELS_CACHE_TTL) {
                let allChannels: SlackChannel[] = [];
                let cursor: string | undefined;

                do {
                    const response = await this.slackApi('https://slack.com/api/conversations.list', {
                        types: 'public_channel,private_channel,mpim,im',
                        limit: 1000,
                        cursor,
                    });

                    if (!response.data.ok) throw new Error(response.data.error);

                    const pageChannels: SlackChannel[] = response.data.channels;
                    allChannels = allChannels.concat(pageChannels);
                    cursor = response.data.response_metadata?.next_cursor;
                } while (cursor);

                this.logger.log(`Fetched ${allChannels.length} total channels/DMs from Slack.`);

                // Enrich DMs with user names
                await Promise.all(allChannels.map(async (c: any) => {
                    if (c.is_im && c.user) {
                        const user = await this.getUser(c.user);
                        c.name = user?.real_name || user?.name || `DM with ${c.user}`;
                    }
                }));

                // Filter for channels where the user/bot is a member OR it is a DM (which is implicitly joined)
                const memberChannels = allChannels.filter(c => c.is_member || c.is_im);
                this.logger.log(`Filtered to ${memberChannels.length} channels where user is a member (or DM).`);

                this.channelsCache = memberChannels;
                this.channelsCacheTime = now;
            }

            let channels = this.channelsCache;
            if (channelIds && channelIds.length > 0) {
                channels = channels.filter(c => channelIds.includes(c.id));
            }
            return channels;

        } catch (error) {
            this.logger.error(`Failed to get channels: ${error.message}`);
            return [];
        }
    }

    private async getChannelMessages(channelId: string, oldest: string, cursor?: string): Promise<{ messages: SlackMessage[]; next_cursor?: string }> {
        try {
            const response = await this.slackApi('https://slack.com/api/conversations.history', { channel: channelId, limit: 200, oldest, cursor });
            if (!response.data.ok) throw new Error(response.data.error);
            return {
                messages: response.data.messages,
                next_cursor: response.data.response_metadata?.next_cursor,
            };
        } catch (error) {
            this.logger.error(`Failed to get conversation history for channel ${channelId}: ${error.message}`);
            return { messages: [] };
        }
    }

    private async getThreadMessages(channelId: string, threadTs: string): Promise<SlackMessage[]> {
        try {
            const response = await this.slackApi('https://slack.com/api/conversations.replies', { channel: channelId, ts: threadTs, limit: 100 });
            if (!response.data.ok) throw new Error(response.data.error);
            return response.data.messages;
        } catch (error) {
            this.logger.error(`Failed to get thread replies for ${threadTs}: ${error.message}`);
            return [];
        }
    }

    private async getUser(userId: string): Promise<SlackUser | null> {
        if (!userId) return null;
        if (this.userCache.has(userId)) {
            return this.userCache.get(userId)!;
        }
        try {
            const response = await this.slackApi('https://slack.com/api/users.info', { user: userId });
            if (response.data.ok) {
                const user = response.data.user as SlackUser;
                this.userCache.set(userId, user);
                return user;
            }
        } catch (error) {
            this.logger.warn(`Failed to get user ${userId}: ${error.message}`);
        }
        return null;
    }

    private extractMentionedUsers(text: string): string[] {
        const mentions = text.match(/<@([A-Z0-9]+)(\|[^>]*)?>/g) || [];
        return mentions.map(m => {
            const match = m.match(/<@([A-Z0-9]+)/);
            return match ? match[1] : '';
        }).filter(Boolean);
    }

    private async slackApi(url: string, params: Record<string, any>): Promise<any> {
        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await axios.get(url, {
                    headers: { 'Authorization': `Bearer ${this.token}` },
                    params,
                });
                return response;
            } catch (error: any) {
                if (error.response?.status === 429) {
                    const retryAfter = parseInt(error.response.headers['retry-after'] || '30', 10);
                    this.logger.warn(`Slack rate limited, waiting ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    continue;
                }
                throw error;
            }
        }
        throw new Error('Slack API rate limit exceeded after retries');
    }
}
