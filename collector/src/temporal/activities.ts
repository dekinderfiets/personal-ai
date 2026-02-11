import { Context } from '@temporalio/activity';
import { IndexingService } from '../indexing/indexing.service';
import { SettingsService } from '../indexing/settings.service';
import { CursorService } from '../indexing/cursor.service';
import { AnalyticsService } from '../indexing/analytics.service';
import {
    DataSource,
    SerializableIndexRequest,
    LoadSettingsResult,
    FetchBatchResult,
    ProcessBatchResult,
    SerializableCursor,
    StatusUpdate,
} from './types';
import { IndexDocument, IndexRequest, ConnectorResult } from '../types';

export interface ActivityDeps {
    indexingService: IndexingService;
    settingsService: SettingsService;
    cursorService: CursorService;
    analyticsService: AnalyticsService;
}

export function createActivities(deps: ActivityDeps) {
    const { indexingService, settingsService, cursorService, analyticsService } = deps;

    return {
        async loadSettings(
            source: DataSource,
            request: SerializableIndexRequest,
        ): Promise<LoadSettingsResult> {
            const mergedRequest = { ...request } as IndexRequest;

            const settings = await settingsService.getSettings(source);
            if (settings) {
                indexingService.applySettingsToRequest(source, settings, mergedRequest);
            }

            const cursor = await cursorService.getCursor(source);
            const configKey = indexingService.extractConfigKey(source, mergedRequest);
            const lastConfig = cursor?.metadata?.configKey;

            let configChanged = false;
            if (lastConfig && configKey !== lastConfig && !mergedRequest.fullReindex) {
                mergedRequest.fullReindex = true;
                configChanged = true;
            }

            return {
                request: mergedRequest as SerializableIndexRequest,
                cursor: cursor as SerializableCursor | null,
                configKey,
                configChanged,
            };
        },

        async fetchBatch(
            source: DataSource,
            cursor: SerializableCursor | null,
            request: SerializableIndexRequest,
        ): Promise<FetchBatchResult> {
            const connector = indexingService.getConnector(source);
            if (!connector.isConfigured()) {
                throw new Error(`Connector for ${source} is not configured.`);
            }

            Context.current().heartbeat('fetching');

            const result: ConnectorResult = await connector.fetch(
                cursor as any,
                request as IndexRequest,
            );

            return {
                documents: result.documents.map((doc) => ({
                    id: doc.id,
                    source: doc.source,
                    content: doc.content,
                    metadata: doc.metadata as Record<string, unknown>,
                })),
                newCursor: result.newCursor as Partial<SerializableCursor>,
                hasMore: result.hasMore,
                batchLastSync: result.batchLastSync,
            };
        },

        async processBatch(
            source: DataSource,
            documents: FetchBatchResult['documents'],
            force: boolean,
        ): Promise<ProcessBatchResult> {
            Context.current().heartbeat('processing');

            const indexDocs = documents as unknown as IndexDocument[];
            const docsWithWeights = indexingService.addRelevanceWeights(source, indexDocs);
            const processed = await indexingService.processIndexingBatch(
                source,
                docsWithWeights,
                force,
            );
            return { processed };
        },

        async updateCursorAfterBatch(
            source: DataSource,
            batchResult: Pick<FetchBatchResult, 'newCursor' | 'batchLastSync'>,
            configKey?: string,
        ): Promise<SerializableCursor> {
            const result = {
                newCursor: batchResult.newCursor,
                batchLastSync: batchResult.batchLastSync,
            } as ConnectorResult;

            const cursor = await indexingService.updateCursorAfterBatch(
                source,
                result as any,
                configKey,
            );
            return cursor as SerializableCursor;
        },

        async updateStatus(source: DataSource, updates: StatusUpdate): Promise<void> {
            await indexingService.updateStatus(source, updates as any);
        },

        async recordRunStart(source: DataSource): Promise<string> {
            return analyticsService.recordRunStart(source);
        },

        async recordRunComplete(
            source: DataSource,
            details: {
                documentsProcessed: number;
                documentsNew: number;
                documentsUpdated: number;
                documentsSkipped: number;
                startedAt: string;
                error?: string;
            },
        ): Promise<void> {
            await analyticsService.recordRunComplete(source, details);
        },
    };
}

export type Activities = ReturnType<typeof createActivities>;
