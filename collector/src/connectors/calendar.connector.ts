import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { BaseConnector } from './base.connector';
import { Cursor, IndexRequest, ConnectorResult, IndexDocument, DataSource } from '../types';
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
            const documents: IndexDocument[] = [];
            let nextPageToken: string | undefined = cursor?.syncToken;
            let syncToken: string | undefined = undefined; // Google Calendar's true syncToken

            const calendarIdsToFetch = request.calendarIds && request.calendarIds.length > 0
                ? request.calendarIds
                : ['primary']; // Default to primary calendar if none specified

            let allEvents: any[] = [];
            let hasMore = false;
            let batchLastSync: string | undefined;

            for (const calendarId of calendarIdsToFetch) {
                let currentCalendarNextPageToken: string | undefined = nextPageToken;
                let currentCalendarSyncToken: string | undefined = undefined; // per-calendar sync token

                do {
                    const params: any = {
                        maxResults: 250, // Max results per page
                        singleEvents: true, // Expand recurring events
                        orderBy: 'startTime',
                        timeMin: (cursor?.lastSync && !request.fullReindex) ? new Date(cursor.lastSync).toISOString() : undefined,
                    };

                    if (currentCalendarNextPageToken) {
                        params.pageToken = currentCalendarNextPageToken;
                    } else if (cursor?.metadata?.configKey === calendarId && cursor?.syncToken) {
                        // Use the full syncToken for the initial fetch if available and not using pageToken
                        params.syncToken = cursor.syncToken;
                    }

                    const response = await axios.get(
                        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
                        {
                            headers: { 'Authorization': `Bearer ${token}` },
                            params,
                        },
                    );

                    allEvents.push(...(response.data.items || []));
                    currentCalendarNextPageToken = response.data.nextPageToken;
                    currentCalendarSyncToken = response.data.nextSyncToken; // Capture the sync token for this calendar

                    // If we get a 410, syncToken is invalid, clear it and re-fetch without syncToken
                    if (response.status === 410) {
                        this.logger.warn(`Sync token for calendar ${calendarId} is invalid. Performing full reindex for this calendar.`);
                        currentCalendarNextPageToken = undefined; // Reset for re-fetch
                        currentCalendarSyncToken = undefined; // Clear invalid sync token
                        params.syncToken = undefined; // Remove from next request
                        params.pageToken = undefined; // Remove from next request
                        // Re-fetch without syncToken and pageToken
                        const fullReindexResponse = await axios.get(
                            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
                            {
                                headers: { 'Authorization': `Bearer ${token}` },
                                params: {
                                    maxResults: 250,
                                    singleEvents: true,
                                    orderBy: 'startTime',
                                },
                            },
                        );
                        allEvents.push(...(fullReindexResponse.data.items || []));
                        currentCalendarNextPageToken = fullReindexResponse.data.nextPageToken;
                        currentCalendarSyncToken = fullReindexResponse.data.nextSyncToken;
                    }


                    // If any calendar has a nextPageToken, then we potentially have more to fetch in total
                    if (currentCalendarNextPageToken) {
                        hasMore = true;
                    }

                } while (currentCalendarNextPageToken);

                if (currentCalendarSyncToken) {
                    syncToken = currentCalendarSyncToken; // Take the last sync token encountered
                }
            }


            for (const event of allEvents) {
                if (event.status === 'cancelled') {
                    // For cancelled events, we might need to delete them from the index
                    // For now, we just skip indexing them.
                    this.logger.log(`Skipping cancelled event: ${event.summary} (${event.id})`);
                    continue;
                }

                const doc: IndexDocument = {
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
                };
                documents.push(doc);
            }

            // Determine the batchLastSync from the documents that were actually indexed
            if (documents.length > 0) {
                // Assuming events are ordered by 'updated' or 'startTime' from the API,
                // the last document's updated date is a good candidate.
                const lastIndexedEvent = documents.reduce((prev, current) => {
                    const prevDate = new Date((prev.metadata as any).updatedAt || (prev.metadata as any).start);
                    const currDate = new Date((current.metadata as any).updatedAt || (current.metadata as any).start);
                    return (prevDate > currDate) ? prev : current;
                });
                batchLastSync = (lastIndexedEvent.metadata as any).updatedAt || (lastIndexedEvent.metadata as any).start;
            }


            return {
                documents,
                newCursor: {
                    source: this.getSourceName() as DataSource,
                    // We only use the syncToken from Google for subsequent full syncs, not for pagination
                    syncToken: syncToken,
                    lastSync: batchLastSync || cursor?.lastSync,
                    metadata: {
                        configKey: calendarIdsToFetch.join(',') // Store which calendars were synced
                    }
                },
                hasMore: hasMore, // Rely on the overall hasMore flag from all calendars
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