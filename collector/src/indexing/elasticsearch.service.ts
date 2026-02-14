import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as EsClient } from '@elastic/elasticsearch';
import { CohereClient } from 'cohere-ai';
import Redis from 'ioredis';
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
                        repo: { type: 'keyword' },
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
        let normalized = query.trim().replace(/\s+/g, ' ');
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
                    if ((doc as any).found && (doc as any)._source?._contentHash) {
                        existingHashes.set(doc._id, (doc as any)._source._contentHash);
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
            sources = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar', 'github'] as DataSource[],
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
        let allResults: SearchResult[] = hits.map(hit => this.hitToSearchResult(hit));

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
        let reranked = await this.rerankResults(normalizedQuery, deduped, fetchLimit);

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
        if (sources.length > 0 && sources.length < 7) {
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
            case 'github': {
                const reactions = (m.reactionCount as number) || 0;
                const labels = (m.label_count as number) || 0;
                return Math.min(1, reactions * 0.1 + labels * 0.1);
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
                ? (response.hits.total as any).value
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

            const src = (response as any)._source;
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

    // ── Navigation ──────────────────────────────────────────────────────

    async navigate(
        documentId: string,
        direction: 'prev' | 'next' | 'siblings' | 'parent' | 'children',
        scope: 'chunk' | 'datapoint' | 'context',
        limit = 10,
    ): Promise<NavigationResult> {
        // Find the document — single index, so just get by ID directly
        let current: SearchResult | null = null;
        let currentSource: DataSource | null = null;

        try {
            const response = await this.client.get({
                index: this.indexName,
                id: documentId,
                _source_excludes: ['embedding'],
            });

            if (response.found) {
                const src = (response as any)._source;
                current = {
                    id: response._id,
                    source: src.source,
                    content: src._originalContent || src.content || '',
                    metadata: src,
                    score: 1,
                };
                currentSource = src.source;
            }
        } catch {
            // Not found
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

    private resolveParentDocumentId(source: DataSource, metadata: Record<string, unknown>): string | null {
        const rawParentId = (metadata.parentId as string) || (metadata.parentDocId as string) || null;
        if (!rawParentId) {
            if (source === 'drive' && metadata.path) {
                const path = metadata.path as string;
                const lastSlash = path.lastIndexOf('/');
                if (lastSlash > 0) {
                    return null;
                }
            }
            return null;
        }

        if (source === 'confluence' && metadata.type === 'comment') {
            return `confluence_${rawParentId}`;
        }

        return rawParentId;
    }

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
            const docId = this.getLogicalId(source, current, metadata);
            if (!docId) return [];

            const children = await this.getDocumentsByMetadata(source, { parentId: docId }, limit);
            const chunks = await this.getDocumentsByMetadata(source, { parentDocId: current.id }, limit);
            return [...children, ...chunks].slice(0, limit);
        }

        return [];
    }

    private getLogicalId(source: DataSource, current: SearchResult, metadata: Record<string, unknown>): string | null {
        switch (source) {
            case 'jira':
                return (metadata.id as string) || current.id;
            case 'confluence':
                return (metadata.id as string) || null;
            case 'slack':
                return current.id;
            case 'github':
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
            return this.getDocumentsByMetadata(source, { parentDocId }, limit);
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
        if (direction === 'siblings') {
            const rawParentId = (metadata.parentId as string) || (metadata.parentDocId as string);
            if (rawParentId) {
                return this.getDocumentsByMetadata(source, { parentId: rawParentId }, limit);
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
    ): Record<string, unknown> | null {
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
    ): Record<string, unknown> | null {
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
            case 'github': return 60;
            case 'confluence': return 90;
            case 'drive': return 90;
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
