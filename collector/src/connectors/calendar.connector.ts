import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { ConnectorResult, Cursor, DataSource,IndexDocument, IndexRequest } from '../types';
import { BaseConnector } from './base.connector';
import { GoogleAuthService } from './google-auth.service';

@Injectable()
export class CalendarConnector extends BaseConnector {
    private readonly logger = new Logger(CalendarConnector.name);

    constructor(
        private configService: ConfigService,
        private googleAuthService: GoogleAuthService,
    ) {
        super();
    }

    getSourceName(): string {
        return 'calendar';
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
            this.logger.warn('Google Calendar not configured, skipping');
            return { documents: [], newCursor: {}, hasMore: false };
        }

        try {
            const token = await this.googleAuthService.getAccessToken(['https://www.googleapis.com/auth/calendar.readonly']);

            const calendarIdsToFetch = request.calendarIds && request.calendarIds.length > 0
                ? request.calendarIds
                : ['primary'];

            // Pagination state from cursor metadata
            const calendarIndex = (cursor?.metadata?.calendarIndex as number | undefined) ?? 0;
            const pageToken = cursor?.metadata?.pageToken as string | undefined;
            const calendarId = calendarIdsToFetch[calendarIndex] || calendarIdsToFetch[0];

            const params: any = {
                maxResults: 250,
                singleEvents: true,
                orderBy: 'startTime',
                timeMin: (cursor?.lastSync && !request.fullReindex) ? new Date(cursor.lastSync).toISOString() : undefined,
            };

            if (pageToken) {
                params.pageToken = pageToken;
            } else if (!request.fullReindex && cursor?.syncToken && !cursor.metadata?.pageToken) {
                params.syncToken = cursor.syncToken;
            }

            let response;
            try {
                response = await axios.get(
                    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
                    { headers: { 'Authorization': `Bearer ${token}` }, params },
                );
            } catch (error) {
                if (axios.isAxiosError(error) && error.response?.status === 410) {
                    this.logger.warn(`Sync token for calendar ${calendarId} is invalid. Re-fetching without syncToken.`);
                    delete params.syncToken;
                    delete params.pageToken;
                    response = await axios.get(
                        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
                        { headers: { 'Authorization': `Bearer ${token}` }, params },
                    );
                } else {
                    throw error;
                }
            }

            const events: any[] = response.data.items || [];
            const nextPageToken: string | undefined = response.data.nextPageToken;
            const googleSyncToken: string | undefined = response.data.nextSyncToken;

            const documents: IndexDocument[] = [];
            for (const event of events) {
                if (event.status === 'cancelled') continue;

                documents.push({
                    id: event.id,
                    source: 'calendar',
                    content: this.buildEventContent(event),
                    metadata: {
                        id: event.id,
                        source: 'calendar',
                        type: 'event',
                        title: event.summary || 'No Title',
                        summary: event.summary || 'No Title',
                        description: event.description,
                        location: event.location,
                        start: event.start?.dateTime || event.start?.date,
                        end: event.end?.dateTime || event.end?.date,
                        attendees: event.attendees?.filter((a: any) => a.email).map((a: any) => a.email) || [],
                        organizer: event.organizer?.email || 'unknown',
                        status: event.status,
                        url: event.htmlLink,
                        createdAt: event.created,
                        updatedAt: event.updated,
                        search_context: `${event.summary || ''} ${event.description || ''} ${event.location || ''} ${event.organizer?.email || ''}`,
                    },
                });
            }

            // Determine if there's more: either more pages for this calendar, or more calendars
            const hasMorePages = !!nextPageToken;
            const hasMoreCalendars = calendarIndex + 1 < calendarIdsToFetch.length;
            const hasMore = hasMorePages || hasMoreCalendars;

            // Build the next cursor metadata for pagination
            const nextCalendarIndex = hasMorePages ? calendarIndex : calendarIndex + 1;
            const nextCursorPageToken = hasMorePages ? nextPageToken : undefined;

            let batchLastSync: string | undefined;
            if (documents.length > 0) {
                const lastDoc = documents.reduce((prev, current) => {
                    const prevDate = new Date((prev.metadata as any).updatedAt || (prev.metadata as any).start);
                    const currDate = new Date((current.metadata as any).updatedAt || (current.metadata as any).start);
                    return (prevDate > currDate) ? prev : current;
                });
                batchLastSync = (lastDoc.metadata as any).updatedAt || (lastDoc.metadata as any).start;
            }

            this.logger.log(`Calendar fetch: calendarId=${calendarId}, page=${pageToken ? 'yes' : 'initial'}, events=${documents.length}, hasMore=${hasMore}`);

            return {
                documents,
                newCursor: {
                    source: this.getSourceName() as DataSource,
                    syncToken: googleSyncToken || cursor?.syncToken,
                    lastSync: batchLastSync || cursor?.lastSync,
                    metadata: {
                        configKey: calendarIdsToFetch.join(','),
                        calendarIndex: nextCalendarIndex,
                        pageToken: nextCursorPageToken,
                    }
                },
                hasMore,
                batchLastSync,
            };
        } catch (error) {
            this.logger.error(`Failed to fetch from Google Calendar: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    private buildEventContent(event: any): string {
        const parts = [
            `# Event: ${event.summary || 'No Title'}`,
            '',
            `**When**: ${event.start?.dateTime || event.start?.date} - ${event.end?.dateTime || event.end?.date}`,
        ];

        if (event.location) {
            parts.push(`**Where**: ${event.location}`);
        }
        if (event.organizer?.email) {
            parts.push(`**Organizer**: ${event.organizer.email}`);
        }
        if (event.attendees?.length) {
            parts.push(`**Attendees**: ${event.attendees.filter((a: any) => a.email).map((a: any) => a.email).join(', ')}`);
        }
        if (event.description) {
            parts.push('', '## Description', event.description);
        }

        return parts.join('\n');
    }

    async listCalendars(): Promise<any[]> {
        if (!this.isConfigured()) return [];
        try {
            const token = await this.googleAuthService.getAccessToken(['https://www.googleapis.com/auth/calendar.readonly']);
            const response = await axios.get('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            return response.data.items || [];
        } catch (error) {
            this.logger.error(`Failed to list Google Calendars: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
            }
            return [];
        }
    }
}