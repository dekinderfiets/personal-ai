import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as CryptoJS from 'crypto-js';
import { CursorService } from './cursor.service';
import { FileSaverService } from './file-saver.service';
import { JiraConnector } from '../connectors/jira.connector';
import { SlackConnector } from '../connectors/slack.connector';
import { GmailConnector } from '../connectors/gmail.connector';
import { DriveConnector } from '../connectors/drive.connector';
import { ConfluenceConnector } from '../connectors/confluence.connector';
import { CalendarConnector } from '../connectors/calendar.connector';
import { DataSource, IndexRequest, IndexStatus, IndexDocument, Cursor, ConnectorResult, SourceSettings } from '../types';
import { SettingsService } from './settings.service';
import { BaseConnector } from 'src/connectors/base.connector';

@Injectable()
export class IndexingService implements OnModuleInit {
    private readonly logger = new Logger(IndexingService.name);
    private readonly connectors: Map<DataSource, BaseConnector>;
    private readonly allSources: DataSource[];

    constructor(
        private cursorService: CursorService,
        private fileSaverService: FileSaverService,
        private settingsService: SettingsService,
        jira: JiraConnector,
        slack: SlackConnector,
        gmail: GmailConnector,
        drive: DriveConnector,
        confluence: ConfluenceConnector,
        calendar: CalendarConnector,
    ) {
        this.connectors = new Map<DataSource, BaseConnector>([
            ['jira', jira],
            ['slack', slack],
            ['gmail', gmail],
            ['drive', drive],
            ['confluence', confluence],
            ['calendar', calendar],
        ]);
        this.allSources = Array.from(this.connectors.keys());
    }

    async onModuleInit() {
        // Clean up stale jobs on startup
        for (const source of this.allSources) {
            const status = await this.cursorService.getJobStatus(source);
            if (status?.status === 'running') {
                this.logger.warn(`Found stale 'running' job for ${source} on startup. Marking as error and releasing lock.`);
                await this.updateStatus(source, {
                    status: 'error',
                    error: 'Service restarted during indexing.',
                });
                await this.cursorService.releaseLock(source);
            }
        }
    }

    private getConnector(source: DataSource): BaseConnector {
        const connector = this.connectors.get(source);
        if (!connector) {
            throw new Error(`No connector found for source: ${source}`);
        }
        return connector;
    }

    async startIndexing(source: DataSource, request: IndexRequest = {}): Promise<{ started: boolean; message: string }> {
        const lockAcquired = await this.cursorService.acquireLock(source);
        if (!lockAcquired) {
            return { started: false, message: 'Indexing already in progress' };
        }

        // Don't wait for the promise to resolve
        this.runIndexing(source, request).finally(() => {
            this.cursorService.releaseLock(source);
        });

        return { started: true, message: 'Indexing started in background' };
    }

    private async runIndexing(source: DataSource, request: IndexRequest): Promise<void> {
        this.logger.log(`Starting indexing for ${source}...`);
        await this.updateStatus(source, {
            status: 'running',
            documentsIndexed: 0,
            error: '',
            lastError: undefined
        });

        try {
            const connector = this.getConnector(source);
            if (!connector.isConfigured()) {
                throw new Error(`Connector for ${source} is not configured. Please check your environment variables.`);
            }

            // Load persistent settings and merge with request (request takes priority)
            const settings = await this.settingsService.getSettings(source);
            if (settings) {
                this.logger.debug(`Applying persistent settings for ${source}: ${JSON.stringify(settings)}`);
                this.applySettingsToRequest(source, settings, request);
            }

            // Check if selective indexing settings have changed since last sync
            const cursor = await this.cursorService.getCursor(source);
            const currentConfig = this.extractConfigKey(source, request);
            const lastConfig = cursor?.metadata?.configKey;

            if (lastConfig && currentConfig !== lastConfig && !request.fullReindex) {
                this.logger.log(`Detected change in selective indexing configuration for ${source}. Triggering full re-sync for new parameters.`);
                request.fullReindex = true;
            }

            const totalIndexed = await this.runIndexingLoop(source, request, connector, currentConfig);

            await this.updateStatus(source, {
                status: 'completed',
                lastSync: new Date().toISOString(),
            });
            this.logger.log(`Completed indexing ${source}: ${totalIndexed} documents processed`);

        } catch (error) {
            const errorMessage = (error as Error).message;
            this.logger.error(`Indexing failed for ${source}: ${errorMessage}`, (error as Error).stack);
            await this.updateStatus(source, {
                status: 'error',
                error: errorMessage,
                lastError: errorMessage,
                lastErrorAt: new Date().toISOString()
            });
        }
    }

    private extractConfigKey(source: DataSource, request: IndexRequest): string {
        switch (source) {
            case 'jira': return (request.projectKeys || []).sort().join(',');
            case 'slack': return (request.channelIds || []).sort().join(',');
            case 'confluence': return (request.spaceKeys || []).sort().join(',');
            case 'drive': return (request.folderIds || []).sort().join(',');
            case 'calendar': return (request.calendarIds || []).sort().join(',');
            case 'gmail':
                const g = request.gmailSettings;
                return JSON.stringify({
                    d: (g?.domains || []).sort(),
                    s: (g?.senders || []).sort(),
                    l: (g?.labels || []).sort()
                });
            default: return '';
        }
    }

    private applySettingsToRequest(source: DataSource, settings: SourceSettings, request: IndexRequest) {
        const s = settings as any;
        switch (source) {
            case 'drive':
                request.folderIds = request.folderIds || s.folderIds;
                break;
            case 'gmail':
                request.gmailSettings = {
                    domains: request.gmailSettings?.domains || s.domains || [],
                    senders: request.gmailSettings?.senders || s.senders || [],
                    labels: request.gmailSettings?.labels || s.labels || [],
                };
                break;
            case 'jira':
                request.projectKeys = request.projectKeys || s.projectKeys;
                break;
            case 'slack':
                request.channelIds = request.channelIds || s.channelIds;
                break;
            case 'confluence':
                request.spaceKeys = request.spaceKeys || s.spaceKeys;
                break;
            case 'calendar':
                request.calendarIds = request.calendarIds || s.calendarIds;
                break;
        }
    }

    private async runIndexingLoop(source: DataSource, request: IndexRequest, connector: BaseConnector, configKey?: string): Promise<number> {
        let totalProcessed = 0;
        let hasMore = true;
        let cursor = request.fullReindex ? null : await this.cursorService.getCursor(source);
        let consecutiveErrors = 0;
        const MAX_CONSECUTIVE_ERRORS = 3;

        while (hasMore) {
            try {
                this.logger.debug(`Fetching batch for ${source} (Total so far: ${totalProcessed})...`);
                const result = await connector.fetch(cursor, request);

                if (result.documents.length > 0) {
                    const documentsWithContext = result.documents.map(doc => ({
                        ...doc,
                        metadata: {
                            ...doc.metadata,
                            // search_context: this.generateSearchContext(doc) // Deprecated: Context is now part of the file
                        }
                    })) as IndexDocument[];

                    const indexedInBatch = await this.processIndexingBatch(source, documentsWithContext, !!request.fullReindex);
                    totalProcessed += indexedInBatch;
                    await this.updateStatus(source, { documentsIndexed: totalProcessed });
                }

                cursor = await this.updateCursorAfterBatch(source, result, configKey);
                hasMore = result.hasMore;
                consecutiveErrors = 0; // Reset errors on success
            } catch (error) {
                consecutiveErrors++;
                this.logger.error(`Error processing batch for ${source} (Attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error.message}`);

                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    this.logger.error(`Maximum consecutive errors reached for ${source}. Aborting indexing loop.`);
                    throw new Error(`Indexing aborted for ${source} after ${consecutiveErrors} consecutive batch failures: ${error.message}`);
                }

                // Exponential backoff before retrying the same batch
                const backoffTime = Math.pow(2, consecutiveErrors) * 1000;
                this.logger.log(`Retrying batch for ${source} in ${backoffTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                continue;
            }

            if (hasMore) {
                // Adaptive delay to avoid hitting rate limits too hard
                const delay = totalProcessed % 500 === 0 ? 2000 : 500;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        return totalProcessed;
    }

    private async processIndexingBatch(source: DataSource, documents: IndexDocument[], force: boolean = false): Promise<number> {
        const documentsToIndex = force ? documents : await this.filterChangedDocuments(source, documents);

        if (documentsToIndex.length > 0) {
            this.logger.log(`Saving ${documentsToIndex.length} ${force ? 'documents (forced)' : 'changed documents'} for ${source}`);

            let retries = 3;
            while (retries > 0) {
                try {
                    // Use FileSaverService instead of ChromaService
                    await this.fileSaverService.saveDocuments(source, documentsToIndex);

                    const newHashes: Record<string, string> = {};
                    documentsToIndex.forEach(doc => {
                        newHashes[doc.id] = this.hashDocument(doc);
                    });
                    await this.cursorService.bulkSetDocumentHashes(source, newHashes);
                    break; // Success
                } catch (error) {
                    retries--;
                    this.logger.error(`Failed to save batch for ${source} (${3 - retries}/3): ${error.message}`);
                    if (retries === 0) throw error;
                    await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retries)));
                }
            }
        }

        return documentsToIndex.length;
    }

    private async updateCursorAfterBatch(source: DataSource, result: ConnectorResult, configKey?: string): Promise<Cursor> {
        const newCursor: Cursor = {
            source,
            lastSync: result.batchLastSync || new Date().toISOString(),
            syncToken: result.newCursor?.syncToken,
            metadata: {
                ...result.newCursor?.metadata,
                configKey,
            }
        };
        await this.cursorService.saveCursor(newCursor);
        return newCursor;
    }

    private async filterChangedDocuments(source: DataSource, documents: IndexDocument[]): Promise<IndexDocument[]> {
        if (documents.length === 0) return [];

        const docIds = documents.map(d => d.id);
        const existingHashes = await this.cursorService.bulkGetDocumentHashes(source, docIds);

        const changedDocs: IndexDocument[] = [];
        for (let i = 0; i < documents.length; i++) {
            const doc = documents[i];
            const currentHash = this.hashDocument(doc);
            if (existingHashes[i] !== currentHash) {
                changedDocs.push(doc);
            }
        }
        return changedDocs;
    }

    private hashDocument(doc: IndexDocument): string {
        const data = JSON.stringify({
            content: doc.content,
            metadata: doc.metadata,
        });
        return CryptoJS.SHA256(data).toString();
    }

    private async updateStatus(source: DataSource, updates: Partial<IndexStatus>): Promise<void> {
        const current = await this.getStatus(source);
        const newStatus: IndexStatus = { ...current, ...updates, source };
        await this.cursorService.saveJobStatus(newStatus);
    }

    async getStatus(source: DataSource): Promise<IndexStatus> {
        const status = await this.cursorService.getJobStatus(source);
        return status || { source, status: 'idle', lastSync: null, documentsIndexed: 0 };
    }

    async getAllStatus(): Promise<IndexStatus[]> {
        return this.cursorService.getAllJobStatus(this.allSources);
    }

    async resetCursor(source: DataSource): Promise<void> {
        await this.cursorService.resetCursor(source);
        await this.cursorService.resetStatus(source);
        await this.cursorService.releaseLock(source);
        this.logger.log(`Cursor, status, and lock reset for ${source}`);
    }

    async resetAll(): Promise<void> {
        for (const source of this.allSources) {
            await this.resetCursor(source);
        }
        this.logger.log('Cursor and status reset for ALL sources');
    }

    async deleteDocument(source: DataSource, documentId: string): Promise<void> {
        await this.fileSaverService.deleteDocument(source, documentId);
        await this.cursorService.removeDocumentHashes(source, documentId);
        this.logger.log(`Deleted document ${documentId} and its children from ${source}.`);
    }

    async indexAll(request: IndexRequest = {}): Promise<{ started: DataSource[]; skipped: DataSource[] }> {
        const started: DataSource[] = [];
        const skipped: DataSource[] = [];

        this.logger.log('Starting parallel collection for all sources...');

        // Use Promise.all to trigger all indexing jobs
        // We add a small staggered delay to avoid hitting all APIs at the exact same millisecond
        await Promise.all(this.allSources.map(async (source, index) => {
            await new Promise(resolve => setTimeout(resolve, index * 1000));
            const result = await this.startIndexing(source, request);
            if (result.started) {
                started.push(source);
            } else {
                skipped.push(source);
            }
        }));

        this.logger.log(`Collection triggered for all sources. Started: ${started.join(', ')}, Skipped: ${skipped.join(', ')}`);
        return { started, skipped };
    }

    async getDriveFolders(parentId?: string): Promise<any[]> {
        const connector = this.getConnector('drive') as DriveConnector;
        return connector.listFolders(parentId);
    }

    async getDriveChildren(parentId?: string): Promise<any[]> {
        const connector = this.getConnector('drive') as DriveConnector;
        return connector.listChildren(parentId);
    }

    async getCalendars(): Promise<any[]> {
        const connector = this.getConnector('calendar') as CalendarConnector;
        return connector.listCalendars();
    }

    async getJiraProjects(): Promise<any[]> {
        const connector = this.getConnector('jira') as JiraConnector;
        return connector.listProjects();
    }

    async getSlackChannels(): Promise<any[]> {
        const connector = this.getConnector('slack') as SlackConnector;
        return connector.getChannels();
    }

    async getConfluenceSpaces(): Promise<any[]> {
        const connector = this.getConnector('confluence') as ConfluenceConnector;
        return connector.listSpaces();
    }

    async getGmailLabels(): Promise<any[]> {
        const connector = this.getConnector('gmail') as GmailConnector;
        return connector.listLabels();
    }
}
