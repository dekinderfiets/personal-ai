# Search Quality Overhaul Design

## Problem
Semantic and hybrid search results have poor precision, recall, and ranking across all query types (semantic, exact term, cross-source).

## Approach: Comprehensive Retrieval Overhaul (Approach A)

Targets every layer of the search pipeline: embedding model, chunking, contextual enrichment, keyword scoring, fusion weights, metadata boosts, and cross-encoder re-ranking.

## Changes

### 1. Embedding Model Upgrade
- Switch from `text-embedding-3-small` (1536 dims) to `text-embedding-3-large` (3072 dims)
- ~4% MTEB improvement, compounds with other changes
- Requires full re-index

### 2. Token-Based Chunking
- Install `tiktoken` for accurate OpenAI token counting
- Chunks: 512 tokens, overlap: 64 tokens (down from 4000 chars / 200 char overlap)
- Trigger chunking when content exceeds ~600 tokens
- Keep smart boundary detection (paragraph > line > sentence > word)
- ChunkingService for code files also adopts token-based sizing
- Expected: +15-25% recall improvement

### 3. Contextual Chunk Enrichment
- Before embedding, prepend context header with title, source, date, and source-specific fields
- Stored content remains original chunk (for display)
- Enriched text used only for embedding generation
- Source-specific templates for all 7 connectors
- Expected: +35-49% reduction in retrieval failures (per Anthropic's contextual retrieval research)

### 4. Cross-Encoder Re-ranking (Cohere)
- Add Cohere Rerank API (`rerank-v3.5`) as post-retrieval step
- Re-rank top ~50 candidates after initial retrieval
- Blend: 80% rerank score + 20% original score
- Applied for all search types
- Expected: +18-48% NDCG@10 improvement
- Cost: ~$6-10/month

### 5. Weighted RRF
- Change hybrid fusion from equal weighting to 70% vector / 30% keyword
- Keep k=60
- Expected: +5-10% for semantic queries

### 6. Improved Keyword Scoring (BM25-like)
- Add IDF component via collection-level document frequency stats
- BM25-like scoring: TF saturation + IDF + length normalization
- Replaces current raw $contains + TF-only scoring
- Expected: +10-15% keyword query improvement

### 7. Query Preprocessing
- Normalize whitespace, trim
- Better tokenization for keyword/hybrid (handle hyphens, camelCase)
- Split compound terms

### 8. Enhanced Metadata Boosts
- Engagement boost (up to 10%): reactions, comments, thread depth
- Ownership boost (up to 12%): authored/assigned to user
- Widen recency boost from max 8% to max 15%
- Widen title match from 1.3x to 1.4x exact match

### 9. Re-indexing
- Full re-index required (new model + enriched content)
- Clear all ChromaDB collections and rebuild

## Architecture Flow (After)

```
Query → Normalize → [Vector Search + Keyword Search (BM25-like)]
                              ↓
                     Weighted RRF Fusion (70/30)
                              ↓
                     Chunk Dedup + Multi-chunk Boost
                              ↓
                     Metadata Boosts (relevance, title, recency, engagement, ownership)
                              ↓
                     Cohere Cross-Encoder Re-rank (top 50)
                              ↓
                     Final Results (paginated)
```

## Files Modified
- `chroma.service.ts` - chunking, enrichment, scoring, re-ranking, keyword IDF
- `chunking.service.ts` - token-based sizing
- `indexing.service.ts` - enhanced relevance weights
- `config.ts` - new config keys
- `.env` - add COHERE_API_KEY
- `package.json` - add tiktoken, cohere-ai dependencies

## Expected Combined Impact
~60-80% better retrieval quality across all query types.
