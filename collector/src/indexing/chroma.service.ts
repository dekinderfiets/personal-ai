import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, Collection, EmbeddingFunction } from 'chromadb';
import type { Where, Metadata } from 'chromadb';
import axios from 'axios';
import { DataSource, IndexDocument, SearchResult, NavigationResult } from '../types';

const CHUNK_SIZE = 4000;
const CHUNK_OVERLAP = 200;
const MAX_CONTENT_LENGTH = 8000;

class OpenAIEmbedder implements EmbeddingFunction {
    name = 'openai';

    constructor(private apiKey: string, private model = 'text-embedding-3-small') {}

    async generate(texts: string[]): Promise<number[][]> {
        const response = await axios.post(
            'https://api.openai.com/v1/embeddings',
            { input: texts, model: this.model },
            { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' } },
        );
        return response.data.data.map((d: { embedding: number[] }) => d.embedding);
    }
}

@Injectable()
export class ChromaService implements OnModuleInit {
    private readonly logger = new Logger(ChromaService.name);
    private client!: ChromaClient;
    private embeddingFunction: EmbeddingFunction | undefined;
    private collections: Map<DataSource, Collection> = new Map();

    constructor(private configService: ConfigService) {}

    async onModuleInit() {
        try {
            const chromaUrl = this.configService.get<string>('chroma.url') || 'http://localhost:8001';
            const url = new URL(chromaUrl);

            this.client = new ChromaClient({
                host: url.hostname,
                port: parseInt(url.port || '8001', 10),
                ssl: url.protocol === 'https:',
            });

            const openaiApiKey = this.configService.get<string>('openai.apiKey');
            if (openaiApiKey) {
                this.embeddingFunction = new OpenAIEmbedder(openaiApiKey);
            } else {
                this.logger.warn('OPENAI_API_KEY not set - ChromaDB will use default embeddings');
            }

            this.logger.log(`ChromaDB client initialized at ${chromaUrl}`);
        } catch (error) {
            this.logger.error(`Failed to initialize ChromaDB: ${(error as Error).message}`);
        }
    }

    private getCollectionName(source: DataSource): string {
        return `collector_${source}`;
    }

    private async getOrCreateCollection(source: DataSource): Promise<Collection> {
        const cached = this.collections.get(source);
        if (cached) return cached;

        const name = this.getCollectionName(source);
        const collection = await this.client.getOrCreateCollection({
            name,
            ...(this.embeddingFunction ? { embeddingFunction: this.embeddingFunction } : {}),
        });
        this.collections.set(source, collection);
        return collection;
    }

    private chunkContent(content: string): string[] {
        if (content.length <= MAX_CONTENT_LENGTH) {
            return [content];
        }

        const chunks: string[] = [];
        let start = 0;
        while (start < content.length) {
            const end = Math.min(start + CHUNK_SIZE, content.length);
            chunks.push(content.slice(start, end));
            start = end - CHUNK_OVERLAP;
            if (start + CHUNK_OVERLAP >= content.length) break;
        }
        return chunks;
    }

    /**
     * Strip lone/unpaired Unicode surrogates (U+D800..U+DFFF) that break
     * JSON serialization when sending documents to ChromaDB.
     */
    private sanitizeText(text: string): string {
        return text.replace(
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
            '',
        );
    }

    private flattenMetadata(metadata: Record<string, unknown>): Metadata {
        const flat: Metadata = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (value === null || value === undefined) continue;
            if (typeof value === 'string') {
                flat[key] = this.sanitizeText(value);
            } else if (typeof value === 'number' || typeof value === 'boolean') {
                flat[key] = value;
            } else if (Array.isArray(value)) {
                flat[key] = this.sanitizeText(JSON.stringify(value));
            } else {
                flat[key] = this.sanitizeText(JSON.stringify(value));
            }
        }
        return flat;
    }

    async upsertDocuments(source: DataSource, documents: IndexDocument[]): Promise<void> {
        if (documents.length === 0) return;

        const collection = await this.getOrCreateCollection(source);

        const ids: string[] = [];
        const contents: string[] = [];
        const metadatas: Metadata[] = [];

        for (const doc of documents) {
            const sanitizedContent = this.sanitizeText(doc.content);

            // Check for pre-chunked documents (e.g. from GitHub file indexing)
            const preChunked = (doc as any).preChunked as { chunks: string[] } | undefined;
            const chunks = preChunked && preChunked.chunks.length > 1
                ? preChunked.chunks.map(c => this.sanitizeText(c))
                : this.chunkContent(sanitizedContent);

            if (chunks.length === 1) {
                ids.push(doc.id);
                contents.push(preChunked ? chunks[0] : sanitizedContent);
                metadatas.push(this.flattenMetadata(doc.metadata));
            } else {
                for (let i = 0; i < chunks.length; i++) {
                    const chunkId = `${doc.id}_chunk_${i}`;
                    ids.push(chunkId);
                    contents.push(chunks[i]);
                    metadatas.push(this.flattenMetadata({
                        ...doc.metadata,
                        chunkIndex: i,
                        totalChunks: chunks.length,
                        parentDocId: doc.id,
                    }));
                }
            }
        }

        // Upsert in batches of 100
        const batchSize = 100;
        for (let i = 0; i < ids.length; i += batchSize) {
            const batchIds = ids.slice(i, i + batchSize);
            const batchContents = contents.slice(i, i + batchSize);
            const batchMetadatas = metadatas.slice(i, i + batchSize);

            await collection.upsert({
                ids: batchIds,
                documents: batchContents,
                metadatas: batchMetadatas,
            });
        }

        this.logger.debug(`Upserted ${ids.length} items (from ${documents.length} documents) to ${source}`);
    }

    async search(
        query: string,
        options: {
            sources?: DataSource[];
            searchType?: 'vector' | 'keyword' | 'hybrid';
            limit?: number;
            offset?: number;
            where?: Record<string, unknown>;
            startDate?: string;
            endDate?: string;
        } = {},
    ): Promise<{ results: SearchResult[]; total: number }> {
        const {
            sources = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar', 'github'] as DataSource[],
            limit = 20,
            offset = 0,
            where,
            startDate,
            endDate,
        } = options;

        const allResults: SearchResult[] = [];

        for (const source of sources) {
            try {
                const collection = await this.getOrCreateCollection(source);

                const whereClause = this.buildWhereClause(where, startDate, endDate);

                const queryArgs: {
                    queryTexts: string[];
                    nResults: number;
                    where?: Where;
                } = {
                    queryTexts: [query],
                    nResults: limit + offset,
                };

                if (whereClause) {
                    queryArgs.where = whereClause;
                }

                const results = await collection.query(queryArgs);

                if (results.ids[0]) {
                    for (let i = 0; i < results.ids[0].length; i++) {
                        const distance = results.distances?.[0]?.[i] ?? 1;
                        const score = 1 / (1 + distance);

                        allResults.push({
                            id: results.ids[0][i],
                            source,
                            content: results.documents?.[0]?.[i] || '',
                            metadata: (results.metadatas?.[0]?.[i] as Record<string, unknown>) || {},
                            score,
                        });
                    }
                }
            } catch (error) {
                this.logger.warn(`Search failed for source ${source}: ${(error as Error).message}`);
            }
        }

        // Sort by score descending
        allResults.sort((a, b) => b.score - a.score);

        return {
            results: allResults.slice(offset, offset + limit),
            total: allResults.length,
        };
    }

    private buildWhereClause(
        where?: Record<string, unknown>,
        startDate?: string,
        endDate?: string,
    ): Where | undefined {
        const conditions: Where[] = [];

        if (where) {
            for (const [key, value] of Object.entries(where)) {
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    conditions.push({ [key]: value });
                }
            }
        }

        if (startDate) {
            conditions.push({ createdAt: { $gte: startDate } });
        }
        if (endDate) {
            conditions.push({ createdAt: { $lte: endDate } });
        }

        if (conditions.length === 0) return undefined;
        if (conditions.length === 1) return conditions[0];
        return { $and: conditions };
    }

    async deleteDocument(source: DataSource, documentId: string): Promise<void> {
        const collection = await this.getOrCreateCollection(source);

        // Delete the document and any chunks
        try {
            await collection.delete({ ids: [documentId] });
        } catch {
            // Ignore if not found
        }

        // Also delete any chunks
        try {
            const chunkResults = await collection.get({
                where: { parentDocId: documentId },
            });
            if (chunkResults.ids.length > 0) {
                await collection.delete({ ids: chunkResults.ids });
            }
        } catch {
            // Ignore if no chunks found
        }
    }

    async deleteCollection(source: DataSource): Promise<void> {
        const name = this.getCollectionName(source);
        try {
            await this.client.deleteCollection({ name });
            this.collections.delete(source);
            this.logger.log(`Deleted collection ${name}`);
        } catch (error) {
            this.logger.warn(`Failed to delete collection ${name}: ${(error as Error).message}`);
        }
    }

    async getDocument(source: DataSource, documentId: string): Promise<SearchResult | null> {
        const collection = await this.getOrCreateCollection(source);

        try {
            const result = await collection.get({
                ids: [documentId],
            });

            if (result.ids.length === 0) return null;

            return {
                id: result.ids[0],
                source,
                content: result.documents?.[0] || '',
                metadata: (result.metadatas?.[0] as Record<string, unknown>) || {},
                score: 1,
            };
        } catch {
            return null;
        }
    }

    async getDocumentsByMetadata(
        source: DataSource,
        where: Where,
        limit = 50,
    ): Promise<SearchResult[]> {
        const collection = await this.getOrCreateCollection(source);

        try {
            const result = await collection.get({
                where,
                limit,
            });

            return result.ids.map((id, i) => ({
                id,
                source,
                content: result.documents?.[i] || '',
                metadata: (result.metadatas?.[i] as Record<string, unknown>) || {},
                score: 1,
            }));
        } catch {
            return [];
        }
    }

    /**
     * Resolve the ChromaDB document ID for the parent of a given document.
     * Different connectors use different ID schemes, so we need per-source logic
     * to translate the metadata parentId into the actual stored document ID.
     */
    private resolveParentDocumentId(source: DataSource, metadata: Record<string, unknown>): string | null {
        const rawParentId = (metadata.parentId as string) || (metadata.parentDocId as string) || null;
        if (!rawParentId) {
            // Drive: derive parent from path (navigate to sibling files in same folder)
            if (source === 'drive' && metadata.path) {
                // path looks like "/folder/subfolder/file.txt" - parent is the folder path
                const path = metadata.path as string;
                const lastSlash = path.lastIndexOf('/');
                if (lastSlash > 0) {
                    return null; // No single parent doc for drive folders; handled via path-based sibling nav
                }
            }
            return null;
        }

        // Confluence comments store parentId as raw page numeric ID,
        // but the page document ID in ChromaDB is "confluence_{pageId}"
        if (source === 'confluence' && metadata.type === 'comment') {
            return `confluence_${rawParentId}`;
        }

        // All other connectors store parentId matching the actual ChromaDB document ID
        return rawParentId;
    }

    async navigate(
        documentId: string,
        direction: 'prev' | 'next' | 'siblings' | 'parent' | 'children',
        scope: 'chunk' | 'datapoint' | 'context',
        limit = 10,
    ): Promise<NavigationResult> {
        // First find the document across all sources
        let current: SearchResult | null = null;
        let currentSource: DataSource | null = null;
        const allSources: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar', 'github'];

        for (const source of allSources) {
            current = await this.getDocument(source, documentId);
            if (current) {
                currentSource = source;
                break;
            }
        }

        if (!current || !currentSource) {
            return {
                current: null,
                related: [],
                navigation: { hasPrev: false, hasNext: false, parentId: null, contextType: 'unknown' },
            };
        }

        const metadata = current.metadata;
        let related: SearchResult[] = [];

        // Parent and children are structural navigation - handle them regardless of scope
        if (direction === 'parent' || direction === 'children') {
            related = await this.navigateStructural(currentSource, current, metadata, direction, limit);
        } else if (scope === 'chunk') {
            related = await this.navigateChunks(currentSource, metadata, direction, limit);
        } else if (scope === 'datapoint') {
            related = await this.navigateDatapoint(currentSource, metadata, direction, limit);
        } else if (scope === 'context') {
            related = await this.navigateContext(currentSource, metadata, direction, limit);
        }

        const parentId = this.resolveParentDocumentId(currentSource, metadata);

        return {
            current,
            related,
            navigation: {
                hasPrev: related.length > 0 && (direction === 'prev' || direction === 'siblings'),
                hasNext: related.length > 0 && (direction === 'next' || direction === 'siblings'),
                parentId,
                contextType: this.getContextType(currentSource, metadata),
                totalSiblings: related.length,
            },
        };
    }

    /**
     * Handle parent/children navigation independent of scope.
     * Parent navigates up the hierarchy, children navigates down.
     */
    private async navigateStructural(
        source: DataSource,
        current: SearchResult,
        metadata: Record<string, unknown>,
        direction: 'parent' | 'children',
        limit: number,
    ): Promise<SearchResult[]> {
        if (direction === 'parent') {
            const parentDocId = this.resolveParentDocumentId(source, metadata);
            if (!parentDocId) return [];
            const parent = await this.getDocument(source, parentDocId);
            return parent ? [parent] : [];
        }

        if (direction === 'children') {
            // Look for documents whose parentId matches this document's logical ID
            const docId = this.getLogicalId(source, current, metadata);
            if (!docId) return [];

            const children = await this.getDocumentsByMetadata(source, { parentId: docId } as Where, limit);
            // Also check for chunk children
            const chunks = await this.getDocumentsByMetadata(source, { parentDocId: current.id } as Where, limit);
            return [...children, ...chunks].slice(0, limit);
        }

        return [];
    }

    /**
     * Get the logical ID that child documents use as their parentId.
     * For most connectors this is the metadata.id, but it varies by source.
     */
    private getLogicalId(source: DataSource, current: SearchResult, metadata: Record<string, unknown>): string | null {
        switch (source) {
            case 'jira':
                // Jira issues use issue.key as their ID and as parentId for comments
                return (metadata.id as string) || current.id;
            case 'confluence':
                // Confluence pages use raw page.id as parentId for comments
                return (metadata.id as string) || null;
            case 'slack':
                // Slack thread replies use the full slack_channelId_ts as parentId
                return current.id;
            case 'github':
                // GitHub PR comments/reviews use the full github_pr_repo_number as parentId
                return current.id;
            default:
                return (metadata.id as string) || current.id;
        }
    }

    private async navigateChunks(
        source: DataSource,
        metadata: Record<string, unknown>,
        direction: string,
        limit: number,
    ): Promise<SearchResult[]> {
        const parentDocId = metadata.parentDocId as string;
        const chunkIndex = metadata.chunkIndex as number;

        if (parentDocId === undefined || chunkIndex === undefined) return [];

        if (direction === 'prev') {
            const prevIndex = chunkIndex - 1;
            if (prevIndex < 0) return [];
            const id = `${parentDocId}_chunk_${prevIndex}`;
            const result = await this.getDocument(source, id);
            return result ? [result] : [];
        } else if (direction === 'next') {
            const nextIndex = chunkIndex + 1;
            const totalChunks = metadata.totalChunks as number;
            if (nextIndex >= totalChunks) return [];
            const id = `${parentDocId}_chunk_${nextIndex}`;
            const result = await this.getDocument(source, id);
            return result ? [result] : [];
        } else if (direction === 'siblings') {
            return this.getDocumentsByMetadata(source, { parentDocId } as Where, limit);
        }

        return [];
    }

    private async navigateDatapoint(
        source: DataSource,
        metadata: Record<string, unknown>,
        direction: string,
        limit: number,
    ): Promise<SearchResult[]> {
        const whereClause = this.buildDatapointWhereClause(source, metadata);
        if (!whereClause) return [];

        const docs = await this.getDocumentsByMetadata(source, whereClause, limit + 10);

        // Sort by timestamp/date
        const timestampField = this.getTimestampField(source);
        docs.sort((a, b) => {
            const aTime = String(a.metadata[timestampField] || '');
            const bTime = String(b.metadata[timestampField] || '');
            return aTime.localeCompare(bTime);
        });

        const currentId = metadata.id as string;
        const currentIdx = docs.findIndex(d => d.id === currentId || d.metadata.id === currentId);

        if (direction === 'prev') {
            return docs.slice(Math.max(0, currentIdx - limit), currentIdx);
        } else if (direction === 'next') {
            return docs.slice(currentIdx + 1, currentIdx + 1 + limit);
        } else if (direction === 'siblings') {
            return docs.filter(d => d.id !== currentId).slice(0, limit);
        }

        return [];
    }

    private async navigateContext(
        source: DataSource,
        metadata: Record<string, unknown>,
        direction: string,
        limit: number,
    ): Promise<SearchResult[]> {
        // parent/children are now handled by navigateStructural, but keep siblings logic
        if (direction === 'siblings') {
            const rawParentId = (metadata.parentId as string) || (metadata.parentDocId as string);
            if (rawParentId) {
                return this.getDocumentsByMetadata(source, { parentId: rawParentId } as Where, limit);
            }
        }

        const contextWhere = this.buildContextWhereClause(source, metadata);
        if (contextWhere) {
            return this.getDocumentsByMetadata(source, contextWhere, limit);
        }

        return [];
    }

    private buildDatapointWhereClause(
        source: DataSource,
        metadata: Record<string, unknown>,
    ): Where | null {
        switch (source) {
            case 'slack':
                if (metadata.threadTs) return { threadTs: metadata.threadTs as string };
                if (metadata.channelId) return { channelId: metadata.channelId as string };
                return null;
            case 'gmail':
                if (metadata.threadId) return { threadId: metadata.threadId as string };
                return null;
            case 'jira':
                if (metadata.parentId) return { parentId: metadata.parentId as string };
                if (metadata.project) return { project: metadata.project as string };
                return null;
            case 'drive':
                // Use folderPath for sibling navigation (files in same folder)
                if (metadata.folderPath) return { folderPath: metadata.folderPath as string };
                // Fallback for older indexed docs: extract folder from full path
                if (metadata.path) {
                    const path = metadata.path as string;
                    const lastSlash = path.lastIndexOf('/');
                    if (lastSlash > 0) {
                        return { folderPath: path.substring(0, lastSlash) };
                    }
                }
                return null;
            case 'confluence':
                if (metadata.parentId) return { parentId: metadata.parentId as string };
                if (metadata.space) return { space: metadata.space as string };
                return null;
            case 'calendar':
                return { source: 'calendar' };
            case 'github':
                if (metadata.parentId) return { parentId: metadata.parentId as string };
                if (metadata.repo) return { repo: metadata.repo as string };
                return null;
            default:
                return null;
        }
    }

    private buildContextWhereClause(
        source: DataSource,
        metadata: Record<string, unknown>,
    ): Where | null {
        switch (source) {
            case 'slack':
                if (metadata.channelId) return { channelId: metadata.channelId as string };
                return null;
            case 'gmail':
                if (metadata.threadId) return { threadId: metadata.threadId as string };
                return null;
            case 'jira':
                if (metadata.project) return { project: metadata.project as string };
                return null;
            case 'drive':
                // Context-level: show files in the same folder
                if (metadata.folderPath) return { folderPath: metadata.folderPath as string };
                if (metadata.path) {
                    const path = metadata.path as string;
                    const lastSlash = path.lastIndexOf('/');
                    if (lastSlash > 0) {
                        return { folderPath: path.substring(0, lastSlash) };
                    }
                }
                return null;
            case 'confluence':
                if (metadata.space) return { space: metadata.space as string };
                return null;
            case 'github':
                if (metadata.repo) return { repo: metadata.repo as string };
                return null;
            default:
                return null;
        }
    }

    private getTimestampField(source: DataSource): string {
        switch (source) {
            case 'slack': return 'timestamp';
            case 'gmail': return 'date';
            case 'calendar': return 'start';
            default: return 'updatedAt';
        }
    }

    private getContextType(source: DataSource, metadata: Record<string, unknown>): string {
        switch (source) {
            case 'slack':
                return metadata.threadTs ? 'thread' : 'channel';
            case 'gmail':
                return 'thread';
            case 'jira':
                return metadata.type === 'comment' ? 'issue' : 'project';
            case 'drive':
                return 'folder';
            case 'confluence':
                return metadata.type === 'comment' ? 'page' : 'space';
            case 'calendar':
                return 'calendar';
            case 'github':
                return metadata.type === 'pr_comment' || metadata.type === 'pr_review' ? 'pull_request' : 'repository';
            default:
                return 'unknown';
        }
    }
}
