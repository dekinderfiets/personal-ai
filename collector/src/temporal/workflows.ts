import {
    proxyActivities,
    sleep,
    continueAsNew,
    ContinueAsNew,
    executeChild,
    ParentClosePolicy,
} from '@temporalio/workflow';

import type { Activities } from './activities';
import type {
    IndexSourceInput,
    IndexSourceResult,
    CollectAllInput,
    CollectAllResult,
    DataSource,
} from './types';

const activities = proxyActivities<Activities>({
    startToCloseTimeout: '10 minutes',
    heartbeatTimeout: '2 minutes',
    retry: {
        maximumAttempts: 3,
        initialInterval: '1s',
        backoffCoefficient: 2,
        maximumInterval: '30s',
    },
});

// Short-lived activities (status updates, cursor saves) get shorter timeouts
const mgmtActivities = proxyActivities<Activities>({
    startToCloseTimeout: '30 seconds',
    retry: {
        maximumAttempts: 3,
        initialInterval: '500ms',
        backoffCoefficient: 2,
        maximumInterval: '5s',
    },
});

// Max batches per workflow execution before using continueAsNew to reset
// the Temporal history. Each batch creates ~4 history events, and
// Temporal's default history limit is 50k events / ~50 MB.
const MAX_BATCHES_PER_EXECUTION = 50;

export async function indexSourceWorkflow(input: IndexSourceInput): Promise<IndexSourceResult> {
    const { source, request } = input;
    const isContinuation = !!input._continuation;
    const startedAt = input._continuation?.startedAt || new Date().toISOString();
    let totalProcessed = input._continuation?.totalProcessed || 0;

    try {
        if (!isContinuation) {
            await mgmtActivities.recordRunStart(source);
            await mgmtActivities.updateStatus(source, {
                status: 'running',
                documentsIndexed: 0,
                error: '',
                lastError: undefined,
            });
        }

        // Load settings and detect config changes
        const settings = await mgmtActivities.loadSettings(source, request);
        const mergedRequest = settings.request;
        const configKey = settings.configKey;

        let cursor = mergedRequest.fullReindex && !isContinuation
            ? null
            : settings.cursor;
        let hasMore = true;
        let batchCount = 0;

        while (hasMore) {
            const batch = await activities.fetchBatch(source, cursor, mergedRequest);

            if (batch.documents.length > 0) {
                const result = await activities.processBatch(
                    source,
                    batch.documents,
                    !!mergedRequest.fullReindex,
                );
                totalProcessed += result.processed;
                await mgmtActivities.updateStatus(source, { documentsIndexed: totalProcessed });
            }

            cursor = await mgmtActivities.updateCursorAfterBatch(
                source,
                { newCursor: batch.newCursor, batchLastSync: batch.batchLastSync },
                configKey,
            );

            hasMore = batch.hasMore;
            batchCount++;

            if (hasMore) {
                // Reset workflow history before it gets too large
                if (batchCount >= MAX_BATCHES_PER_EXECUTION) {
                    await continueAsNew<typeof indexSourceWorkflow>({
                        source,
                        request,
                        _continuation: { totalProcessed, startedAt },
                    });
                }

                // Adaptive delay to avoid rate limits
                const delayMs = totalProcessed % 500 === 0 ? 2000 : 500;
                await sleep(delayMs);
            }
        }

        const completedAt = new Date().toISOString();

        await mgmtActivities.updateStatus(source, {
            status: 'completed',
            lastSync: completedAt,
        });

        await mgmtActivities.recordRunComplete(source, {
            documentsProcessed: totalProcessed,
            documentsNew: totalProcessed,
            documentsUpdated: 0,
            documentsSkipped: 0,
            startedAt,
        });

        return {
            source,
            totalProcessed,
            status: 'completed',
            startedAt,
            completedAt,
        };
    } catch (error) {
        // continueAsNew throws ContinueAsNew — let it propagate
        if (error instanceof ContinueAsNew) {
            throw error;
        }

        const completedAt = new Date().toISOString();
        const errorMessage = (error as Error).message;

        await mgmtActivities.updateStatus(source, {
            status: 'error',
            error: errorMessage,
            lastError: errorMessage,
            lastErrorAt: completedAt,
        });

        await mgmtActivities.recordRunComplete(source, {
            documentsProcessed: totalProcessed,
            documentsNew: 0,
            documentsUpdated: 0,
            documentsSkipped: 0,
            startedAt,
            error: errorMessage,
        });

        return {
            source,
            totalProcessed,
            status: 'error',
            error: errorMessage,
            startedAt,
            completedAt,
        };
    }
}

const ALL_SOURCES: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'];

export async function collectAllWorkflow(input: CollectAllInput): Promise<CollectAllResult> {
    const sources = input.sources || ALL_SOURCES;
    const results: IndexSourceResult[] = [];
    const started: DataSource[] = [];
    const skipped: DataSource[] = [];

    const childPromises: Promise<IndexSourceResult | null>[] = [];

    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];

        // Stagger child workflow starts by 1s
        if (i > 0) {
            await sleep(1000);
        }

        childPromises.push(
            executeChild(indexSourceWorkflow, {
                workflowId: `index-${source}`,
                args: [{ source, request: input.request }],
                parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
            })
                .then((result) => {
                    started.push(source);
                    return result;
                })
                .catch((err) => {
                    if ((err as Error).name === 'WorkflowExecutionAlreadyStartedError') {
                        skipped.push(source);
                        return null;
                    }
                    // For other errors, still record the source as started but with error result
                    started.push(source);
                    return {
                        source,
                        totalProcessed: 0,
                        status: 'error' as const,
                        error: (err as Error).message,
                        startedAt: new Date().toISOString(),
                        completedAt: new Date().toISOString(),
                    };
                }),
        );
    }

    const childResults = await Promise.all(childPromises);
    for (const result of childResults) {
        if (result) {
            results.push(result);
        }
    }

    return { results, started, skipped };
}
