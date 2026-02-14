import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { BaseConnector } from './base.connector';
import { Cursor, IndexRequest, ConnectorResult, IndexDocument, DriveDocument, DataSource } from '../types';
import { GoogleAuthService } from './google-auth.service';
import { FileProcessorService } from '../indexing/file-processor.service';


interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    parents?: string[];
    owners?: Array<{ displayName: string; emailAddress: string }>;
    createdTime: string;
    modifiedTime: string;
    webViewLink: string;
    permissions?: Array<{ emailAddress: string; displayName: string }>;
}

@Injectable()
export class DriveConnector extends BaseConnector {
    private readonly logger = new Logger(DriveConnector.name);
    private folderPathCache: Map<string, string> = new Map();
    private subfolderCache: Map<string, string[]> = new Map();

    constructor(
        private configService: ConfigService,
        private googleAuthService: GoogleAuthService,
        private fileProcessorService: FileProcessorService,
    ) {
        super();
    }

    getSourceName(): string {
        return 'drive';
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
            this.logger.warn('Google Drive not configured, skipping');
            return { documents: [], newCursor: {}, hasMore: false };
        }

        try {
            const token = await this.googleAuthService.getAccessToken(['https://www.googleapis.com/auth/drive.readonly']);
            const documents: IndexDocument[] = [];
            const lastSync = cursor?.lastSync;
            const pageToken = cursor?.syncToken;

            const conditions = ["mimeType != 'application/vnd.google-apps.folder'", 'trashed = false'];
            if (lastSync && !request.fullReindex) {
                conditions.push(`modifiedTime > '${lastSync}'`);
            }
            if (request.folderIds?.length) {
                // Recursively resolve all subfolder IDs under each configured folder
                const allFolderIds = await this.resolveAllSubfolderIds(token, request.folderIds);
                const folderConditions = allFolderIds.map(id => `'${id}' in parents`).join(' or ');
                conditions.push(`(${folderConditions})`);
            }

            const response = await axios.get<{ files: DriveFile[]; nextPageToken?: string }>(
                'https://www.googleapis.com/drive/v3/files', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    q: conditions.join(' and '),
                    pageSize: 100,
                    pageToken: pageToken || undefined,
                    fields: 'nextPageToken,files(id,name,mimeType,parents,owners,createdTime,modifiedTime,webViewLink,permissions)',
                    orderBy: 'modifiedTime asc', // Process oldest changes first
                },
            });

            this.logger.debug(`Found ${response.data.files?.length || 0} files to process`);

            // Process files in small parallel batches to speed up indexing without hitting rate limits
            const BATCH_SIZE = 5;
            const files = response.data.files || [];

            for (let i = 0; i < files.length; i += BATCH_SIZE) {
                const batch = files.slice(i, i + BATCH_SIZE);
                this.logger.debug(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)} (${batch.length} files)`);

                const results = await Promise.all(batch.map(async (file) => {
                    try {
                        const fileResult = await this.getFileContent(token, file);
                        if (!fileResult) return null;

                        const path = await this.getFilePath(token, file);
                        // Extract parent folder path for search context
                        const lastSlash = path.lastIndexOf('/');
                        const folderPath = lastSlash > 0 ? path.substring(0, lastSlash) : '/';
                        const doc: DriveDocument = {
                            id: `drive_${file.id}`,
                            source: 'drive',
                            content: `File: ${file.name}\nPath: ${path}\n\n${fileResult.content}`,
                            metadata: {
                                id: file.id,
                                source: 'drive',
                                type: this.getFileType(file.mimeType),
                                title: file.name,
                                name: file.name,
                                mimeType: file.mimeType,
                                path,
                                folderPath,
                                owner: file.owners?.[0]?.displayName || 'Unknown',
                                createdAt: file.createdTime,
                                modifiedAt: file.modifiedTime,
                                url: file.webViewLink,
                            },
                        };
                        if (fileResult.preChunked) {
                            doc.preChunked = fileResult.preChunked;
                        }
                        return doc;
                    } catch (err) {
                        this.logger.error(`Error processing file ${file.name}: ${err.message}`);
                        return null;
                    }
                }));

                documents.push(...results.filter((doc): doc is DriveDocument => doc !== null));
            }

            const newPageToken = response.data.nextPageToken;
            const hasMore = !!newPageToken;

            // Get the modifiedTime of the last file in this batch for the cursor
            const lastFile = files[files.length - 1];
            const batchLastSync = lastFile ? lastFile.modifiedTime : undefined;

            return {
                documents,
                newCursor: {
                    source: this.getSourceName() as DataSource,
                    syncToken: newPageToken,
                    lastSync: batchLastSync,
                },
                hasMore,
                batchLastSync,
            };
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 400) {
                const errorData = error.response?.data?.error;
                const isPageTokenError =
                    errorData?.errors?.some((e: any) => e.location === 'pageToken') ||
                    errorData?.message?.includes('pageToken');

                if (isPageTokenError) {
                    this.logger.warn(
                        `Invalid pageToken for Drive fetch — the token is stale or the query changed between batches. ` +
                        `Resetting pagination to restart from the last known sync time.`,
                    );
                    return {
                        documents: [],
                        newCursor: {
                            source: this.getSourceName() as DataSource,
                            lastSync: cursor?.lastSync,
                            // Intentionally omit syncToken to clear the stale pageToken
                        },
                        hasMore: false,
                    };
                }
            }
            this.logger.error(`Failed to fetch from Google Drive: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    private async getFileContent(token: string, file: DriveFile): Promise<{ content: string; preChunked?: { chunks: string[] } } | null> {
        const isGoogleDoc = file.mimeType === 'application/vnd.google-apps.document';
        const isGoogleSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';
        const isGoogleSlide = file.mimeType === 'application/vnd.google-apps.presentation';
        const isGoogleApp = file.mimeType.startsWith('application/vnd.google-apps');

        let url: string;
        let responseType: 'text' | 'arraybuffer' = 'text';
        let effectiveMimeType = file.mimeType;

        if (isGoogleDoc) {
            url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
            effectiveMimeType = 'text/plain';
        } else if (isGoogleSheet) {
            url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`;
            effectiveMimeType = 'text/csv';
        } else if (isGoogleSlide) {
            url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=application/pdf`;
            responseType = 'arraybuffer';
            effectiveMimeType = 'application/pdf';
        } else if (isGoogleApp) {
            this.logger.warn(`Skipping unsupported Google App type: ${file.mimeType} (${file.name})`);
            return null;
        } else {
            url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
            const needsBinary = [
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            ].includes(file.mimeType);
            if (needsBinary) responseType = 'arraybuffer';
        }

        try {
            const response = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${token}` },
                responseType,
                maxContentLength: 20 * 1024 * 1024,
            });

            const rawContent = responseType === 'arraybuffer' ? Buffer.from(response.data) : response.data;
            const result = await this.fileProcessorService.process(rawContent, file.name, effectiveMimeType);
            if (!result) return null;

            return {
                content: result.content,
                preChunked: result.chunks ? { chunks: result.chunks } : undefined,
            };
        } catch (error) {
            this.logger.error(`Failed to fetch/convert content for file ${file.name}: ${(error as Error).message}`);
            return null;
        }
    }

    private async getFilePath(token: string, file: DriveFile): Promise<string> {
        if (!file.parents?.length) return `/${file.name}`;
        const parentId = file.parents[0];
        if (this.folderPathCache.has(parentId)) {
            return `${this.folderPathCache.get(parentId)}/${file.name}`;
        }
        try {
            const path = await this.buildPath(token, parentId);
            const fullPath = `/${path}/${file.name}`;
            this.folderPathCache.set(parentId, `/${path}`);
            return fullPath;
        } catch {
            return `/${file.name}`;
        }
    }

    private async buildPath(token: string, folderId: string): Promise<string> {
        let path = '';
        let currentId = folderId;
        const seen = new Set<string>();
        while (currentId && !seen.has(currentId)) {
            seen.add(currentId);
            try {
                const response = await axios.get(`https://www.googleapis.com/drive/v3/files/${currentId}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    params: { fields: 'name,parents' },
                });
                path = path ? `${response.data.name}/${path}` : response.data.name;
                currentId = response.data.parents?.[0];
            } catch (error) {
                this.logger.warn(`Could not resolve parent folder ${currentId}`);
                break;
            }
        }
        return path;
    }

    async listFolders(parentId?: string): Promise<any[]> {
        return this.listChildren(parentId, true);
    }

    async listChildren(parentId?: string, foldersOnly: boolean = false): Promise<any[]> {
        const token = await this.googleAuthService.getAccessToken(['https://www.googleapis.com/auth/drive.readonly']);

        let q = parentId
            ? `'${parentId}' in parents and trashed = false`
            : "'root' in parents and trashed = false";

        if (foldersOnly) {
            q += " and mimeType = 'application/vnd.google-apps.folder'";
        }

        const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
            headers: { 'Authorization': `Bearer ${token}` },
            params: {
                q,
                fields: 'files(id, name, mimeType, iconLink)',
                orderBy: 'folder,name',
            },
        });

        return response.data.files || [];
    }

    /**
     * Recursively resolves all subfolder IDs under each of the given parent folder IDs.
     * Returns a deduplicated list containing the original parent IDs plus all descendant folder IDs.
     * Results are cached per parent folder to avoid redundant API calls across pagination batches.
     */
    private async resolveAllSubfolderIds(token: string, parentFolderIds: string[]): Promise<string[]> {
        const allIds = new Set<string>(parentFolderIds);

        for (const parentId of parentFolderIds) {
            const descendants = await this.getDescendantFolderIds(token, parentId);
            for (const id of descendants) {
                allIds.add(id);
            }
        }

        this.logger.debug(`Resolved ${parentFolderIds.length} configured folders into ${allIds.size} total folders (including subfolders)`);
        return Array.from(allIds);
    }

    /**
     * Recursively fetches all descendant folder IDs under a given parent folder.
     * Uses subfolderCache to avoid redundant API calls.
     */
    private async getDescendantFolderIds(token: string, folderId: string): Promise<string[]> {
        if (this.subfolderCache.has(folderId)) {
            return this.subfolderCache.get(folderId)!;
        }

        const descendants: string[] = [];
        const queue: string[] = [folderId];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) continue;
            visited.add(currentId);

            try {
                let pageToken: string | undefined;
                do {
                    const response = await axios.get<{ files: Array<{ id: string }>; nextPageToken?: string }>(
                        'https://www.googleapis.com/drive/v3/files',
                        {
                            headers: { 'Authorization': `Bearer ${token}` },
                            params: {
                                q: `'${currentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                                fields: 'nextPageToken,files(id)',
                                pageSize: 100,
                                pageToken: pageToken || undefined,
                            },
                        },
                    );

                    const subfolders = response.data.files || [];
                    for (const folder of subfolders) {
                        descendants.push(folder.id);
                        queue.push(folder.id);
                    }
                    pageToken = response.data.nextPageToken;
                } while (pageToken);
            } catch (error) {
                this.logger.warn(`Failed to list subfolders for ${currentId}: ${(error as Error).message}`);
            }
        }

        this.subfolderCache.set(folderId, descendants);
        return descendants;
    }

    private getFileType(mimeType: string): 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'other' {
        if (mimeType.includes('document') || mimeType.includes('text')) return 'document';
        if (mimeType.includes('spreadsheet')) return 'spreadsheet';
        if (mimeType.includes('presentation')) return 'presentation';
        if (mimeType === 'application/pdf') return 'pdf';
        return 'other';
    }
}
