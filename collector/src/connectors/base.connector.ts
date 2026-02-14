import { ConnectorResult,Cursor, IndexRequest } from '../types';

/**
 * Base connector interface that all data source connectors must implement
 */
export abstract class BaseConnector {
    /**
     * Fetch documents from the data source
     * @param cursor Current cursor position (null for fresh fetch)
     * @param request Request options (filters, etc.)
     * @returns Fetched documents, new cursor position, and whether there's more data
     */
    abstract fetch(cursor: Cursor | null, request: IndexRequest): Promise<ConnectorResult>;

    /**
     * Check if the connector is properly configured
     */
    abstract isConfigured(): boolean;

    /**
     * Get the data source name
     */
    abstract getSourceName(): string;
}
