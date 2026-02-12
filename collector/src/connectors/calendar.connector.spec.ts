import { CalendarConnector } from './calendar.connector';
import { ConfigService } from '@nestjs/config';
import { GoogleAuthService } from './google-auth.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CalendarConnector', () => {
    let connector: CalendarConnector;
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
        connector = new CalendarConnector(mockConfigService as any, mockGoogleAuth);
    });

    describe('getSourceName', () => {
        it('should return "calendar"', () => {
            expect(connector.getSourceName()).toBe('calendar');
        });
    });

    describe('isConfigured', () => {
        it('should return true when all Google config is present', () => {
            expect(connector.isConfigured()).toBe(true);
        });

        it('should return false when any Google config is missing', () => {
            const config = { ...googleConfig, 'google.clientId': undefined };
            const mockCfg = { get: jest.fn((key: string) => config[key]) };
            const c = new CalendarConnector(mockCfg as any, mockGoogleAuth);
            expect(c.isConfigured()).toBe(false);
        });
    });

    describe('fetch', () => {
        const makeEvent = (overrides: any = {}) => ({
            id: 'event1',
            summary: 'Team Meeting',
            description: 'Weekly sync',
            location: 'Room A',
            status: 'confirmed',
            start: { dateTime: '2024-01-15T10:00:00Z' },
            end: { dateTime: '2024-01-15T11:00:00Z' },
            attendees: [{ email: 'alice@test.com' }, { email: 'bob@test.com' }],
            organizer: { email: 'alice@test.com' },
            htmlLink: 'https://calendar.google.com/event?eid=abc',
            created: '2024-01-01T00:00:00Z',
            updated: '2024-01-10T00:00:00Z',
            ...overrides,
        });

        it('should return empty result when not configured', async () => {
            const mockCfg = { get: jest.fn().mockReturnValue(undefined) };
            const c = new CalendarConnector(mockCfg as any, mockGoogleAuth);
            const result = await c.fetch(null, {});
            expect(result).toEqual({ documents: [], newCursor: {}, hasMore: false });
        });

        it('should fetch events and produce correct document structure', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    items: [makeEvent()],
                    nextSyncToken: 'sync-token-1',
                },
            });

            const result = await connector.fetch(null, {});

            expect(result.documents.length).toBe(1);
            const doc = result.documents[0];
            expect(doc.id).toBe('event1');
            expect(doc.source).toBe('calendar');
            expect(doc.metadata).toMatchObject({
                id: 'event1',
                source: 'calendar',
                type: 'event',
                title: 'Team Meeting',
                summary: 'Team Meeting',
                location: 'Room A',
                attendees: ['alice@test.com', 'bob@test.com'],
                organizer: 'alice@test.com',
                status: 'confirmed',
            });
            expect(doc.content).toContain('# Event: Team Meeting');
        });

        it('should skip cancelled events', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    items: [
                        makeEvent({ id: 'e1', status: 'cancelled' }),
                        makeEvent({ id: 'e2', status: 'confirmed' }),
                    ],
                },
            });

            const result = await connector.fetch(null, {});

            expect(result.documents.length).toBe(1);
            expect(result.documents[0].id).toBe('e2');
        });

        it('should handle multi-calendar pagination (calendarIndex + pageToken)', async () => {
            // First calendar returns events with nextPageToken
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    items: [makeEvent({ id: 'e1' })],
                    nextPageToken: 'page-2',
                },
            });

            const result = await connector.fetch(null, { calendarIds: ['cal1', 'cal2'] });

            expect(result.hasMore).toBe(true);
            expect(result.newCursor.metadata).toMatchObject({
                calendarIndex: 0, // same calendar (has more pages)
                pageToken: 'page-2',
            });
        });

        it('should advance to next calendar when current calendar has no more pages', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    items: [makeEvent({ id: 'e1' })],
                    nextSyncToken: 'sync-1',
                    // No nextPageToken
                },
            });

            const result = await connector.fetch(null, { calendarIds: ['cal1', 'cal2'] });

            expect(result.hasMore).toBe(true);
            expect(result.newCursor.metadata).toMatchObject({
                calendarIndex: 1,
                pageToken: undefined,
            });
        });

        it('should set hasMore=false when all calendars processed', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    items: [makeEvent()],
                    nextSyncToken: 'sync-1',
                },
            });

            const result = await connector.fetch(null, { calendarIds: ['cal1'] });

            expect(result.hasMore).toBe(false);
        });

        it('should retry on 410 error (invalid sync token)', async () => {
            const goneError = new Error('Gone') as any;
            goneError.response = { status: 410, data: {} };
            goneError.isAxiosError = true;
            mockedAxios.isAxiosError.mockReturnValue(true);

            // First call throws 410, second succeeds
            mockedAxios.get
                .mockRejectedValueOnce(goneError)
                .mockResolvedValueOnce({
                    data: {
                        items: [makeEvent()],
                        nextSyncToken: 'new-sync-token',
                    },
                });

            const cursor = {
                source: 'calendar' as const,
                lastSync: '2024-01-01',
                syncToken: 'stale-sync-token',
            };
            const result = await connector.fetch(cursor, {});

            expect(result.documents.length).toBe(1);
            // Should have called get twice (first failed, second succeeded without syncToken)
            expect(mockedAxios.get).toHaveBeenCalledTimes(2);
        });

        it('should pick the latest updatedAt for batchLastSync', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    items: [
                        makeEvent({ id: 'e1', updated: '2024-01-10T00:00:00Z' }),
                        makeEvent({ id: 'e2', updated: '2024-06-15T12:00:00Z' }),
                        makeEvent({ id: 'e3', updated: '2024-03-01T00:00:00Z' }),
                    ],
                },
            });

            const result = await connector.fetch(null, {});

            expect(result.batchLastSync).toBe('2024-06-15T12:00:00Z');
        });

        it('should use "primary" calendar when no calendarIds specified', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: { items: [] },
            });

            await connector.fetch(null, {});

            const call = mockedAxios.get.mock.calls[0];
            expect(call[0]).toContain('/calendars/primary/events');
        });

        it('should build event content with location and attendees', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    items: [makeEvent()],
                },
            });

            const result = await connector.fetch(null, {});
            const content = result.documents[0].content;

            expect(content).toContain('**When**:');
            expect(content).toContain('**Where**: Room A');
            expect(content).toContain('**Organizer**: alice@test.com');
            expect(content).toContain('**Attendees**:');
            expect(content).toContain('## Description');
            expect(content).toContain('Weekly sync');
        });

        it('should use cursor metadata for continuing pagination', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    items: [makeEvent({ id: 'e2' })],
                    nextSyncToken: 'sync-2',
                },
            });

            const cursor = {
                source: 'calendar' as const,
                lastSync: '2024-01-01',
                metadata: { calendarIndex: 1, pageToken: 'page-xyz' },
            };
            await connector.fetch(cursor, { calendarIds: ['cal1', 'cal2'] });

            const call = mockedAxios.get.mock.calls[0];
            expect(call[0]).toContain('/calendars/cal2/events');
            expect(call[1]?.params.pageToken).toBe('page-xyz');
        });
    });
});
