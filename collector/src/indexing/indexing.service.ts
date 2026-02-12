import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CryptoJS from 'crypto-js';
import { CursorService } from './cursor.service';
import { FileSaverService } from './file-saver.service';
import { ChromaService } from './chroma.service';
import { JiraConnector } from '../connectors/jira.connector';
import { SlackConnector } from '../connectors/slack.connector';
import { GmailConnector } from '../connectors/gmail.connector';
import { DriveConnector } from '../connectors/drive.connector';
import { ConfluenceConnector } from '../connectors/confluence.connector';
import { CalendarConnector } from '../connectors/calendar.connector';
import { GitHubConnector } from '../connectors/github.connector';
import { DataSource, IndexRequest, IndexStatus, IndexDocument, Cursor, ConnectorResult, SourceSettings } from '../types';
import { SettingsService } from './settings.service';
import { AnalyticsService } from './analytics.service';
import { BaseConnector } from '../connectors/base.connector';
import { TemporalClientService } from '../temporal/temporal-client.service';

@Injectable()
export class IndexingService {
    private readonly logger = new Logger(IndexingService.name);
    private readonly connectors: Map<DataSource, BaseConnector>;
    private readonly allSources: DataSource[];

    constructor(
        private configService: ConfigService,
        private cursorService: CursorService,
        private fileSaverService: FileSaverService,
        private chromaService: ChromaService,
        private settingsService: SettingsService,
        private analyticsService: AnalyticsService,
        private temporalClient: TemporalClientService,
        jira: JiraConnector,
        slack: SlackConnector,
        gmail: GmailConnector,
        drive: DriveConnector,
        confluence: ConfluenceConnector,
        calendar: CalendarConnector,
        github: GitHubConnector,
    ) {
        this.connectors = new Map<DataSource, BaseConnector>([
            ['jira', jira],
            ['slack', slack],
            ['gmail', gmail],
            ['drive', drive],
            ['confluence', confluence],
            ['calendar', calendar],
            ['github', github],
        ]);
        this.allSources = Array.from(this.connectors.keys());
    }

    // -------------------------------------------------------------------------
    // Public accessors used by activities
    // -------------------------------------------------------------------------

    getConnector(source: DataSource): BaseConnector {
        const connector = this.connectors.get(source);
        if (!connector) {
            throw new Error(`No connector found for source: ${source}`);
        }
        return connector;
    }

    applySettingsToRequest(source: DataSource, settings: SourceSettings, request: IndexRequest) {
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
            case 'github':
                request.repos = request.repos || s.repos;
                request.indexFiles = request.indexFiles ?? s.indexFiles;
                break;
        }
    }

    extractConfigKey(source: DataSource, request: IndexRequest): string {
        switch (source) {
            case 'jira': return (request.projectKeys || []).sort().join(',');
            case 'slack': return (request.channelIds || []).sort().join(',');
            case 'confluence': return (request.spaceKeys || []).sort().join(',');
            case 'drive': return (request.folderIds || []).sort().join(',');
            case 'calendar': return (request.calendarIds || []).sort().join(',');
            case 'github': return (request.repos || []).sort().join(',');
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

    addRelevanceWeights(source: DataSource, documents: IndexDocument[]): IndexDocument[] {
        // Pre-compute thread counts for Gmail documents in this batch
        let threadCounts: Map<string, number> | undefined;
        if (source === 'gmail') {
            threadCounts = new Map();
            for (const doc of documents) {
                const tid = (doc.metadata as any)?.threadId;
                if (tid) {
                    threadCounts.set(tid, (threadCounts.get(tid) || 0) + 1);
                }
            }
        }

        return documents.map(doc => {
            const metadata = { ...doc.metadata } as any;

            switch (source) {
                case 'gmail':
                    metadata.recipient_count = ((metadata.to || []).length + (metadata.cc || []).length);
                    metadata.is_internal = this.isInternalEmail(metadata.from);
                    // Use connector-provided thread message count if available,
                    // otherwise compute from the batch, or omit entirely
                    if (metadata.threadMessageCount != null) {
                        metadata.thread_depth = metadata.threadMessageCount;
                    } else if (metadata.threadId && threadCounts?.has(metadata.threadId)) {
                        metadata.thread_depth = threadCounts.get(metadata.threadId);
                    }
                    // If neither is available, thread_depth is left undefined rather than hardcoded
                    metadata.relevance_score = this.computeGmailRelevance(metadata);
                    break;

                case 'slack':
                    metadata.channel_type = metadata.channel_type || this.inferSlackChannelType(metadata);
                    metadata.mention_count = (metadata.mentionedUsers || []).length;
                    metadata.is_thread_participant = !!metadata.threadTs;
                    metadata.relevance_score = this.computeSlackRelevance(metadata);
                    break;

                case 'jira':
                    metadata.priority_weight = this.jiraPriorityWeight(metadata.priority);
                    metadata.days_since_update = this.daysSince(metadata.updatedAt);
                    metadata.is_assigned_to_me = this.isCurrentUser('jira', metadata.assignee);
                    metadata.relevance_score = this.computeJiraRelevance(metadata);
                    break;

                case 'drive':
                    metadata.days_since_modified = this.daysSince(metadata.modifiedAt);
                    metadata.is_owner = this.isCurrentUser('drive', metadata.owner);
                    metadata.relevance_score = this.computeDriveRelevance(metadata);
                    break;

                case 'confluence':
                    metadata.label_count = (metadata.labels || []).length;
                    metadata.hierarchy_depth = (metadata.ancestors || []).length;
                    metadata.relevance_score = this.computeConfluenceRelevance(metadata);
                    break;

                case 'calendar':
                    metadata.attendee_count = (metadata.attendees || []).length;
                    metadata.is_organizer = this.isCurrentUser('calendar', metadata.organizer);
                    metadata.is_recurring = false;
                    metadata.relevance_score = this.computeCalendarRelevance(metadata);
                    break;

                case 'github':
                    metadata.relevance_score = this.computeGitHubRelevance(metadata);
                    break;
            }

            return { ...doc, metadata } as IndexDocument;
        });
    }

    async processIndexingBatch(source: DataSource, documents: IndexDocument[], force: boolean = false): Promise<number> {
        const documentsToIndex = force ? documents : await this.filterChangedDocuments(source, documents);

        if (documentsToIndex.length > 0) {
            this.logger.log(`Saving ${documentsToIndex.length} ${force ? 'documents (forced)' : 'changed documents'} for ${source}`);

            let retries = 3;
            while (retries > 0) {
                try {
                    // Save files independently (non-blocking for hash updates)
                    this.fileSaverService.saveDocuments(source, documentsToIndex).catch(err => {
                        this.logger.warn(`File save failed for ${source} (non-fatal): ${err.message}`);
                    });

                    // ChromaDB upsert must succeed before we update hashes.
                    // If it fails, hashes stay stale so documents are retried on next sync.
                    await this.chromaService.upsertDocuments(source, documentsToIndex);

                    const newHashes: Record<string, string> = {};
                    documentsToIndex.forEach(doc => {
                        newHashes[doc.id] = this.hashDocument(doc);
                    });
                    await this.cursorService.bulkSetDocumentHashes(source, newHashes);
                    break;
                } catch (error) {
                    retries--;
                    this.logger.error(`Failed to save batch for ${source} (${3 - retries}/3): ${(error as Error).message}`);
                    if (retries === 0) throw error;
                    await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retries)));
                }
            }
        }

        return documentsToIndex.length;
    }

    async updateCursorAfterBatch(source: DataSource, result: ConnectorResult, configKey?: string): Promise<Cursor> {
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

    async updateStatus(source: DataSource, updates: Partial<IndexStatus>): Promise<void> {
        const current = await this.getStatus(source);
        const newStatus: IndexStatus = { ...current, ...updates, source };
        await this.cursorService.saveJobStatus(newStatus);
    }

    // -------------------------------------------------------------------------
    // Indexing entry points — delegate to Temporal when available
    // -------------------------------------------------------------------------

    async startIndexing(source: DataSource, request: IndexRequest = {}): Promise<{ started: boolean; message: string }> {
        if (this.temporalClient.isConnected()) {
            const result = await this.temporalClient.startIndexSource(source, request);
            return { started: result.started, message: result.message };
        }

        // Legacy fallback: background promise with Redis lock
        const lockAcquired = await this.cursorService.acquireLock(source);
        if (!lockAcquired) {
            return { started: false, message: 'Indexing already in progress' };
        }

        this.runIndexingLegacy(source, request).finally(() => {
            this.cursorService.releaseLock(source);
        });

        return { started: true, message: 'Indexing started in background' };
    }

    async indexAll(request: IndexRequest = {}): Promise<{ started: DataSource[]; skipped: DataSource[] }> {
        if (this.temporalClient.isConnected()) {
            const result = await this.temporalClient.startCollectAll(request);
            if (result.started) {
                return { started: this.allSources, skipped: [] };
            }
            return { started: [], skipped: this.allSources };
        }

        // Legacy fallback
        const started: DataSource[] = [];
        const skipped: DataSource[] = [];

        await Promise.all(this.allSources.map(async (source, index) => {
            await new Promise(resolve => setTimeout(resolve, index * 1000));
            const result = await this.startIndexing(source, request);
            if (result.started) {
                started.push(source);
            } else {
                skipped.push(source);
            }
        }));

        return { started, skipped };
    }

    // -------------------------------------------------------------------------
    // Legacy background indexing (used when Temporal is not available)
    // -------------------------------------------------------------------------

    private async runIndexingLegacy(source: DataSource, request: IndexRequest): Promise<void> {
        this.logger.log(`[Legacy] Starting indexing for ${source}...`);
        const startedAt = new Date().toISOString();
        const runId = await this.analyticsService.recordRunStart(source);
        await this.updateStatus(source, {
            status: 'running',
            documentsIndexed: 0,
            error: '',
            lastError: undefined
        });

        let totalIndexed = 0;
        try {
            const connector = this.getConnector(source);
            if (!connector.isConfigured()) {
                throw new Error(`Connector for ${source} is not configured.`);
            }

            const settings = await this.settingsService.getSettings(source);
            if (settings) {
                this.applySettingsToRequest(source, settings, request);
            }

            const cursor = await this.cursorService.getCursor(source);
            const currentConfig = this.extractConfigKey(source, request);
            const lastConfig = cursor?.metadata?.configKey;

            if (lastConfig && currentConfig !== lastConfig && !request.fullReindex) {
                request.fullReindex = true;
            }

            totalIndexed = await this.runIndexingLoop(source, request, connector, currentConfig);

            await this.updateStatus(source, {
                status: 'completed',
                lastSync: new Date().toISOString(),
            });

            await this.analyticsService.recordRunComplete(source, {
                runId,
                documentsProcessed: totalIndexed,
                documentsNew: totalIndexed,
                documentsUpdated: 0,
                documentsSkipped: 0,
                startedAt,
            });
        } catch (error) {
            const errorMessage = (error as Error).message;
            this.logger.error(`Indexing failed for ${source}: ${errorMessage}`, (error as Error).stack);
            await this.updateStatus(source, {
                status: 'error',
                error: errorMessage,
                lastError: errorMessage,
                lastErrorAt: new Date().toISOString()
            });

            await this.analyticsService.recordRunComplete(source, {
                runId,
                documentsProcessed: totalIndexed,
                documentsNew: 0,
                documentsUpdated: 0,
                documentsSkipped: 0,
                startedAt,
                error: errorMessage,
            });
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
                const result = await connector.fetch(cursor, request);

                if (result.documents.length > 0) {
                    const documentsWithContext = result.documents.map(doc => ({
                        ...doc,
                        metadata: { ...doc.metadata }
                    })) as IndexDocument[];

                    const documentsWithWeights = this.addRelevanceWeights(source, documentsWithContext);
                    const indexedInBatch = await this.processIndexingBatch(source, documentsWithWeights, !!request.fullReindex);
                    totalProcessed += indexedInBatch;
                    await this.updateStatus(source, { documentsIndexed: totalProcessed });
                }

                cursor = await this.updateCursorAfterBatch(source, result, configKey);
                hasMore = result.hasMore;
                consecutiveErrors = 0;
            } catch (error) {
                consecutiveErrors++;
                this.logger.error(`Error processing batch for ${source} (Attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${(error as Error).message}`);

                // If we have a syncToken (pageToken) and we've failed twice, clear it
                // before the final retry. This handles stale pagination tokens from any
                // connector — the next attempt will restart pagination from lastSync.
                if (consecutiveErrors === MAX_CONSECUTIVE_ERRORS - 1 && cursor?.syncToken) {
                    this.logger.warn(`Clearing stale syncToken for ${source} before final retry`);
                    cursor = { ...cursor, syncToken: undefined };
                    await this.cursorService.saveCursor(cursor);
                }

                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    throw new Error(`Indexing aborted for ${source} after ${consecutiveErrors} consecutive batch failures: ${(error as Error).message}`);
                }

                const backoffTime = Math.pow(2, consecutiveErrors) * 1000;
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                continue;
            }

            if (hasMore) {
                const delay = totalProcessed % 500 === 0 ? 2000 : 500;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        return totalProcessed;
    }

    // -------------------------------------------------------------------------
    // Status & discovery (unchanged)
    // -------------------------------------------------------------------------

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
        await Promise.all([
            this.fileSaverService.deleteDocument(source, documentId),
            this.chromaService.deleteDocument(source, documentId).catch(err => {
                this.logger.warn(`ChromaDB delete failed (non-fatal): ${err.message}`);
            }),
        ]);
        await this.cursorService.removeDocumentHashes(source, documentId);
        this.logger.log(`Deleted document ${documentId} and its children from ${source}.`);
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

    async getGitHubRepositories(): Promise<any[]> {
        const connector = this.getConnector('github') as GitHubConnector;
        return connector.listRepositories();
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

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

    private isCurrentUser(source: DataSource, value?: string | null): boolean {
        if (!value) return false;
        const v = value.toLowerCase();
        switch (source) {
            case 'jira':
                return v === this.configService.get<string>('jira.username', '').toLowerCase();
            case 'github':
                return v === this.configService.get<string>('github.username', '').toLowerCase();
            case 'drive':
            case 'calendar':
            case 'gmail': {
                // Prefer GOOGLE_USER_EMAIL for Google services
                const googleEmail = this.configService.get<string>('google.userEmail', '').toLowerCase();
                if (googleEmail) {
                    return v === googleEmail;
                }
                // Fall back to Atlassian email if GOOGLE_USER_EMAIL is not configured
                const atlassianEmail = this.configService.get<string>('jira.username', '').toLowerCase();
                return atlassianEmail !== '' && v === atlassianEmail;
            }
            default:
                return false;
        }
    }

    private isInternalEmail(from: string): boolean {
        if (!from) return false;
        const domain = from.split('@')[1]?.toLowerCase();
        if (!domain) return false;

        const companyDomainsStr = this.configService.get<string>('app.companyDomains', '');
        if (companyDomainsStr) {
            const companyDomains = companyDomainsStr.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
            return companyDomains.includes(domain);
        }

        // Fallback: if no company domains configured, use the original heuristic
        const publicDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'];
        return !publicDomains.includes(domain);
    }

    private inferSlackChannelType(metadata: any): string {
        if (metadata.channel?.startsWith('DM')) return 'dm';
        return 'public';
    }

    private jiraPriorityWeight(priority?: string): number {
        const weights: Record<string, number> = {
            'Critical': 5, 'Blocker': 5, 'Highest': 5,
            'High': 4,
            'Medium': 3,
            'Low': 2,
            'Lowest': 1, 'None': 1,
        };
        return weights[priority || 'None'] || 1;
    }

    private daysSince(dateStr?: string): number {
        if (!dateStr) return 999;
        const diff = Date.now() - new Date(dateStr).getTime();
        return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    }

    private computeGmailRelevance(m: any): number {
        let score = 0.5;
        if (m.is_internal) score += 0.2;
        if (m.recipient_count <= 3) score += 0.15;
        if (m.thread_depth > 1) score += 0.1;
        return Math.min(1, score);
    }

    private computeSlackRelevance(m: any): number {
        let score = 0.5;
        if (m.channel_type === 'dm') score += 0.3;
        else if (m.channel_type === 'private') score += 0.15;
        else if (m.channel_type === 'mpim') score += 0.2;
        if (m.mention_count > 0) score += 0.1;
        if (m.is_thread_participant) score += 0.05;
        return Math.min(1, score);
    }

    private computeJiraRelevance(m: any): number {
        let score = 0.3;
        if (m.is_assigned_to_me) score += 0.3;
        score += (m.priority_weight || 1) * 0.06;
        if (m.days_since_update < 7) score += 0.15;
        else if (m.days_since_update < 30) score += 0.05;
        return Math.min(1, score);
    }

    private computeDriveRelevance(m: any): number {
        let score = 0.4;
        if (m.is_owner) score += 0.2;
        if (m.days_since_modified < 7) score += 0.2;
        else if (m.days_since_modified < 30) score += 0.1;
        return Math.min(1, score);
    }

    private computeConfluenceRelevance(m: any): number {
        let score = 0.4;
        if (m.label_count > 0) score += 0.15;
        if (m.hierarchy_depth <= 2) score += 0.1;
        const days = this.daysSince(m.updatedAt);
        if (days < 7) score += 0.2;
        else if (days < 30) score += 0.1;
        return Math.min(1, score);
    }

    private computeCalendarRelevance(m: any): number {
        let score = 0.5;
        if (m.is_organizer) score += 0.2;
        if (m.attendee_count <= 5) score += 0.1;
        const start = new Date(m.start);
        const now = new Date();
        const diffHours = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (diffHours >= 0 && diffHours <= 24) score += 0.2;
        else if (diffHours >= 0 && diffHours <= 168) score += 0.1;
        return Math.min(1, score);
    }

    private computeGitHubRelevance(m: any): number {
        let score = 0.4;
        if (m.is_author) score += 0.2;
        if (m.is_assigned_to_me) score += 0.2;
        const days = this.daysSince(m.updatedAt);
        if (days < 7) score += 0.15;
        else if (days < 30) score += 0.05;
        return Math.min(1, score);
    }
}
