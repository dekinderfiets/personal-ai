import { Context } from '@temporalio/activity';

import { AnalyticsService } from '../indexing/analytics.service';
import { CursorService } from '../indexing/cursor.service';
import { IndexingService } from '../indexing/indexing.service';
import { SettingsService } from '../indexing/settings.service';
import { ConnectorResult,IndexDocument, IndexRequest } from '../types';
import {
    DataSource,
    FetchBatchResult,
    LoadSettingsResult,
    ProcessBatchResult,
    SerializableCursor,
    SerializableIndexRequest,
    StatusUpdate,
} from './types';

export interface ActivityDeps {
    indexingService: IndexingService;
    settingsService: SettingsService;
    cursorService: CursorService;
    analyticsService: AnalyticsService;
}

/**
 * Run a long-running operation with periodic heartbeats.
 * Heartbeats every 30s to prevent Temporal's heartbeat timeout from
 * killing the activity, and to receive cancellation signals promptly.
 */
async function withHeartbeat<T>(detail: string, fn: () => Promise<T>): Promise<T> {
    const interval = setInterval(() => {
        try {
            Context.current().heartbeat(detail);
        } catch (_err) {
            // CancelledFailure from heartbeat — stop the interval
            // and let it propagate when the main fn next yields
            clearInterval(interval);
        }
    }, 30_000);

    try {
        Context.current().heartbeat(detail);
        return await fn();
    } finally {
        clearInterval(interval);
    }
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

            const result = await withHeartbeat(`fetching:${source}`, () =>
                connector.fetch(cursor as any, request as IndexRequest),
            );

            return {
                documents: result.documents.map((doc) => ({
                    id: doc.id,
                    source: doc.source,
                    content: doc.content,
                    metadata: doc.metadata as Record<string, unknown>,
                    ...((doc as any).preChunked ? { preChunked: (doc as any).preChunked } : {}),
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
            const indexDocs = documents as unknown as IndexDocument[];
            const docsWithWeights = indexingService.addRelevanceWeights(source, indexDocs);
            const processed = await withHeartbeat(`processing:${source}`, () =>
                indexingService.processIndexingBatch(source, docsWithWeights, force),
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
