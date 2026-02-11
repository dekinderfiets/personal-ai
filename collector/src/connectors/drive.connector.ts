import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { BaseConnector } from './base.connector';
import { Cursor, IndexRequest, ConnectorResult, IndexDocument, DriveDocument, DataSource } from '../types';
import { GoogleAuthService } from './google-auth.service';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';

const execAsync = promisify(exec);


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

    constructor(
        private configService: ConfigService,
        private googleAuthService: GoogleAuthService,
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
                const folderConditions = request.folderIds.map(id => `'${id}' in parents`).join(' or ');
                conditions.push(`(${folderConditions})`);
            }

            const response = await axios.get<{ files: DriveFile[]; nextPageToken?: string }>(
                'https://www.googleapis.com/drive/v3/files', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    q: conditions.join(' and '),
                    pageSize: 50,
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
                        const content = await this.getFileContent(token, file);
                        if (!content) return null;

                        const path = await this.getFilePath(token, file);
                        return {
                            id: `drive_${file.id}`,
                            source: 'drive',
                            content: `File: ${file.name}\nPath: ${path}\n\n${content}`,
                            metadata: {
                                id: file.id,
                                source: 'drive',
                                type: this.getFileType(file.mimeType),
                                title: file.name,
                                name: file.name,
                                mimeType: file.mimeType,
                                path,
                                owner: file.owners?.[0]?.displayName || 'Unknown',
                                createdAt: file.createdTime,
                                modifiedAt: file.modifiedTime,
                                url: file.webViewLink,
                            },
                        };
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

    private async getFileContent(token: string, file: DriveFile): Promise<string | null> {
        // Skip unsupported binary types
        const unsupportedTypes = [
            'application/zip',
            'application/x-zip-compressed',
            'application/x-compress',
            'application/x-compressed',
            'application/octet-stream',
            'application/x-tar',
            'application/x-gzip',
            'application/x-bzip2',
            'application/x-7z-compressed',
            'image/',
            'video/',
            'audio/',
        ];

        if (unsupportedTypes.some(type => file.mimeType.startsWith(type))) {
            this.logger.debug(`Skipping unsupported binary file: ${file.name} (${file.mimeType})`);
            return null;
        }

        this.logger.debug(`Fetching content for ${file.name} (${file.mimeType})`);
        const isPdf = file.mimeType === 'application/pdf';
        const isGoogleDoc = file.mimeType === 'application/vnd.google-apps.document';
        const isGoogleSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';
        const isGoogleSlide = file.mimeType === 'application/vnd.google-apps.presentation';
        const isGoogleApp = file.mimeType.startsWith('application/vnd.google-apps');

        const isDocx = file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const isXlsx = file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const isPptx = file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

        let url: string;
        let responseType: 'text' | 'arraybuffer' = 'text';

        if (isGoogleDoc) {
            url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
        } else if (isGoogleSheet) {
            url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`;
        } else if (isGoogleSlide) {
            url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=application/pdf`;
            responseType = 'arraybuffer';
        } else if (isGoogleApp) {
            // Unhandled google app type, skip for now to avoid 400 errors
            this.logger.warn(`Skipping unsupported Google App type: ${file.mimeType} (${file.name})`);
            return null;
        } else {
            url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
            if (isPdf || isDocx || isXlsx || isPptx) {
                responseType = 'arraybuffer';
            }
        }

        try {
            const response = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${token}` },
                responseType,
                maxContentLength: 20 * 1024 * 1024, // 20MB limit
            });

            if (isPdf || isGoogleSlide) {
                return await this.extractTextFromPdf(Buffer.from(response.data), file.name);
            }

            if (isDocx) {
                return await this.usePandoc(Buffer.from(response.data), 'docx', file.name);
            }
            if (isXlsx) {
                return await this.usePandoc(Buffer.from(response.data), 'xlsx', file.name);
            }
            if (isPptx) {
                return await this.usePandoc(Buffer.from(response.data), 'pptx', file.name);
            }

            let content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

            // Use Pandoc for HTML or CSV (from Sheets)
            if (content.includes('<html') || content.includes('<body') || file.mimeType === 'text/html') {
                return await this.usePandoc(content, 'html', file.name);
            }

            if (isGoogleSheet || file.mimeType === 'text/csv') {
                return await this.usePandoc(content, 'csv', file.name);
            }

            return content;
        } catch (error) {
            this.logger.error(`Failed to fetch/convert content for file ${file.name}: ${error.message}`);
            return `[Content could not be extracted: ${error.message}]`;
        }
    }

    private async extractTextFromPdf(buffer: Buffer, fileName: string): Promise<string> {
        const tempDir = os.tmpdir();
        const inputPath = path.join(tempDir, `input_${Date.now()}.pdf`);

        try {
            fs.writeFileSync(inputPath, buffer);

            const { stdout, stderr } = await execAsync(`pdftotext -layout "${inputPath}" -`);
            if (stderr) {
                this.logger.warn(`pdftotext stderr for ${fileName}: ${stderr}`);
            }
            return stdout;
        } catch (error) {
            this.logger.error(`PDF extraction failed for ${fileName}: ${error.message}`);
            return `[PDF Content could not be extracted: ${error.message}]`;
        } finally {
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }
        }
    }

    private async usePandoc(content: string | Buffer, fromFormat: string, fileName: string): Promise<string> {
        const tempDir = os.tmpdir();
        const extension = fromFormat === 'html' ? 'html' :
            fromFormat === 'csv' ? 'csv' :
                fromFormat === 'docx' ? 'docx' :
                    fromFormat === 'xlsx' ? 'xlsx' :
                        fromFormat === 'pptx' ? 'pptx' : 'txt';
        const inputPath = path.join(tempDir, `input_${Date.now()}.${extension}`);

        try {
            fs.writeFileSync(inputPath, content);

            const { stdout, stderr } = await execAsync(`pandoc "${inputPath}" -f ${fromFormat} -t markdown`);
            if (stderr) {
                this.logger.warn(`Pandoc stderr for ${fileName}: ${stderr}`);
            }
            return stdout;
        } catch (error) {
            this.logger.error(`Pandoc conversion failed for ${fileName}: ${error.message}`);
            return content.toString();
        } finally {
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }
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

    private getFileType(mimeType: string): 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'other' {
        if (mimeType.includes('document') || mimeType.includes('text')) return 'document';
        if (mimeType.includes('spreadsheet')) return 'spreadsheet';
        if (mimeType.includes('presentation')) return 'presentation';
        if (mimeType === 'application/pdf') return 'pdf';
        return 'other';
    }
}
