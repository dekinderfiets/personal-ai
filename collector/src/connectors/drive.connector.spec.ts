import { DriveConnector } from './drive.connector';
import { ConfigService } from '@nestjs/config';
import { GoogleAuthService } from './google-auth.service';
import axios from 'axios';

jest.mock('axios');
jest.mock('child_process');
jest.mock('fs');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DriveConnector', () => {
    let connector: DriveConnector;
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
        connector = new DriveConnector(mockConfigService as any, mockGoogleAuth);
    });

    describe('getSourceName', () => {
        it('should return "drive"', () => {
            expect(connector.getSourceName()).toBe('drive');
        });
    });

    describe('isConfigured', () => {
        it('should return true when all Google config is present', () => {
            expect(connector.isConfigured()).toBe(true);
        });

        it('should return false when any Google config is missing', () => {
            const config = { ...googleConfig, 'google.refreshToken': undefined };
            const mockCfg = { get: jest.fn((key: string) => config[key]) };
            const c = new DriveConnector(mockCfg as any, mockGoogleAuth);
            expect(c.isConfigured()).toBe(false);
        });
    });

    describe('getFileType', () => {
        it('should return "document" for document mime types', () => {
            expect((connector as any).getFileType('application/vnd.google-apps.document')).toBe('document');
            expect((connector as any).getFileType('text/plain')).toBe('document');
        });

        it('should return "spreadsheet" for spreadsheet mime types', () => {
            expect((connector as any).getFileType('application/vnd.google-apps.spreadsheet')).toBe('spreadsheet');
        });

        it('should return "presentation" for presentation mime types', () => {
            expect((connector as any).getFileType('application/vnd.google-apps.presentation')).toBe('presentation');
        });

        it('should return "pdf" for application/pdf', () => {
            expect((connector as any).getFileType('application/pdf')).toBe('pdf');
        });

        it('should return "other" for unknown types', () => {
            expect((connector as any).getFileType('application/json')).toBe('other');
        });
    });

    describe('fetch', () => {
        it('should return empty result when not configured', async () => {
            const mockCfg = { get: jest.fn().mockReturnValue(undefined) };
            const c = new DriveConnector(mockCfg as any, mockGoogleAuth);
            const result = await c.fetch(null, {});
            expect(result).toEqual({ documents: [], newCursor: {}, hasMore: false });
        });

        it('should fetch files and produce correct document structure', async () => {
            mockedAxios.get.mockImplementation(async (url: string, config?: any) => {
                if (url === 'https://www.googleapis.com/drive/v3/files' && !config?.params?.q?.includes('in parents')) {
                    return {
                        data: {
                            files: [{
                                id: 'file1',
                                name: 'Document.txt',
                                mimeType: 'text/plain',
                                parents: ['folder1'],
                                owners: [{ displayName: 'Alice', emailAddress: 'alice@test.com' }],
                                createdTime: '2024-01-01T00:00:00Z',
                                modifiedTime: '2024-01-15T00:00:00Z',
                                webViewLink: 'https://drive.google.com/file/d/file1/view',
                            }],
                        },
                    };
                }
                // File content fetch
                if (url.includes('/files/file1') && url.includes('alt=media')) {
                    return { data: 'File content here' };
                }
                // Folder path resolution
                if (url.includes('/files/folder1')) {
                    return { data: { name: 'MyFolder', parents: [] } };
                }
                return { data: {} };
            });

            const result = await connector.fetch(null, {});

            expect(result.documents.length).toBe(1);
            const doc = result.documents[0];
            expect(doc.id).toBe('drive_file1');
            expect(doc.source).toBe('drive');
            expect(doc.metadata).toMatchObject({
                id: 'file1',
                source: 'drive',
                type: 'document',
                title: 'Document.txt',
                name: 'Document.txt',
                mimeType: 'text/plain',
                owner: 'Alice',
            });
        });

        it('should skip unsupported binary file types', async () => {
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === 'https://www.googleapis.com/drive/v3/files') {
                    return {
                        data: {
                            files: [{
                                id: 'img1',
                                name: 'photo.jpg',
                                mimeType: 'image/jpeg',
                                owners: [{ displayName: 'Alice' }],
                                createdTime: '2024-01-01T00:00:00Z',
                                modifiedTime: '2024-01-15T00:00:00Z',
                                webViewLink: 'https://drive.google.com/file/d/img1/view',
                            }],
                        },
                    };
                }
                return { data: {} };
            });

            const result = await connector.fetch(null, {});
            // Binary file should be skipped (getFileContent returns null)
            expect(result.documents.length).toBe(0);
        });

        it('should handle stale pageToken 400 error', async () => {
            const axiosError = new Error('Bad Request') as any;
            axiosError.response = {
                status: 400,
                data: {
                    error: {
                        errors: [{ location: 'pageToken' }],
                        message: 'Invalid pageToken',
                    },
                },
            };
            axiosError.isAxiosError = true;
            mockedAxios.isAxiosError.mockReturnValue(true);
            mockedAxios.get.mockRejectedValueOnce(axiosError);

            const cursor = {
                source: 'drive' as const,
                lastSync: '2024-01-01T00:00:00Z',
                syncToken: 'stale-page-token',
            };
            const result = await connector.fetch(cursor, {});

            expect(result.documents).toEqual([]);
            expect(result.hasMore).toBe(false);
            expect(result.newCursor.lastSync).toBe('2024-01-01T00:00:00Z');
        });

        it('should include lastSync in query for incremental sync', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: { files: [] } });

            const cursor = { source: 'drive' as const, lastSync: '2024-06-01T00:00:00Z' };
            await connector.fetch(cursor, {});

            const call = mockedAxios.get.mock.calls[0];
            expect(call[1]?.params.q).toContain("modifiedTime > '2024-06-01T00:00:00Z'");
        });

        it('should set hasMore=true when nextPageToken present', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: { files: [], nextPageToken: 'next-page' },
            });

            const result = await connector.fetch(null, {});

            expect(result.hasMore).toBe(true);
            expect(result.newCursor.syncToken).toBe('next-page');
        });

        it('should set hasMore=false when no nextPageToken', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: { files: [] } });

            const result = await connector.fetch(null, {});

            expect(result.hasMore).toBe(false);
        });

        it('should throw non-pageToken 400 errors', async () => {
            const axiosError = new Error('Bad Request') as any;
            axiosError.response = {
                status: 400,
                data: { error: { message: 'Some other error' } },
            };
            axiosError.isAxiosError = true;
            mockedAxios.isAxiosError.mockReturnValue(true);
            mockedAxios.get.mockRejectedValueOnce(axiosError);

            await expect(connector.fetch(null, {})).rejects.toThrow('Bad Request');
        });
    });

    describe('getFilePath', () => {
        it('should return /filename when no parents', async () => {
            const file = { id: 'f1', name: 'test.txt', mimeType: 'text/plain' } as any;
            const path = await (connector as any).getFilePath('token', file);
            expect(path).toBe('/test.txt');
        });

        it('should resolve folder hierarchy', async () => {
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url.includes('/files/parent1')) {
                    return { data: { name: 'ParentFolder', parents: ['root'] } };
                }
                if (url.includes('/files/root')) {
                    return { data: { name: 'My Drive' } };
                }
                return { data: {} };
            });

            const file = { id: 'f1', name: 'test.txt', mimeType: 'text/plain', parents: ['parent1'] } as any;
            const path = await (connector as any).getFilePath('token', file);
            expect(path).toContain('ParentFolder');
            expect(path).toContain('test.txt');
        });
    });
});
