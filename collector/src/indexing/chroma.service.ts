import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, Collection, EmbeddingFunction } from 'chromadb';
import type { Where, Metadata } from 'chromadb';

type IncludeField = 'documents' | 'metadatas' | 'distances' | 'embeddings' | 'uris';
import axios from 'axios';
import { createHash } from 'crypto';
import { encoding_for_model } from 'tiktoken';
import { DataSource, IndexDocument, SearchResult, NavigationResult } from '../types';

const CHUNK_SIZE_TOKENS = 512;
const CHUNK_OVERLAP_TOKENS = 64;
const MIN_TOKENS_FOR_CHUNKING = 600;

// Lazy singleton tokenizer
let _tokenizer: ReturnType<typeof encoding_for_model> | null = null;
function getTokenizer() {
    if (!_tokenizer) _tokenizer = encoding_for_model('gpt-4o');
    return _tokenizer;
}

function countTokens(text: string): number {
    return getTokenizer().encode(text).length;
}

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
                const embeddingModel = this.configService.get<string>('openai.embeddingModel') || 'text-embedding-3-small';
                this.embeddingFunction = new OpenAIEmbedder(openaiApiKey, embeddingModel);
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
            metadata: { 'hnsw:space': 'cosine' },
        });
        this.collections.set(source, collection);
        return collection;
    }

    private chunkContent(content: string): string[] {
        const tokenCount = countTokens(content);
        if (tokenCount <= MIN_TOKENS_FOR_CHUNKING) {
            return [content];
        }

        const chunks: string[] = [];
        const sentences = this.splitIntoSentences(content);
        let currentChunk: string[] = [];
        let currentTokens = 0;

        for (const sentence of sentences) {
            const sentenceTokens = countTokens(sentence);

            if (currentTokens + sentenceTokens > CHUNK_SIZE_TOKENS && currentChunk.length > 0) {
                chunks.push(currentChunk.join(''));

                // Build overlap from end of current chunk
                let overlapTokens = 0;
                const overlapSentences: string[] = [];
                for (let i = currentChunk.length - 1; i >= 0; i--) {
                    const st = countTokens(currentChunk[i]);
                    if (overlapTokens + st > CHUNK_OVERLAP_TOKENS) break;
                    overlapTokens += st;
                    overlapSentences.unshift(currentChunk[i]);
                }
                currentChunk = [...overlapSentences];
                currentTokens = overlapTokens;
            }

            currentChunk.push(sentence);
            currentTokens += sentenceTokens;
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk.join(''));
        }

        return chunks.length > 0 ? chunks : [content];
    }

    private splitIntoSentences(text: string): string[] {
        // Split on paragraph breaks, line breaks, or sentence-ending punctuation
        const parts: string[] = [];
        const regex = /[^\n]+\n\n|[^\n]+\n|[^.!?]*[.!?]\s*|[^.!?\n]+$/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            if (match[0].trim()) parts.push(match[0]);
        }
        return parts.length > 0 ? parts : [text];
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

    /**
     * Build a context header to prepend to chunks before embedding.
     * This enriches the embedding with document-level context (title, source, metadata)
     * so the vector captures the chunk's meaning within its broader document context.
     * The original content is stored separately for display.
     */
    private buildChunkContext(metadata: Record<string, unknown>, source: DataSource): string {
        const parts: string[] = [];

        const title = (metadata.title || metadata.subject || metadata.name || '') as string;
        if (title) parts.push(`Document: ${title}`);
        parts.push(`Source: ${source}`);

        switch (source) {
            case 'jira':
                if (metadata.project) parts.push(`Project: ${metadata.project}`);
                if (metadata.issueType) parts.push(`Type: ${metadata.issueType}`);
                if (metadata.status) parts.push(`Status: ${metadata.status}`);
                if (metadata.priority) parts.push(`Priority: ${metadata.priority}`);
                break;
            case 'slack':
                if (metadata.channel) parts.push(`Channel: #${metadata.channel}`);
                if (metadata.author) parts.push(`Author: ${metadata.author}`);
                if (metadata.threadTs) parts.push('(thread reply)');
                break;
            case 'gmail':
                if (metadata.from) parts.push(`From: ${metadata.from}`);
                if (metadata.subject) parts.push(`Subject: ${metadata.subject}`);
                break;
            case 'drive':
                if (metadata.folderPath) parts.push(`Path: ${metadata.folderPath}`);
                if (metadata.mimeType) parts.push(`Type: ${metadata.mimeType}`);
                break;
            case 'confluence':
                if (metadata.space) parts.push(`Space: ${metadata.spaceName || metadata.space}`);
                if (metadata.type === 'comment') parts.push('(page comment)');
                break;
            case 'calendar':
                if (metadata.start) parts.push(`When: ${metadata.start}`);
                if (metadata.location) parts.push(`Location: ${metadata.location}`);
                break;
            case 'github':
                if (metadata.repo) parts.push(`Repository: ${metadata.repo}`);
                if (metadata.type) parts.push(`Type: ${metadata.type}`);
                if (metadata.state) parts.push(`State: ${metadata.state}`);
                if (metadata.filePath) parts.push(`File: ${metadata.filePath}`);
                break;
        }

        const dateStr = (metadata.createdAt || metadata.date || metadata.start || metadata.updatedAt) as string;
        if (dateStr) {
            try {
                parts.push(`Date: ${new Date(dateStr).toISOString().split('T')[0]}`);
            } catch { /* skip invalid dates */ }
        }

        return parts.join('\n');
    }

    private flattenMetadata(metadata: Record<string, unknown>): Metadata {
        const flat: Metadata = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (value === null || value === undefined) continue;
            if (typeof value === 'string') {
                flat[key] = this.sanitizeText(value);
                // Store numeric timestamp for date fields so ChromaDB $gte/$lte work
                if (key === 'createdAt' || key === 'updatedAt') {
                    const ts = new Date(value).getTime();
                    if (!isNaN(ts)) flat[`${key}Ts`] = ts;
                }
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

    private contentHash(text: string): string {
        return createHash('sha256').update(text).digest('hex').slice(0, 16);
    }

    async upsertDocuments(source: DataSource, documents: IndexDocument[]): Promise<void> {
        if (documents.length === 0) return;

        const collection = await this.getOrCreateCollection(source);

        // Prepare all items (chunked or not)
        const items: { id: string; content: string; metadata: Metadata }[] = [];

        for (const doc of documents) {
            const sanitizedContent = this.sanitizeText(doc.content);

            // Check for pre-chunked documents (e.g. from GitHub file indexing)
            const preChunked = (doc as any).preChunked as { chunks: string[] } | undefined;
            const chunks = preChunked && preChunked.chunks.length > 1
                ? preChunked.chunks.map(c => this.sanitizeText(c))
                : this.chunkContent(sanitizedContent);

            if (chunks.length === 1) {
                const content = preChunked ? chunks[0] : sanitizedContent;
                const contextHeader = this.buildChunkContext(doc.metadata as Record<string, unknown>, source);
                const enrichedContent = contextHeader ? `${contextHeader}\n\n${content}` : content;
                items.push({
                    id: doc.id,
                    content: enrichedContent,
                    metadata: {
                        ...this.flattenMetadata(doc.metadata),
                        _contentHash: this.contentHash(content),
                        _originalContent: content.slice(0, 8000),
                    },
                });
            } else {
                const contextHeader = this.buildChunkContext(doc.metadata as Record<string, unknown>, source);
                for (let i = 0; i < chunks.length; i++) {
                    const enrichedContent = contextHeader ? `${contextHeader}\n\n${chunks[i]}` : chunks[i];
                    items.push({
                        id: `${doc.id}_chunk_${i}`,
                        content: enrichedContent,
                        metadata: {
                            ...this.flattenMetadata({
                                ...doc.metadata,
                                chunkIndex: i,
                                totalChunks: chunks.length,
                                parentDocId: doc.id,
                            }),
                            _contentHash: this.contentHash(chunks[i]),
                            _originalContent: chunks[i].slice(0, 8000),
                        },
                    });
                }
            }
        }

        // Fetch existing hashes to detect what actually changed
        const batchSize = 100;
        const existingHashes = new Map<string, string>();
        for (let i = 0; i < items.length; i += batchSize) {
            const batchIds = items.slice(i, i + batchSize).map(it => it.id);
            try {
                const existing = await collection.get({
                    ids: batchIds,
                    include: ['metadatas'] as IncludeField[],
                });
                for (let j = 0; j < existing.ids.length; j++) {
                    const hash = (existing.metadatas?.[j] as Record<string, unknown>)?._contentHash;
                    if (typeof hash === 'string') existingHashes.set(existing.ids[j], hash);
                }
            } catch {
                // Collection may be empty or IDs don't exist yet — all will be full upserts
            }
        }

        // Split into content-changed (full upsert) vs metadata-only (update without re-embedding)
        const upsertItems: typeof items = [];
        const updateItems: typeof items = [];

        for (const item of items) {
            const oldHash = existingHashes.get(item.id);
            if (oldHash && oldHash === item.metadata._contentHash) {
                updateItems.push(item);
            } else {
                upsertItems.push(item);
            }
        }

        // Full upsert — generates new embeddings
        for (let i = 0; i < upsertItems.length; i += batchSize) {
            const batch = upsertItems.slice(i, i + batchSize);
            await collection.upsert({
                ids: batch.map(it => it.id),
                documents: batch.map(it => it.content),
                metadatas: batch.map(it => it.metadata),
            });
        }

        // Metadata-only update — no embeddings regenerated
        for (let i = 0; i < updateItems.length; i += batchSize) {
            const batch = updateItems.slice(i, i + batchSize);
            await collection.update({
                ids: batch.map(it => it.id),
                metadatas: batch.map(it => it.metadata),
            });
        }

        if (updateItems.length > 0) {
            this.logger.debug(
                `${source}: ${upsertItems.length} embedded, ${updateItems.length} metadata-only (content unchanged)`,
            );
        } else {
            this.logger.debug(`Upserted ${items.length} items (from ${documents.length} documents) to ${source}`);
        }
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
            searchType = 'vector',
            limit = 20,
            offset = 0,
            where,
            startDate,
            endDate,
        } = options;

        const whereClause = this.buildWhereClause(where, startDate, endDate);
        const fetchLimit = limit + offset;

        // Pre-compute query embedding once for vector/hybrid searches
        let queryEmbedding: number[] | undefined;
        if ((searchType === 'vector' || searchType === 'hybrid') && this.embeddingFunction) {
            const embeddings = await this.embeddingFunction.generate([query]);
            queryEmbedding = embeddings[0];
        }

        // Query all collections in parallel
        const sourceResults = await Promise.all(
            sources.map(async (source) => {
                try {
                    const collection = await this.getOrCreateCollection(source);

                    if (searchType === 'vector') {
                        return this.vectorSearch(collection, source, query, fetchLimit, whereClause, queryEmbedding);
                    } else if (searchType === 'keyword') {
                        return this.keywordSearch(collection, source, query, fetchLimit, whereClause);
                    } else if (searchType === 'hybrid') {
                        return this.hybridSearch(collection, source, query, fetchLimit, whereClause, queryEmbedding);
                    }
                    return [];
                } catch (error) {
                    this.logger.warn(`Search failed for source ${source}: ${(error as Error).message}`);
                    return [];
                }
            }),
        );
        const allResults = sourceResults.flat();

        // Deduplicate chunks: keep highest-scoring chunk per parent, track chunk match counts
        const parentBest = new Map<string, SearchResult>();
        const parentChunkCount = new Map<string, number>();
        const deduped: SearchResult[] = [];
        for (const r of allResults) {
            const parentId = r.metadata.parentDocId as string | undefined;
            if (parentId) {
                parentChunkCount.set(parentId, (parentChunkCount.get(parentId) || 0) + 1);
                const existing = parentBest.get(parentId);
                if (!existing || r.score > existing.score) {
                    parentBest.set(parentId, r);
                }
            } else {
                deduped.push(r);
            }
        }

        // Boost multi-chunk matches: if multiple chunks matched, it's a stronger signal
        for (const [parentId, result] of parentBest) {
            const chunkCount = parentChunkCount.get(parentId) || 1;
            if (chunkCount > 1) {
                result.score *= 1 + Math.min(Math.log(chunkCount) * 0.05, 0.15);
            }
        }
        deduped.push(...parentBest.values());

        // Apply post-retrieval boosts
        this.applyRelevancyBoosts(deduped, query);

        // Sort by score descending
        deduped.sort((a, b) => b.score - a.score);

        return {
            results: deduped.slice(offset, offset + limit),
            total: deduped.length,
        };
    }

    private async vectorSearch(
        collection: Collection,
        source: DataSource,
        query: string,
        limit: number,
        whereClause?: Where,
        precomputedEmbedding?: number[],
    ): Promise<SearchResult[]> {
        const queryArgs: {
            queryTexts?: string[];
            queryEmbeddings?: number[][];
            nResults: number;
            where?: Where;
            include: IncludeField[];
        } = {
            nResults: limit,
            include: ['documents', 'metadatas', 'distances'] as IncludeField[],
        };

        // Use pre-computed embedding to avoid redundant OpenAI API calls per collection
        if (precomputedEmbedding) {
            queryArgs.queryEmbeddings = [precomputedEmbedding];
        } else {
            queryArgs.queryTexts = [query];
        }

        if (whereClause) queryArgs.where = whereClause;

        const results = await collection.query(queryArgs);
        return this.parseQueryResults(results, source);
    }

    private async keywordSearch(
        collection: Collection,
        source: DataSource,
        query: string,
        limit: number,
        whereClause?: Where,
    ): Promise<SearchResult[]> {
        // Split query into individual terms for multi-word matching
        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
        if (terms.length === 0) return [];

        // Build where_document filter — match documents containing all terms
        const whereDocument = terms.length === 1
            ? { $contains: terms[0] }
            : { $and: terms.map(t => ({ $contains: t })) };

        const getArgs: { limit: number; whereDocument: any; where?: Where; include: IncludeField[] } = {
            limit,
            whereDocument,
            include: ['documents', 'metadatas'] as IncludeField[],
        };
        if (whereClause) getArgs.where = whereClause;

        const results = await collection.get(getArgs);

        return results.ids.map((id, i) => {
            const metadata = (results.metadatas?.[i] as Record<string, unknown>) || {};
            return {
                id,
                source,
                content: (metadata._originalContent as string) || results.documents?.[i] || '',
                metadata,
                score: this.computeKeywordScore(results.documents?.[i] || '', terms),
            };
        });
    }

    private async hybridSearch(
        collection: Collection,
        source: DataSource,
        query: string,
        limit: number,
        whereClause?: Where,
        precomputedEmbedding?: number[],
    ): Promise<SearchResult[]> {
        // Over-fetch from each method for better recall before RRF fusion
        const fetchLimit = limit * 2;

        const [vectorResults, keywordResults] = await Promise.all([
            this.vectorSearch(collection, source, query, fetchLimit, whereClause, precomputedEmbedding),
            this.keywordSearch(collection, source, query, fetchLimit, whereClause),
        ]);

        // Reciprocal Rank Fusion (RRF)
        // RRF_score(d) = 1/(k + rank_vector(d)) + 1/(k + rank_keyword(d))
        const k = 60;

        // Build rank maps (1-indexed ranks, sorted by score descending)
        const vectorRank = new Map<string, number>();
        vectorResults
            .sort((a, b) => b.score - a.score)
            .forEach((r, i) => vectorRank.set(r.id, i + 1));

        const keywordRank = new Map<string, number>();
        keywordResults
            .sort((a, b) => b.score - a.score)
            .forEach((r, i) => keywordRank.set(r.id, i + 1));

        // Collect all unique documents
        const resultMap = new Map<string, SearchResult>();
        for (const r of vectorResults) resultMap.set(r.id, r);
        for (const r of keywordResults) {
            if (!resultMap.has(r.id)) resultMap.set(r.id, r);
        }

        // Compute RRF scores and normalize to 0-1
        const maxRrf = 2 / (k + 1);
        for (const [id, result] of resultMap) {
            let rrfScore = 0;
            const vRank = vectorRank.get(id);
            const kRank = keywordRank.get(id);
            if (vRank !== undefined) rrfScore += 1 / (k + vRank);
            if (kRank !== undefined) rrfScore += 1 / (k + kRank);
            result.score = rrfScore / maxRrf;
        }

        return Array.from(resultMap.values());
    }

    private parseQueryResults(results: any, source: DataSource): SearchResult[] {
        const parsed: SearchResult[] = [];
        if (results.ids[0]) {
            for (let i = 0; i < results.ids[0].length; i++) {
                const distance = results.distances?.[0]?.[i] ?? 2;
                // Cosine distance range: 0 (identical) to 2 (opposite)
                // Convert to similarity: 1 - distance gives range [-1, 1], clamp to [0, 1]
                const score = Math.max(0, 1 - distance);
                const metadata = (results.metadatas?.[0]?.[i] as Record<string, unknown>) || {};
                parsed.push({
                    id: results.ids[0][i],
                    source,
                    content: (metadata._originalContent as string) || results.documents?.[0]?.[i] || '',
                    metadata,
                    score,
                });
            }
        }
        return parsed;
    }

    private computeKeywordScore(content: string, terms: string[]): number {
        const lower = content.toLowerCase();
        const docLength = lower.length;
        let matchedTerms = 0;
        let tfSum = 0;

        for (const term of terms) {
            let idx = 0;
            let count = 0;
            while ((idx = lower.indexOf(term, idx)) !== -1) {
                count++;
                idx += term.length;
            }
            if (count > 0) {
                matchedTerms++;
                // TF with diminishing returns: 1 + log(count)
                tfSum += 1 + Math.log(count);
            }
        }

        if (matchedTerms === 0) return 0;

        // Coverage: fraction of query terms found in the document
        const coverage = matchedTerms / terms.length;
        // Normalized TF: average log-TF per matched term, capped at 1
        const normalizedTF = Math.min(1, tfSum / matchedTerms / 3);
        // Length normalization: penalize very long docs where terms appear by chance
        const lengthFactor = 1 / (1 + Math.log(docLength / 2000));

        return coverage * 0.6 + normalizedTF * 0.3 + lengthFactor * 0.1;
    }

    /**
     * Apply post-retrieval relevancy boosts:
     * - relevance_score from connector-specific scoring
     * - title match boost
     * - recency boost
     */
    private applyRelevancyBoosts(results: SearchResult[], query: string): void {
        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);

        for (const result of results) {
            let boost = 1.0;

            // 1. Blend with connector relevance_score (stored at indexing time)
            // Range: 0.3-0.85 typically. Scale to boost multiplier 0.85-1.15
            const relevanceScore = result.metadata.relevance_score as number | undefined;
            if (relevanceScore !== undefined && relevanceScore > 0) {
                const relevanceBoost = 0.85 + relevanceScore * 0.35;
                result.score *= relevanceBoost;
            }

            // 2. Title match boost
            const title = ((result.metadata.title as string) || (result.metadata.subject as string) || '').toLowerCase();
            if (title) {
                if (title.includes(queryLower)) {
                    // Exact query appears in title
                    boost *= 1.3;
                } else if (queryTerms.length > 0) {
                    const titleMatchRatio = queryTerms.filter(t => title.includes(t)).length / queryTerms.length;
                    if (titleMatchRatio > 0) {
                        boost *= 1 + titleMatchRatio * 0.2;
                    }
                }
            }

            // 3. Recency boost using connector-specific half-life decay
            // Different sources have different time-sensitivity (Slack decays fast, docs slow)
            const dateStr = (result.metadata.updatedAt || result.metadata.date || result.metadata.modifiedAt || result.metadata.timestamp) as string | undefined;
            if (dateStr) {
                const daysSince = Math.max(0, (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
                const halfLife = this.getRecencyHalfLife(result.source);
                const recencyScore = Math.pow(0.5, daysSince / halfLife);
                // Blend: up to 8% boost for very recent, decays with half-life
                boost *= 1 + recencyScore * 0.08;
            }

            result.score = Math.min(1, result.score * boost);
        }
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
            const ts = new Date(startDate).getTime();
            if (!isNaN(ts)) conditions.push({ createdAtTs: { $gte: ts } });
        }
        if (endDate) {
            // Use end of day so the selected date is inclusive
            const ts = new Date(endDate + 'T23:59:59.999Z').getTime();
            if (!isNaN(ts)) conditions.push({ createdAtTs: { $lte: ts } });
        }

        if (conditions.length === 0) return undefined;
        if (conditions.length === 1) return conditions[0];
        return { $and: conditions };
    }

    async countDocuments(source: DataSource): Promise<number> {
        try {
            const collection = await this.getOrCreateCollection(source);
            return await collection.count();
        } catch (error) {
            this.logger.warn(`Failed to count documents for ${source}: ${(error as Error).message}`);
            return 0;
        }
    }

    async listDocuments(
        source: DataSource,
        options: {
            limit?: number;
            offset?: number;
            where?: Record<string, unknown>;
            startDate?: string;
            endDate?: string;
        } = {},
    ): Promise<{ results: SearchResult[]; total: number }> {
        const { limit = 20, offset = 0, where, startDate, endDate } = options;

        const collection = await this.getOrCreateCollection(source);
        const whereClause = this.buildWhereClause(where, startDate, endDate);

        try {
            // Fetch all matching documents (ChromaDB doesn't support ordering in .get())
            const getArgs: { where?: Where; include: IncludeField[] } = {
                include: ['documents', 'metadatas'] as IncludeField[],
            };
            if (whereClause) getArgs.where = whereClause;

            const result = await collection.get(getArgs);

            const docs: SearchResult[] = result.ids.map((id, i) => {
                const metadata = (result.metadatas?.[i] as Record<string, unknown>) || {};
                return {
                    id,
                    source,
                    content: (metadata._originalContent as string) || result.documents?.[i] || '',
                    metadata,
                    score: 0,
                };
            });

            // Sort by updatedAtTs descending (most recent first)
            docs.sort((a, b) => {
                const aTs = (a.metadata.updatedAtTs as number) || (a.metadata.createdAtTs as number) || 0;
                const bTs = (b.metadata.updatedAtTs as number) || (b.metadata.createdAtTs as number) || 0;
                return bTs - aTs;
            });

            return {
                results: docs.slice(offset, offset + limit),
                total: docs.length,
            };
        } catch (error) {
            this.logger.warn(`Failed to list documents for ${source}: ${(error as Error).message}`);
            return { results: [], total: 0 };
        }
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

    /**
     * Back-fill createdAtTs/updatedAtTs numeric timestamps on existing documents.
     * Uses collection.update() with metadatas only — no embeddings are regenerated.
     */
    async migrateTimestamps(source: DataSource): Promise<number> {
        const collection = await this.getOrCreateCollection(source);
        let migrated = 0;
        let offset = 0;
        const batchSize = 100;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const batch = await collection.get({
                limit: batchSize,
                offset,
                include: ['metadatas'] as IncludeField[],
            });

            if (batch.ids.length === 0) break;

            const idsToUpdate: string[] = [];
            const metasToUpdate: Metadata[] = [];

            for (let i = 0; i < batch.ids.length; i++) {
                const meta = (batch.metadatas?.[i] ?? {}) as Record<string, unknown>;

                // Skip if already migrated
                if (typeof meta.createdAtTs === 'number') continue;

                const createdAt = meta.createdAt as string | undefined;
                if (!createdAt) continue;

                const ts = new Date(createdAt).getTime();
                if (isNaN(ts)) continue;

                const patch: Metadata = { createdAtTs: ts };
                const updatedAt = meta.updatedAt as string | undefined;
                if (updatedAt) {
                    const uTs = new Date(updatedAt).getTime();
                    if (!isNaN(uTs)) patch.updatedAtTs = uTs;
                }

                idsToUpdate.push(batch.ids[i]);
                metasToUpdate.push(patch);
            }

            if (idsToUpdate.length > 0) {
                await collection.update({ ids: idsToUpdate, metadatas: metasToUpdate });
                migrated += idsToUpdate.length;
            }

            offset += batch.ids.length;
            if (batch.ids.length < batchSize) break;
        }

        this.logger.log(`Migrated ${migrated} documents in ${source} with numeric timestamps`);
        return migrated;
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

            const metadata = (result.metadatas?.[0] as Record<string, unknown>) || {};
            return {
                id: result.ids[0],
                source,
                content: (metadata._originalContent as string) || result.documents?.[0] || '',
                metadata,
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

            return result.ids.map((id, i) => {
                const metadata = (result.metadatas?.[i] as Record<string, unknown>) || {};
                return {
                    id,
                    source,
                    content: (metadata._originalContent as string) || result.documents?.[i] || '',
                    metadata,
                    score: 1,
                };
            });
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

    private getRecencyHalfLife(source: DataSource): number {
        switch (source) {
            case 'slack': return 7;        // Slack messages decay fast
            case 'calendar': return 14;    // Events moderately time-sensitive
            case 'gmail': return 14;       // Emails moderately time-sensitive
            case 'jira': return 30;        // Tickets stay relevant longer
            case 'github': return 60;      // Code changes decay slowly
            case 'confluence': return 90;  // Docs stay relevant a long time
            case 'drive': return 90;       // Documents stay relevant a long time
            default: return 30;
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
