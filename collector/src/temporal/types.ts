/**
 * Shared types for Temporal workflows and activities.
 * IMPORTANT: This file runs inside the Temporal workflow sandbox (V8 isolate).
 * Do NOT import NestJS, Node.js built-ins, or any non-serializable types here.
 */

import { DataSource } from '../types';
export type { DataSource };

export interface IndexSourceInput {
    source: DataSource;
    request: SerializableIndexRequest;
}

export interface IndexSourceResult {
    source: DataSource;
    totalProcessed: number;
    status: 'completed' | 'error';
    error?: string;
    startedAt: string;
    completedAt: string;
}

export interface CollectAllInput {
    request: SerializableIndexRequest;
    sources?: DataSource[];
}

export interface CollectAllResult {
    results: IndexSourceResult[];
    started: DataSource[];
    skipped: DataSource[];
}

export interface SerializableIndexRequest {
    fullReindex?: boolean;
    projectKeys?: string[];
    channelIds?: string[];
    spaceKeys?: string[];
    folderIds?: string[];
    gmailSettings?: {
        domains: string[];
        senders: string[];
        labels: string[];
    };
    calendarIds?: string[];
    repos?: string[];
    indexFiles?: boolean;
}

export interface LoadSettingsResult {
    request: SerializableIndexRequest;
    cursor: SerializableCursor | null;
    configKey: string;
    configChanged: boolean;
}

export interface SerializableCursor {
    source: DataSource;
    lastSync: string;
    syncToken?: string;
    metadata?: Record<string, any>;
}

export interface FetchBatchResult {
    documents: SerializableDocument[];
    newCursor: Partial<SerializableCursor>;
    hasMore: boolean;
    batchLastSync?: string;
}

export interface SerializableDocument {
    id: string;
    source: DataSource;
    content: string;
    metadata: Record<string, unknown>;
    preChunked?: { chunks: string[] };
}

export interface ProcessBatchResult {
    processed: number;
}

export interface StatusUpdate {
    status?: 'idle' | 'running' | 'completed' | 'error';
    documentsIndexed?: number;
    error?: string;
    lastError?: string;
    lastErrorAt?: string;
    lastSync?: string;
}
