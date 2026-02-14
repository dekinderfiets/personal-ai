import { Client as EsClient } from '@elastic/elasticsearch';
import { Injectable, Logger, OnModuleDestroy,OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CohereClient } from 'cohere-ai';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { encoding_for_model } from 'tiktoken';

import { DataSource, IndexDocument, SearchResult } from '../types';

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

@Injectable()
export class ElasticsearchService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ElasticsearchService.name);
    // ES v9 typed client doesn't accept body-style calls; we use any to avoid overload conflicts
    private client: any;
    private redis!: Redis;
    private indexName!: string;
    private openaiApiKey!: string;
    private embeddingModel!: string;
    private cohereClient: CohereClient | null = null;
    private static readonly EMBEDDING_CACHE_PREFIX = 'search:embedding:';
    private static readonly EMBEDDING_CACHE_TTL_SECS = 300; // 5 minutes

    constructor(private configService: ConfigService) {}

    async onModuleDestroy() {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- redis may not be initialized if onModuleInit failed
        if (this.redis) await this.redis.quit();
    }

    async onModuleInit() {
        this.redis = new Redis(this.configService.get<string>('redis.url')!);

        try {
            const esNode = this.configService.get<string>('elasticsearch.node') || 'http://localhost:9200';
            this.indexName = this.configService.get<string>('elasticsearch.index') || 'collector_documents';

            this.client = new EsClient({ node: esNode });

            this.openaiApiKey = this.configService.get<string>('openai.apiKey') || '';
            this.embeddingModel = this.configService.get<string>('openai.embeddingModel') || 'text-embedding-3-large';

            if (!this.openaiApiKey) {
                this.logger.warn('OPENAI_API_KEY not set - embedding generation will fail');
            }

            const cohereApiKey = this.configService.get<string>('cohere.apiKey');
            if (cohereApiKey) {
                this.cohereClient = new CohereClient({ token: cohereApiKey });
                this.logger.log('Cohere re-ranking client initialized');
            } else {
                this.logger.warn('COHERE_API_KEY not set - search re-ranking disabled');
            }

            await this.ensureIndex();

            this.logger.log(`Elasticsearch client initialized at ${esNode}, index: ${this.indexName}`);
        } catch (error) {
            this.logger.error(`Failed to initialize Elasticsearch: ${(error as Error).message}`);
        }
    }

    private async ensureIndex(): Promise<void> {
        const exists = await this.client.indices.exists({ index: this.indexName });
        if (exists) return;

        await this.client.indices.create({
            index: this.indexName,
            body: {
                settings: {
                    number_of_shards: 1,
                    number_of_replicas: 0,
                    refresh_interval: '5s',
                },
                mappings: {
                    dynamic: 'true' as any,
                    properties: {
                        source: { type: 'keyword' },
                        content: { type: 'text' },
                        _originalContent: { type: 'text', index: false },
                        _contentHash: { type: 'keyword' },
                        embedding: { type: 'dense_vector', dims: 3072, index: true, similarity: 'cosine' },
                        title: { type: 'text', fields: { keyword: { type: 'keyword' } } },
                        createdAt: { type: 'date', ignore_malformed: true },
                        updatedAt: { type: 'date', ignore_malformed: true },
                        createdAtTs: { type: 'long' },
                        updatedAtTs: { type: 'long' },
                        parentDocId: { type: 'keyword' },
                        chunkIndex: { type: 'integer' },
                        totalChunks: { type: 'integer' },
                        type: { type: 'keyword' },
                        author: { type: 'keyword' },
                        project: { type: 'keyword' },
                        channel: { type: 'keyword' },
                        channelId: { type: 'keyword' },
                        space: { type: 'keyword' },
                        labels: { type: 'keyword' },
                        status: { type: 'keyword' },
                        priority: { type: 'keyword' },
                        url: { type: 'keyword', index: false },
                        relevance_score: { type: 'float' },
                        is_owner: { type: 'boolean' },
                        is_assigned_to_me: { type: 'boolean' },
                        is_author: { type: 'boolean' },
                        is_organizer: { type: 'boolean' },
                        reactionCount: { type: 'integer' },
                        mention_count: { type: 'integer' },
                        thread_depth: { type: 'integer' },
                        priority_weight: { type: 'float' },
                        label_count: { type: 'integer' },
                    },
                },
            },
        });

        this.logger.log(`Created index ${this.indexName}`);
    }

    // ── Embedding Generation ────────────────────────────────────────────

    private async generateEmbeddings(texts: string[]): Promise<number[][]> {
        const allEmbeddings: number[][] = [];
        const batchSize = 100;

        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const response = await axios.post(
                'https://api.openai.com/v1/embeddings',
                { input: batch, model: this.embeddingModel },
                { headers: { Authorization: `Bearer ${this.openaiApiKey}`, 'Content-Type': 'application/json' } },
            );
            const embeddings = response.data.data
                .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
                .map((d: { embedding: number[] }) => d.embedding);
            allEmbeddings.push(...embeddings);
        }

        return allEmbeddings;
    }

    private async getQueryEmbedding(query: string): Promise<number[]> {
        const cacheKey = `${ElasticsearchService.EMBEDDING_CACHE_PREFIX}${createHash('sha256').update(query).digest('hex').slice(0, 32)}`;

        try {
            const cached = await this.redis.getBuffer(cacheKey);
            if (cached) {
                return Array.from(new Float32Array(cached.buffer, cached.byteOffset, cached.byteLength / 4));
            }
        } catch {
            // Cache miss or Redis error — fall through to generate
        }

        const embeddings = await this.generateEmbeddings([query]);
        const embedding = embeddings[0];

        try {
            const buffer = Buffer.from(new Float32Array(embedding).buffer);
            await this.redis.set(cacheKey, buffer, 'EX', ElasticsearchService.EMBEDDING_CACHE_TTL_SECS);
        } catch {
            // Non-critical — continue without caching
        }

        return embedding;
    }

    // ── Text Processing ─────────────────────────────────────────────────

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
        const parts: string[] = [];
        const regex = /[^\n]+\n\n|[^\n]+\n|[^.!?]*[.!?]\s*|[^.!?\n]+$/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            if (match[0].trim()) parts.push(match[0]);
        }
        return parts.length > 0 ? parts : [text];
    }

    private sanitizeText(text: string): string {
        return text.replace(
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
            '',
        );
    }

    private buildChunkContext(metadata: Record<string, unknown>, source: DataSource): string {
        const parts: string[] = [];

        const title = (metadata.title || metadata.subject || metadata.name || '') as string;
        if (title) parts.push(`Document: ${title}`);
        parts.push(`Source: ${source}`);

        switch (source) {
            case 'jira':
                if (metadata.project) parts.push(`Project: ${metadata.project as string}`);
                if (metadata.issueType) parts.push(`Type: ${metadata.issueType as string}`);
                if (metadata.status) parts.push(`Status: ${metadata.status as string}`);
                if (metadata.priority) parts.push(`Priority: ${metadata.priority as string}`);
                break;
            case 'slack':
                if (metadata.channel) parts.push(`Channel: #${metadata.channel as string}`);
                if (metadata.author) parts.push(`Author: ${metadata.author as string}`);
                if (metadata.threadTs) parts.push('(thread reply)');
                break;
            case 'gmail':
                if (metadata.from) parts.push(`From: ${metadata.from as string}`);
                if (metadata.subject) parts.push(`Subject: ${metadata.subject as string}`);
                break;
            case 'drive':
                if (metadata.folderPath) parts.push(`Path: ${metadata.folderPath as string}`);
                if (metadata.mimeType) parts.push(`Type: ${metadata.mimeType as string}`);
                break;
            case 'confluence':
                if (metadata.space) parts.push(`Space: ${(metadata.spaceName || metadata.space) as string}`);
                if (metadata.type === 'comment') parts.push('(page comment)');
                break;
            case 'calendar':
                if (metadata.start) parts.push(`When: ${metadata.start as string}`);
                if (metadata.location) parts.push(`Location: ${metadata.location as string}`);
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

    private flattenMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
        const flat: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (value === null || value === undefined) continue;
            if (typeof value === 'string') {
                flat[key] = this.sanitizeText(value);
                // Store numeric timestamp for date fields
                if (key === 'createdAt' || key === 'updatedAt') {
                    const ts = new Date(value).getTime();
                    if (!isNaN(ts)) flat[`${key}Ts`] = ts;
                }
            } else if (typeof value === 'number' || typeof value === 'boolean') {
                flat[key] = value;
            } else if (Array.isArray(value)) {
                // ES handles arrays natively — keep as-is
                flat[key] = value;
            } else {
                flat[key] = this.sanitizeText(JSON.stringify(value));
            }
        }
        return flat;
    }

    private contentHash(text: string): string {
        return createHash('sha256').update(text).digest('hex').slice(0, 16);
    }

    private normalizeQuery(query: string): string {
        const normalized = query.trim().replace(/\s+/g, ' ');
        // Don't modify queries that look like IDs (e.g. PROJ-123, PR #45)
        if (/^[A-Z]+-\d+$/.test(normalized) || /^#?\d+$/.test(normalized)) {
            return normalized;
        }
        return normalized;
    }

    // ── Upsert ──────────────────────────────────────────────────────────

    async upsertDocuments(source: DataSource, documents: IndexDocument[]): Promise<void> {
        if (documents.length === 0) return;

        // Prepare all items (chunked or not)
        const items: { id: string; content: string; metadata: Record<string, unknown> }[] = [];

        for (const doc of documents) {
            const sanitizedContent = this.sanitizeText(doc.content);

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
                        source,
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
                            source,
                            _contentHash: this.contentHash(chunks[i]),
                            _originalContent: chunks[i].slice(0, 8000),
                        },
                    });
                }
            }
        }

        // Fetch existing hashes via mget
        const batchSize = 100;
        const existingHashes = new Map<string, string>();
        for (let i = 0; i < items.length; i += batchSize) {
            const batchIds = items.slice(i, i + batchSize).map(it => it.id);
            try {
                const response = await this.client.mget({
                    index: this.indexName,
                    body: { ids: batchIds },
                    _source: ['_contentHash'],
                });
                for (const doc of response.docs) {
                    if ((doc).found && (doc)._source?._contentHash) {
                        existingHashes.set(doc._id, (doc)._source._contentHash);
                    }
                }
            } catch {
                // Index may be empty or docs don't exist yet — all will be full upserts
            }
        }

        // Split into content-changed vs metadata-only
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

        // Content-changed: generate embeddings and bulk index
        for (let i = 0; i < upsertItems.length; i += batchSize) {
            const batch = upsertItems.slice(i, i + batchSize);
            const embeddings = await this.generateEmbeddings(batch.map(it => it.content));

            const bulkBody: any[] = [];
            for (let j = 0; j < batch.length; j++) {
                bulkBody.push({ index: { _index: this.indexName, _id: batch[j].id } });
                bulkBody.push({
                    ...batch[j].metadata,
                    content: batch[j].content,
                    embedding: embeddings[j],
                });
            }

            const bulkResponse = await this.client.bulk({ body: bulkBody });
            if (bulkResponse.errors) {
                const errors = bulkResponse.items
                    .filter((item: any) => item.index?.error)
                    .map((item: any) => item.index?.error?.reason);
                this.logger.warn(`Bulk index errors: ${errors.slice(0, 3).join('; ')}`);
            }
        }

        // Metadata-only: bulk update (partial doc, no embedding regeneration)
        for (let i = 0; i < updateItems.length; i += batchSize) {
            const batch = updateItems.slice(i, i + batchSize);
            const bulkBody: any[] = [];
            for (const item of batch) {
                bulkBody.push({ update: { _index: this.indexName, _id: item.id } });
                bulkBody.push({ doc: item.metadata });
            }

            const bulkResponse = await this.client.bulk({ body: bulkBody });
            if (bulkResponse.errors) {
                const errors = bulkResponse.items
                    .filter((item: any) => item.update?.error)
                    .map((item: any) => item.update?.error?.reason);
                this.logger.warn(`Bulk update errors: ${errors.slice(0, 3).join('; ')}`);
            }
        }

        if (updateItems.length > 0) {
            this.logger.debug(
                `${source}: ${upsertItems.length} embedded, ${updateItems.length} metadata-only (content unchanged)`,
            );
        } else {
            this.logger.debug(`Upserted ${items.length} items (from ${documents.length} documents) to ${source}`);
        }
    }

    // ── Search (3-Stage Pipeline) ───────────────────────────────────────

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
            sources = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'] as DataSource[],
            searchType = 'hybrid',
            limit = 20,
            offset = 0,
            where,
            startDate,
            endDate,
        } = options;

        const normalizedQuery = this.normalizeQuery(query);
        const fetchLimit = limit + offset;
        const filters = this.buildFilters(sources, where, startDate, endDate);

        // Pre-compute query embedding for vector/hybrid
        let queryEmbedding: number[] | undefined;
        if (searchType === 'vector' || searchType === 'hybrid') {
            queryEmbedding = await this.getQueryEmbedding(normalizedQuery);
        }

        // Stage 1: ES Retrieval
        const searchBody = this.buildSearchQuery(normalizedQuery, searchType, filters, queryEmbedding, fetchLimit);
        const esResponse = await this.client.search({
            index: this.indexName,
            body: searchBody,
        });

        const hits = (esResponse.hits?.hits || []) as any[];
        const allResults: SearchResult[] = hits.map(hit => this.hitToSearchResult(hit));

        // Stage 2: Chunk dedup + Cohere reranking
        // Dedup: keep best chunk per parentDocId
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

        // Multi-chunk boost
        for (const [parentId, result] of parentBest) {
            const chunkCount = parentChunkCount.get(parentId) || 1;
            if (chunkCount > 1) {
                result.score *= 1 + Math.min(Math.log(chunkCount) * 0.05, 0.15);
            }
        }
        deduped.push(...parentBest.values());
        deduped.sort((a, b) => b.score - a.score);

        // Cohere reranking
        const reranked = await this.rerankResults(normalizedQuery, deduped, fetchLimit);

        // Stage 3: Weighted linear personalization
        this.applyPersonalization(reranked);

        // Final sort
        reranked.sort((a, b) => b.score - a.score);

        return {
            results: reranked.slice(offset, offset + limit),
            total: reranked.length,
        };
    }

    private buildSearchQuery(
        query: string,
        searchType: string,
        filters: any[],
        queryEmbedding?: number[],
        limit = 200,
    ): any {
        const filterClause = filters.length > 0 ? { bool: { filter: filters } } : undefined;

        if (searchType === 'keyword') {
            return {
                size: limit,
                _source: { excludes: ['embedding'] },
                query: {
                    function_score: {
                        query: {
                            bool: {
                                must: [
                                    {
                                        multi_match: {
                                            query,
                                            fields: ['content', 'title^3'],
                                        },
                                    },
                                ],
                                ...(filters.length > 0 ? { filter: filters } : {}),
                            },
                        },
                        functions: [
                            {
                                exp: {
                                    updatedAtTs: {
                                        origin: Date.now(),
                                        scale: 2592000000,
                                        offset: 604800000,
                                        decay: 0.5,
                                    },
                                },
                                weight: 0.3,
                            },
                        ],
                        boost_mode: 'multiply',
                    },
                },
            };
        }

        if (searchType === 'vector') {
            return {
                size: limit,
                _source: { excludes: ['embedding'] },
                knn: {
                    field: 'embedding',
                    query_vector: queryEmbedding,
                    k: 200,
                    num_candidates: 400,
                    ...(filterClause ? { filter: filterClause } : {}),
                },
            };
        }

        // hybrid: top-level query + knn combined by ES
        return {
            size: limit,
            _source: { excludes: ['embedding'] },
            query: {
                function_score: {
                    query: {
                        bool: {
                            must: [
                                {
                                    multi_match: {
                                        query,
                                        fields: ['content', 'title^3'],
                                    },
                                },
                            ],
                            ...(filters.length > 0 ? { filter: filters } : {}),
                        },
                    },
                    functions: [
                        {
                            exp: {
                                updatedAtTs: {
                                    origin: Date.now(),
                                    scale: 2592000000,
                                    offset: 604800000,
                                    decay: 0.5,
                                },
                            },
                            weight: 0.3,
                        },
                    ],
                    boost_mode: 'multiply',
                },
            },
            knn: {
                field: 'embedding',
                query_vector: queryEmbedding,
                k: 200,
                num_candidates: 400,
                ...(filterClause ? { filter: filterClause } : {}),
            },
        };
    }

    private buildFilters(
        sources: DataSource[],
        where?: Record<string, unknown>,
        startDate?: string,
        endDate?: string,
    ): any[] {
        const filters: any[] = [];

        // Source filter
        if (sources.length > 0 && sources.length < 6) {
            filters.push({ terms: { source: sources } });
        }

        // Where clause filters
        if (where) {
            for (const [key, value] of Object.entries(where)) {
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    filters.push({ term: { [key]: value } });
                }
            }
        }

        // Date range filters
        if (startDate) {
            const ts = new Date(startDate).getTime();
            if (!isNaN(ts)) filters.push({ range: { createdAtTs: { gte: ts } } });
        }
        if (endDate) {
            const ts = new Date(endDate + 'T23:59:59.999Z').getTime();
            if (!isNaN(ts)) filters.push({ range: { createdAtTs: { lte: ts } } });
        }

        return filters;
    }

    private async rerankResults(
        query: string,
        results: SearchResult[],
        topN: number,
    ): Promise<SearchResult[]> {
        if (!this.cohereClient || results.length === 0) return results;

        const candidateCount = Math.min(results.length, 200);
        const candidates = results.slice(0, candidateCount);
        const remainder = results.slice(candidateCount);

        try {
            const response = await this.cohereClient.v2.rerank({
                model: 'rerank-v3.5',
                query,
                documents: candidates.map(r => r.content.slice(0, 4096)),
                topN: Math.min(topN, candidateCount),
            });

            // Pure semantic score — replace original score entirely
            const reranked: SearchResult[] = response.results.map(rr => {
                const original = candidates[rr.index];
                return {
                    ...original,
                    score: rr.relevanceScore,
                };
            });

            reranked.sort((a, b) => b.score - a.score);
            return [...reranked, ...remainder];
        } catch (error) {
            this.logger.warn(`Cohere rerank failed, using original ranking: ${(error as Error).message}`);
            return results;
        }
    }

    /**
     * Stage 3: Weighted linear personalization.
     * final = semantic * (1 + 0.20*recency + 0.10*ownership + 0.05*engagement + 0.10*connector)
     */
    private applyPersonalization(results: SearchResult[]): void {
        for (const result of results) {
            const semantic = result.score;

            // Recency: 0.5^(daysSince / halfLife)
            const dateStr = (result.metadata.updatedAt || result.metadata.date || result.metadata.modifiedAt || result.metadata.timestamp) as string | undefined;
            let recency = 0;
            if (dateStr) {
                const daysSince = Math.max(0, (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
                const halfLife = this.getRecencyHalfLife(result.source);
                recency = Math.pow(0.5, daysSince / halfLife);
            }

            // Ownership
            const isOwner = result.metadata.is_owner || result.metadata.is_organizer || result.metadata.is_author;
            const isAssigned = result.metadata.is_assigned_to_me;
            let ownership = 0;
            if (isOwner) ownership = 1.0;
            else if (isAssigned) ownership = 0.8;

            // Engagement
            const engagement = this.computeEngagementScore(result);

            // Connector relevance
            const connector = (result.metadata.relevance_score as number) || 0;

            result.score = semantic * (1 + 0.20 * recency + 0.10 * ownership + 0.05 * engagement + 0.10 * connector);
        }
    }

    /**
     * Compute engagement score [0,1] based on source-specific signals.
     */
    private computeEngagementScore(result: SearchResult): number {
        const m = result.metadata;

        switch (result.source) {
            case 'slack': {
                const reactions = (m.reactionCount as number) || 0;
                const mentions = (m.mention_count as number) || 0;
                const isThread = !!(m.threadTs);
                return Math.min(1, reactions * 0.1 + mentions * 0.15 + (isThread ? 0.2 : 0));
            }
            case 'jira': {
                const priorityWeight = (m.priority_weight as number) || 0;
                return Math.min(1, priorityWeight / 5);
            }
            case 'gmail': {
                const depth = (m.thread_depth as number) || 0;
                if (depth > 3) return 0.6;
                if (depth > 1) return 0.3;
                return 0;
            }
            case 'confluence': {
                const labelCount = (m.label_count as number) || 0;
                return Math.min(1, labelCount * 0.15);
            }
            default:
                return 0;
        }
    }

    // ── List / Count / Get / Delete ─────────────────────────────────────

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

        const filters: any[] = [{ term: { source } }];

        // Exclude chunks — only show parent/standalone documents
        filters.push({ bool: { must_not: { exists: { field: 'parentDocId' } } } });

        if (where) {
            for (const [key, value] of Object.entries(where)) {
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    filters.push({ term: { [key]: value } });
                }
            }
        }

        if (startDate) {
            const ts = new Date(startDate).getTime();
            if (!isNaN(ts)) filters.push({ range: { createdAtTs: { gte: ts } } });
        }
        if (endDate) {
            const ts = new Date(endDate + 'T23:59:59.999Z').getTime();
            if (!isNaN(ts)) filters.push({ range: { createdAtTs: { lte: ts } } });
        }

        try {
            const response = await this.client.search({
                index: this.indexName,
                body: {
                    size: limit,
                    from: offset,
                    _source: { excludes: ['embedding'] },
                    query: {
                        bool: { filter: filters },
                    },
                    sort: [
                        { updatedAtTs: 'desc' },
                        { createdAtTs: 'desc' },
                    ],
                },
            });

            const hits = (response.hits?.hits || []) as any[];
            const total = typeof response.hits?.total === 'object'
                ? (response.hits.total).value
                : response.hits?.total || 0;

            const results = hits.map(hit => this.hitToSearchResult(hit));
            return { results, total };
        } catch (error) {
            this.logger.warn(`Failed to list documents for ${source}: ${(error as Error).message}`);
            return { results: [], total: 0 };
        }
    }

    async countDocuments(source: DataSource): Promise<number> {
        try {
            const response = await this.client.count({
                index: this.indexName,
                body: {
                    query: { term: { source } },
                },
            });
            return response.count;
        } catch (error) {
            this.logger.warn(`Failed to count documents for ${source}: ${(error as Error).message}`);
            return 0;
        }
    }

    async getDocument(source: DataSource, documentId: string): Promise<SearchResult | null> {
        try {
            const response = await this.client.get({
                index: this.indexName,
                id: documentId,
                _source_excludes: ['embedding'],
            });

            if (!response.found) return null;

            const src = (response)._source;
            return {
                id: response._id,
                source: src.source || source,
                content: src._originalContent || src.content || '',
                metadata: src,
                score: 1,
            };
        } catch {
            return null;
        }
    }

    async getDocumentsByMetadata(
        source: DataSource,
        where: Record<string, unknown>,
        limit = 50,
    ): Promise<SearchResult[]> {
        const filters: any[] = [{ term: { source } }];

        for (const [key, value] of Object.entries(where)) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                filters.push({ term: { [key]: value } });
            }
        }

        try {
            const response = await this.client.search({
                index: this.indexName,
                body: {
                    size: limit,
                    _source: { excludes: ['embedding'] },
                    query: {
                        bool: { filter: filters },
                    },
                },
            });

            const hits = (response.hits?.hits || []) as any[];
            return hits.map(hit => this.hitToSearchResult(hit));
        } catch {
            return [];
        }
    }

    async deleteDocument(source: DataSource, documentId: string): Promise<void> {
        // Delete the document itself
        try {
            await this.client.delete({
                index: this.indexName,
                id: documentId,
                refresh: 'wait_for',
            });
        } catch {
            // Ignore if not found
        }

        // Delete any chunks with parentDocId matching this document
        try {
            await this.client.deleteByQuery({
                index: this.indexName,
                body: {
                    query: {
                        term: { parentDocId: documentId },
                    },
                },
                refresh: true,
            });
        } catch {
            // Ignore if no chunks found
        }
    }

    async deleteCollection(source: DataSource): Promise<void> {
        try {
            await this.client.deleteByQuery({
                index: this.indexName,
                body: {
                    query: {
                        term: { source },
                    },
                },
                refresh: true,
            });
            this.logger.log(`Deleted all documents for source ${source}`);
        } catch (error) {
            this.logger.warn(`Failed to delete documents for ${source}: ${(error as Error).message}`);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private hitToSearchResult(hit: any): SearchResult {
        const src = hit._source;
        return {
            id: hit._id,
            source: src.source,
            content: src._originalContent || src.content || '',
            metadata: src,
            score: hit._score || 0,
        };
    }

    private getRecencyHalfLife(source: DataSource): number {
        switch (source) {
            case 'slack': return 7;
            case 'calendar': return 14;
            case 'gmail': return 14;
            case 'jira': return 30;
            case 'confluence': return 90;
            case 'drive': return 90;
            default: return 30;
        }
    }


}
