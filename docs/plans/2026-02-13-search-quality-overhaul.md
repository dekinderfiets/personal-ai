# Search Quality Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve search precision, recall, and ranking by overhauling chunking, enrichment, keyword scoring, hybrid fusion, metadata boosts, and adding cross-encoder re-ranking.

**Architecture:** Token-based chunking (512 tokens) with contextual enrichment feeds better embeddings. BM25-like keyword scoring replaces naive substring matching. Weighted RRF (70/30) favors semantic over lexical. Cohere cross-encoder re-ranks top candidates for final precision. Enhanced metadata boosts widen the scoring range.

**Tech Stack:** tiktoken (token counting), cohere-ai (re-ranking), existing OpenAI text-embedding-3-large, ChromaDB, NestJS

---

### Task 1: Install Dependencies

**Files:**
- Modify: `collector/package.json`

**Step 1: Install tiktoken and cohere-ai**

Run: `cd /Volumes/projects/personal-ai/collector && npm install tiktoken cohere-ai`

**Step 2: Verify installation**

Run: `cd /Volumes/projects/personal-ai/collector && node -e "require('tiktoken'); require('cohere-ai'); console.log('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
cd /Volumes/projects/personal-ai
git add collector/package.json collector/package-lock.json
git commit -m "chore: add tiktoken and cohere-ai dependencies for search quality overhaul"
```

---

### Task 2: Add Cohere Configuration

**Files:**
- Modify: `collector/src/config/config.ts:56-63`
- Modify: `collector/.env`
- Modify: `collector/.env.example`

**Step 1: Add cohere config to config.ts**

In `collector/src/config/config.ts`, add after line 63 (after the `openaiConfig` block):

```typescript
export const cohereConfig = registerAs('cohere', () => ({
    apiKey: process.env.COHERE_API_KEY || '',
}));
```

**Step 2: Register in app.module.ts**

In `collector/src/app.module.ts`:
- Add import: `import { cohereConfig } from './config/config';` (update the existing import line)
- Add `cohereConfig` to the `load` array in `ConfigModule.forRoot()`

**Step 3: Add COHERE_API_KEY to .env**

Append to `collector/.env`:

```
# Cohere API Key for search re-ranking
COHERE_API_KEY=your-cohere-api-key
```

**Step 4: Add COHERE_API_KEY to .env.example**

Append to `collector/.env.example`:

```
# Cohere (for search re-ranking)
COHERE_API_KEY=your-cohere-api-key
```

**Step 5: Commit**

```bash
cd /Volumes/projects/personal-ai
git add collector/src/config/config.ts collector/src/app.module.ts collector/.env.example
git commit -m "feat: add Cohere API configuration for search re-ranking"
```

Note: Do NOT commit .env (contains secrets).

---

### Task 3: Token-Based Chunking

**Files:**
- Modify: `collector/src/indexing/chroma.service.ts:1-13,82-128`
- Modify: `collector/src/indexing/chunking.service.ts:1-7,59-101`

**Step 1: Update chroma.service.ts constants and add token counting**

Replace the constants at the top of `collector/src/indexing/chroma.service.ts` (lines 11-13):

```typescript
import { encoding_for_model } from 'tiktoken';

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
```

**Step 2: Replace chunkContent method**

Replace the `chunkContent` method (lines 82-128) with token-based chunking:

```typescript
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
```

**Step 3: Update chunking.service.ts for token-based splitting**

In `collector/src/indexing/chunking.service.ts`, update the constants (lines 5-7):

```typescript
import { encoding_for_model } from 'tiktoken';

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 64;
const MIN_CONTENT_FOR_CHUNKING = 600;

let _tokenizer: ReturnType<typeof encoding_for_model> | null = null;
function getTokenizer() {
    if (!_tokenizer) _tokenizer = encoding_for_model('gpt-4o');
    return _tokenizer;
}

function tokenLength(text: string): number {
    return getTokenizer().encode(text).length;
}
```

Update the `chunkCode` method to use token-based length function (line 62):

```typescript
if (tokenLength(content) < MIN_CONTENT_FOR_CHUNKING) {
```

And in the RecursiveCharacterTextSplitter calls, add `lengthFunction`:

```typescript
const splitter = RecursiveCharacterTextSplitter.fromLanguage(language, {
    chunkSize,
    chunkOverlap,
    lengthFunction: tokenLength,
});
```

Same for `chunkText` method (line 92 and 96-99):

```typescript
if (tokenLength(content) < MIN_CONTENT_FOR_CHUNKING) {
    return [content];
}

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    lengthFunction: tokenLength,
});
```

**Step 4: Verify build**

Run: `cd /Volumes/projects/personal-ai/collector && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
cd /Volumes/projects/personal-ai
git add collector/src/indexing/chroma.service.ts collector/src/indexing/chunking.service.ts
git commit -m "feat: switch to token-based chunking (512 tokens) for better embedding quality"
```

---

### Task 4: Contextual Chunk Enrichment

**Files:**
- Modify: `collector/src/indexing/chroma.service.ts` (upsertDocuments method + new enrichment method)

**Step 1: Add the enrichment method**

Add this new method to `ChromaService` class (after the `sanitizeText` method):

```typescript
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
```

**Step 2: Modify upsertDocuments to enrich chunks before embedding**

In the `upsertDocuments` method, after chunking (around line 182), modify so the enriched content is used for the `documents` field (what gets embedded) while the original content is stored in metadata for display.

Replace the chunk processing block (lines 184-207) with:

```typescript
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
```

**Step 3: Update parseQueryResults and other search result returns to use original content**

In `parseQueryResults` (line 481), use `_originalContent` when available:

```typescript
private parseQueryResults(results: any, source: DataSource): SearchResult[] {
    const parsed: SearchResult[] = [];
    if (results.ids[0]) {
        for (let i = 0; i < results.ids[0].length; i++) {
            const distance = results.distances?.[0]?.[i] ?? 2;
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
```

Also update `keywordSearch` return (around line 419) to prefer `_originalContent`:

```typescript
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
```

And `listDocuments`, `getDocument`, and `getDocumentsByMetadata` similarly: when returning `content`, prefer `metadata._originalContent` over `results.documents[i]`.

**Step 4: Verify build**

Run: `cd /Volumes/projects/personal-ai/collector && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
cd /Volumes/projects/personal-ai
git add collector/src/indexing/chroma.service.ts
git commit -m "feat: add contextual chunk enrichment for better semantic embeddings"
```

---

### Task 5: Query Preprocessing

**Files:**
- Modify: `collector/src/indexing/chroma.service.ts` (search method + new normalizeQuery method)

**Step 1: Add query normalization method**

Add to `ChromaService` class:

```typescript
/**
 * Normalize and preprocess query for better matching.
 * Handles compound terms, camelCase splitting, and whitespace normalization.
 */
private normalizeQuery(query: string): string {
    let normalized = query.trim().replace(/\s+/g, ' ');

    // Don't modify queries that look like IDs or specific references (e.g. PROJ-123, PR #45)
    if (/^[A-Z]+-\d+$/.test(normalized) || /^#?\d+$/.test(normalized)) {
        return normalized;
    }

    return normalized;
}

/**
 * Expand query terms for keyword search.
 * Splits compound terms (hyphenated, camelCase) into individual tokens
 * while keeping the original compound term for exact matching.
 */
private expandQueryTerms(query: string): string[] {
    const baseTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const expanded = new Set<string>(baseTerms);

    for (const term of baseTerms) {
        // Split hyphenated terms: "authentication-issue" -> "authentication", "issue"
        if (term.includes('-')) {
            term.split('-').filter(t => t.length > 1).forEach(t => expanded.add(t));
        }
        // Split camelCase: "authIssue" -> "auth", "issue"
        const camelParts = term.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
        if (camelParts.length > 1) {
            camelParts.filter(t => t.length > 1).forEach(t => expanded.add(t));
        }
        // Split underscored: "auth_issue" -> "auth", "issue"
        if (term.includes('_')) {
            term.split('_').filter(t => t.length > 1).forEach(t => expanded.add(t));
        }
    }

    return Array.from(expanded);
}
```

**Step 2: Use normalizeQuery in the search method**

At the top of the `search()` method (around line 282), add:

```typescript
query = this.normalizeQuery(query);
```

**Step 3: Use expandQueryTerms in keywordSearch**

In `keywordSearch` method, replace line 402:

```typescript
const terms = this.expandQueryTerms(query);
```

**Step 4: Verify build**

Run: `cd /Volumes/projects/personal-ai/collector && npx tsc --noEmit`

**Step 5: Commit**

```bash
cd /Volumes/projects/personal-ai
git add collector/src/indexing/chroma.service.ts
git commit -m "feat: add query preprocessing with compound term expansion"
```

---

### Task 6: BM25-Like Keyword Scoring

**Files:**
- Modify: `collector/src/indexing/chroma.service.ts` (computeKeywordScore method)

**Step 1: Replace computeKeywordScore with BM25-like scoring**

Replace the `computeKeywordScore` method (lines 501-531):

```typescript
/**
 * BM25-like keyword scoring with TF saturation and IDF approximation.
 * Uses document length normalization and diminishing returns on term frequency.
 *
 * BM25 formula simplified:
 *   score = sum_over_terms( IDF(t) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl/avgdl)) )
 *
 * We approximate IDF using document length as a proxy (shorter docs with term = more specific).
 */
private computeKeywordScore(content: string, terms: string[]): number {
    const lower = content.toLowerCase();
    const docLength = lower.split(/\s+/).length; // word count
    const avgDocLength = 200; // approximate average document length in words
    const k1 = 1.2; // TF saturation parameter
    const b = 0.75; // length normalization parameter

    let score = 0;
    let matchedTerms = 0;

    for (const term of terms) {
        // Count occurrences
        let idx = 0;
        let tf = 0;
        while ((idx = lower.indexOf(term, idx)) !== -1) {
            tf++;
            idx += term.length;
        }

        if (tf === 0) continue;
        matchedTerms++;

        // IDF approximation: rarer terms (fewer matching docs) should score higher
        // Since we don't have collection stats, use term length as a proxy:
        // longer terms are more specific and should weight more
        const idf = Math.log(1 + (1 / Math.max(0.1, term.length / 10)));

        // BM25 TF saturation with length normalization
        const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / avgDocLength)));

        score += idf * tfNorm;
    }

    if (matchedTerms === 0) return 0;

    // Coverage bonus: reward matching all query terms
    const coverage = matchedTerms / terms.length;
    const coverageBonus = coverage === 1.0 ? 1.2 : coverage;

    // Normalize to 0-1 range
    const maxPossibleScore = terms.length * 2.0; // theoretical max per term ~2.0
    const normalizedScore = Math.min(1, (score * coverageBonus) / maxPossibleScore);

    return normalizedScore;
}
```

**Step 2: Verify build**

Run: `cd /Volumes/projects/personal-ai/collector && npx tsc --noEmit`

**Step 3: Commit**

```bash
cd /Volumes/projects/personal-ai
git add collector/src/indexing/chroma.service.ts
git commit -m "feat: replace naive keyword scoring with BM25-like algorithm"
```

---

### Task 7: Weighted RRF for Hybrid Search

**Files:**
- Modify: `collector/src/indexing/chroma.service.ts` (hybridSearch method, lines 429-479)

**Step 1: Update hybridSearch with weighted RRF**

Replace the RRF scoring section in `hybridSearch` (lines 466-476):

```typescript
// Weighted RRF: 70% vector (semantic) + 30% keyword (lexical)
const vectorWeight = 0.7;
const keywordWeight = 0.3;
const maxRrf = vectorWeight / (k + 1) + keywordWeight / (k + 1);

for (const [id, result] of resultMap) {
    let rrfScore = 0;
    const vRank = vectorRank.get(id);
    const kRank = keywordRank.get(id);
    if (vRank !== undefined) rrfScore += vectorWeight / (k + vRank);
    if (kRank !== undefined) rrfScore += keywordWeight / (k + kRank);
    result.score = rrfScore / maxRrf;
}
```

**Step 2: Verify build**

Run: `cd /Volumes/projects/personal-ai/collector && npx tsc --noEmit`

**Step 3: Commit**

```bash
cd /Volumes/projects/personal-ai
git add collector/src/indexing/chroma.service.ts
git commit -m "feat: weighted RRF hybrid fusion (70% vector / 30% keyword)"
```

---

### Task 8: Enhanced Metadata Boosts

**Files:**
- Modify: `collector/src/indexing/chroma.service.ts` (applyRelevancyBoosts method, lines 539-581)

**Step 1: Replace applyRelevancyBoosts with enhanced version**

Replace the entire method:

```typescript
/**
 * Apply post-retrieval relevancy boosts:
 * - relevance_score from connector-specific scoring
 * - title match boost (widened)
 * - recency boost (widened)
 * - engagement boost (reactions, comments, thread depth)
 * - ownership boost (authored or assigned to user)
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

        // 2. Title match boost (widened from 1.3x to 1.4x)
        const title = ((result.metadata.title as string) || (result.metadata.subject as string) || '').toLowerCase();
        if (title) {
            if (title.includes(queryLower)) {
                boost *= 1.4;
            } else if (queryTerms.length > 0) {
                const titleMatchRatio = queryTerms.filter(t => title.includes(t)).length / queryTerms.length;
                if (titleMatchRatio > 0) {
                    boost *= 1 + titleMatchRatio * 0.25;
                }
            }
        }

        // 3. Recency boost (widened from 8% to 15%)
        const dateStr = (result.metadata.updatedAt || result.metadata.date || result.metadata.modifiedAt || result.metadata.timestamp) as string | undefined;
        if (dateStr) {
            const daysSince = Math.max(0, (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
            const halfLife = this.getRecencyHalfLife(result.source);
            const recencyScore = Math.pow(0.5, daysSince / halfLife);
            boost *= 1 + recencyScore * 0.15;
        }

        // 4. Engagement boost (up to 10%): reactions, comments, thread depth
        const engagementBoost = this.computeEngagementBoost(result);
        boost *= 1 + engagementBoost;

        // 5. Ownership boost (up to 12%): authored or assigned to user
        const isOwner = result.metadata.is_owner || result.metadata.is_organizer || result.metadata.is_author;
        const isAssigned = result.metadata.is_assigned_to_me;
        if (isOwner) boost *= 1.12;
        else if (isAssigned) boost *= 1.08;

        result.score = Math.min(1, result.score * boost);
    }
}

/**
 * Compute engagement boost based on source-specific signals.
 * Returns a value 0-0.10 (up to 10% boost).
 */
private computeEngagementBoost(result: SearchResult): number {
    const m = result.metadata;

    switch (result.source) {
        case 'slack': {
            const reactions = (m.reactionCount as number) || 0;
            const mentions = (m.mention_count as number) || 0;
            const isThread = !!m.threadTs;
            let engagement = 0;
            if (reactions > 0) engagement += Math.min(0.04, reactions * 0.01);
            if (mentions > 0) engagement += Math.min(0.03, mentions * 0.015);
            if (isThread) engagement += 0.02;
            return Math.min(0.10, engagement);
        }
        case 'jira': {
            const priority = (m.priority_weight as number) || 1;
            return Math.min(0.10, (priority - 1) * 0.02);
        }
        case 'gmail': {
            const threadDepth = (m.thread_depth as number) || 1;
            if (threadDepth > 3) return 0.06;
            if (threadDepth > 1) return 0.03;
            return 0;
        }
        case 'github': {
            // PR/issue with labels = more important
            const labels = m.labels as string;
            if (labels) {
                try {
                    const parsed = JSON.parse(labels);
                    if (Array.isArray(parsed) && parsed.length > 0) return 0.04;
                } catch { /* ignore */ }
            }
            return 0;
        }
        case 'confluence': {
            const labelCount = (m.label_count as number) || 0;
            return Math.min(0.06, labelCount * 0.02);
        }
        default:
            return 0;
    }
}
```

**Step 2: Verify build**

Run: `cd /Volumes/projects/personal-ai/collector && npx tsc --noEmit`

**Step 3: Commit**

```bash
cd /Volumes/projects/personal-ai
git add collector/src/indexing/chroma.service.ts
git commit -m "feat: enhance metadata boosts with engagement, ownership, wider ranges"
```

---

### Task 9: Cohere Cross-Encoder Re-ranking

**Files:**
- Modify: `collector/src/indexing/chroma.service.ts` (search method + new rerank method)

This is the highest-impact single change. Applied after all other scoring, it re-evaluates the top candidates using a cross-encoder that reads query + document together.

**Step 1: Add Cohere client initialization**

At the top of `chroma.service.ts`, add import:

```typescript
import { CohereClient } from 'cohere-ai';
```

Add a new property in the `ChromaService` class:

```typescript
private cohereClient: CohereClient | null = null;
```

In `onModuleInit()`, after the embedding function setup, add:

```typescript
const cohereApiKey = this.configService.get<string>('cohere.apiKey');
if (cohereApiKey) {
    this.cohereClient = new CohereClient({ token: cohereApiKey });
    this.logger.log('Cohere re-ranking client initialized');
} else {
    this.logger.warn('COHERE_API_KEY not set - search re-ranking disabled');
}
```

**Step 2: Add the rerank method**

Add to `ChromaService` class:

```typescript
/**
 * Re-rank search results using Cohere's cross-encoder model.
 * Cross-encoders jointly encode query + document for much higher accuracy
 * than bi-encoder similarity alone.
 *
 * Blends 80% rerank score + 20% original score to preserve
 * metadata boost signals while leveraging cross-encoder precision.
 */
private async rerankResults(
    query: string,
    results: SearchResult[],
    topN: number,
): Promise<SearchResult[]> {
    if (!this.cohereClient || results.length === 0) return results;

    // Only rerank top candidates (cost optimization)
    const candidateCount = Math.min(results.length, 50);
    const candidates = results.slice(0, candidateCount);
    const remainder = results.slice(candidateCount);

    try {
        const response = await this.cohereClient.v2.rerank({
            model: 'rerank-v3.5',
            query,
            documents: candidates.map(r => r.content.slice(0, 4096)),
            topN: Math.min(topN, candidateCount),
        });

        const reranked: SearchResult[] = response.results.map(rr => {
            const original = candidates[rr.index];
            return {
                ...original,
                // Blend: 80% rerank score + 20% original normalized score
                score: rr.relevanceScore * 0.8 + original.score * 0.2,
            };
        });

        // Sort reranked by blended score
        reranked.sort((a, b) => b.score - a.score);

        return [...reranked, ...remainder];
    } catch (error) {
        this.logger.warn(`Cohere rerank failed, using original ranking: ${(error as Error).message}`);
        return results;
    }
}
```

**Step 3: Integrate reranking into the search method**

In the `search()` method, after the `deduped.sort()` call (around line 354), add reranking before the final return:

```typescript
// Sort by score descending
deduped.sort((a, b) => b.score - a.score);

// Cross-encoder re-ranking for final precision
const reranked = await this.rerankResults(query, deduped, limit + offset);

return {
    results: reranked.slice(offset, offset + limit),
    total: reranked.length,
};
```

Remove the old return block that was there (the one using `deduped.slice`).

**Step 4: Verify build**

Run: `cd /Volumes/projects/personal-ai/collector && npx tsc --noEmit`

**Step 5: Commit**

```bash
cd /Volumes/projects/personal-ai
git add collector/src/indexing/chroma.service.ts
git commit -m "feat: add Cohere cross-encoder re-ranking for search precision"
```

---

### Task 10: Integration Verification

**Step 1: Build the full project**

Run: `cd /Volumes/projects/personal-ai/collector && npx tsc --noEmit`
Expected: No errors

**Step 2: Run tests**

Run: `cd /Volumes/projects/personal-ai/collector && npm test`
Expected: All existing tests pass (may need to update mocks for new constructor params)

**Step 3: Fix any test failures**

If tests fail due to the new Cohere dependency or changed method signatures, update mocks accordingly.

**Step 4: Final commit (if any test fixes needed)**

```bash
cd /Volumes/projects/personal-ai
git add collector/src/
git commit -m "fix: update tests for search quality overhaul changes"
```

---

## Post-Implementation: Re-indexing

After deploying these changes, trigger a full re-index to regenerate all embeddings with the new chunking and enrichment:

1. Clear all ChromaDB collections via the UI or API
2. Trigger full re-index for all sources: `POST /api/v1/index/all?fullReindex=true`
3. Monitor progress via the UI's indexing status page

The new embeddings will use:
- text-embedding-3-large (3072 dimensions)
- 512-token chunks (was ~800-1000 tokens)
- Contextual enrichment headers prepended to each chunk
