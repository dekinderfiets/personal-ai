# Collection Process: Research & Improvement Recommendations

> Research conducted on the collector pipeline — connectors, indexing service, storage,
> cursor management, Temporal workflows, and analytics.

---

## Executive Summary

The collector is a well-architected multi-source indexing system with 7 connectors,
dual storage (ChromaDB + filesystem), cursor-based incremental sync, and Temporal
workflow orchestration. After reviewing all ~6,600 lines of source code, the findings
below are organized by impact and effort.

Recent work has significantly improved the **search/retrieval** side: parallel source
queries, RRF-based hybrid search, chunk deduplication with multi-chunk boosting,
pre-computed embeddings, and post-retrieval relevancy boosts with source-specific
recency decay. The collection now uses cosine distance space explicitly. These are
solid improvements.

The remaining biggest wins fall into three themes:
1. **Data completeness** — several connectors drop valuable data that's available from the APIs
2. **Reliability** — inconsistent error handling and missing deletion tracking
3. **Efficiency** — conservative batch sizes and unnecessary re-indexing

---

## 1. Data Completeness Gaps

### 1.1 GitHub: Issue comments not fetched (Critical)

**File:** `connectors/github.connector.ts`

The GitHub connector fetches PR reviews and PR comments, but **issue comments are
never fetched**. The fetch logic checks `pull_request` to route PRs but has no
equivalent path for issue comments. This means the discussion on issues — often the
most valuable context — is missing from the index.

**Recommendation:** Add an `issueComments` phase that calls `GET /repos/{owner}/{repo}/issues/{number}/comments` for each issue, similar to how PR reviews/comments are fetched.

---

### 1.2 Gmail: Hard content truncation at 30KB

**File:** `connectors/gmail.connector.ts`

Email body content is truncated to 30,000 characters. Long email threads or emails
with inline content can lose significant information. The chunking layer in
ChromaService already handles large documents (splitting at 4,000 chars with 200
char overlap), so the connector-level truncation is redundant and harmful.

**Recommendation:** Remove the 30KB truncation and let the ChromaService chunking handle long content naturally.

---

### 1.3 Slack: Emoji reactions, file content, and bot messages dropped

**File:** `connectors/slack.connector.ts`

- **Emoji reactions** — Not captured at all. Reactions are a strong relevance signal
  (a message with many reactions is likely important).
- **Bot messages** — Completely skipped (`if (msg.subtype === 'bot_message')`).
  Many integrations (CI/CD notifications, automated alerts, deploy messages) post as
  bots and can be highly relevant.
- **File content** — Only the file name is captured, not the file contents or metadata
  like file type, size, or preview URL.
- **Message formatting** — Slack's mrkdwn (bold, code blocks, lists) is not preserved
  or converted.

**Recommendation:**
- Add reaction count and top reactions to metadata.
- Make bot message filtering configurable rather than a hard skip.
- Capture file metadata (name, type, size, permalink) for attached files.

---

### 1.4 Jira: Missing relationships, custom fields, and change history

**File:** `connectors/jira.connector.ts`

- **Issue links** (blocks, is blocked by, relates to, duplicates) — not captured.
  These are essential for understanding dependencies.
- **Custom fields** — Despite the API request including fields, only hardcoded fields
  are extracted. Story points, custom labels, and team fields are lost.
- **Change history / transitions** — Not captured. Knowing when an issue moved from
  "In Progress" to "Done" is valuable context.
- **Subtasks** — Not indexed as first-class documents with parent linkage.
- **Watchers and vote count** — Available from the API but not captured.

**Recommendation:** Start with issue links and subtask relationships as they improve
navigation and context. Custom fields can be made configurable via settings.

---

### 1.5 Calendar: Cancelled events skipped, recurring events not expanded

**File:** `connectors/calendar.connector.ts`

- **Cancelled events are silently skipped** (line 88). Cancellations should trigger
  deletion of previously indexed events — currently they don't, leaving stale data.
- **Recurring events** — The `is_recurring` field exists in the type but is hardcoded
  to `false`. Recurring events are not expanded into individual occurrences, so a
  weekly standup is indexed as a single event rather than individual occurrences.
- **Conference/meeting links** — Not captured (Zoom, Meet, Teams links).

**Recommendation:** Use cancelled events to trigger deletions. Consider expanding
recurring events within a configurable time window (e.g., next 4 weeks).

---

### 1.6 Confluence: Low capture of page metadata

**File:** `connectors/confluence.connector.ts`

- **Page views / popularity** — Available via the API but not captured.
- **Contributors** — Only the original creator is captured, not editors.
- **Inline comments** — Not fetched (only page-level comments).
- **Attachments** — Not indexed.
- **Cross-page links** — Not tracked beyond the ancestor hierarchy.

---

### 1.7 Drive: Missing file metadata and incomplete folder querying

**File:** `connectors/drive.connector.ts`

- **File size** — Available from the API but not stored in metadata.
- **Version history** — Not tracked; only the latest version is indexed.
- **Comments on files** — Not captured.
- **Sharing permissions** — Not stored as searchable metadata.
- **Nested folder traversal** — When `folderIds` are configured, only direct children
  of those folders are fetched (`'folderId' in parents`). Files in subfolders are
  missed. The recent addition of `folderPath` metadata (for sibling navigation) is
  useful, but a recursive folder traversal during fetch would capture the full tree.

---

## 2. Reliability & Error Handling

### 2.1 Inconsistent rate limit handling across connectors

Only the Slack connector implements proper rate limit handling with exponential
backoff and `retry-after` header support. All other connectors have no rate limiting:

| Connector   | Rate Limit Handling | Risk Level |
|-------------|-------------------|------------|
| Slack       | Exponential backoff + retry-after header | Low |
| Jira        | None | Medium |
| Gmail       | None (relies on Google API) | Medium |
| Drive       | None | High (file content fetching) |
| Confluence  | None | Medium |
| Calendar    | None | Low |
| GitHub      | None (basic batch delay only) | High |

**File:** `connectors/base.connector.ts`

**Recommendation:** Add a shared rate-limit-aware HTTP wrapper in the base connector
or as a utility service. It should:
- Read `Retry-After`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers
- Implement exponential backoff with jitter
- Be configurable per-source (different APIs have different limits)

---

### 2.2 No deletion tracking across any connector

**File:** `indexing/indexing.service.ts`

The system can detect new and changed documents via content hashing, but has **no
mechanism to detect deleted items** in any source. Deleted Jira issues, removed Slack
messages, trashed Drive files, etc. remain in the index indefinitely.

**Recommendation:** Implement a "tombstone" or "full reconciliation" mechanism:
- During full reindex: compare the set of IDs returned by the connector against the
  set of IDs in storage. Documents in storage but not returned by the connector should
  be marked for deletion.
- For sources with deletion events (Slack, Google APIs), handle deletion signals
  during incremental sync.

---

### 2.3 Stale syncToken handling is fragile

**File:** `indexing/indexing.service.ts`, lines 376-383

The current approach clears the syncToken only after 2 consecutive failures, then
attempts a final retry. If the stale token was the root cause, this works. But if the
underlying issue is a transient API error, clearing the token causes an unnecessary
full re-pagination from `lastSync`.

**Recommendation:** Differentiate between token-related errors (HTTP 410 Gone, invalid
page token) and transient errors (HTTP 500, timeouts). Only clear tokens on
token-specific errors.

---

### 2.4 ChromaDB failures are non-fatal but silent

**File:** `indexing/indexing.service.ts`, line 182

ChromaDB upsert failures are caught and logged as warnings, but the file save
proceeds and the document hash is updated. This means if ChromaDB is down, documents
are marked as "already indexed" in Redis but are not searchable. A subsequent
incremental sync will skip these documents because the hash hasn't changed.

**Recommendation:** Track ChromaDB upsert success separately. Either:
- Don't update the hash when ChromaDB fails (so the document is retried next sync), or
- Maintain a separate "pending ChromaDB sync" queue.

---

### 2.5 Legacy fallback analytics misreport new vs updated documents

**File:** `indexing/indexing.service.ts`, lines 316-323

In the legacy indexing path, `documentsNew` is set to `totalIndexed` and
`documentsUpdated` is always `0`. The system doesn't distinguish between new and
updated documents. The same issue exists in the Temporal workflow path
(`temporal/workflows.ts`, lines 97-99).

**Recommendation:** The `filterChangedDocuments` method already knows which documents
are new (no existing hash) vs updated (hash differs). Return this breakdown from
`processIndexingBatch`.

---

## 3. Performance & Efficiency

### 3.1 Conservative batch/page sizes

Several connectors use unnecessarily small page sizes:

| Connector   | Page Size | Recommended | Location |
|-------------|----------|------------|----------|
| Confluence  | 25       | 50-100     | `confluence.connector.ts:27` |
| Jira        | 50       | 100        | `jira.connector.ts:49` |
| Gmail       | 50       | 100        | `gmail.connector.ts:137` |
| Drive       | 50       | 100        | `drive.connector.ts:78` |

Larger page sizes reduce the number of API round-trips and overall indexing time.

---

### 3.2 GitHub file indexing always re-indexes all files

**File:** `connectors/github.connector.ts`

The file indexing phase fetches and indexes files from repositories, but there's no
incremental tracking for file changes. Every indexing run re-fetches the entire file
tree and all file contents, regardless of whether files have changed. While the
hash-based dedup at the indexing service level prevents redundant storage, the API
calls and content downloads are wasted.

**Recommendation:** Use the Git tree SHA or individual blob SHAs to skip files that
haven't changed since the last sync. The `fileSha` field already exists in the type
definition but isn't used for change detection.

---

### 3.3 Delay strategy between batches is simplistic

**File:** `indexing/indexing.service.ts`, lines 394-397 and `temporal/workflows.ts`, lines 82-86

The delay between batches is `2000ms` every 500 documents and `500ms` otherwise.
This doesn't account for:
- Different rate limits per source (GitHub allows 5,000 requests/hour; Google APIs
  have per-second quotas)
- Whether the previous request was close to rate limits (available via response headers)
- The size of the batch (a batch of 5 documents needs less cooldown than 100)

**Recommendation:** Make the delay configurable per-source and/or adaptive based on
rate limit headers.

---

### 3.4 Drive content extraction depends on external tools

**File:** `connectors/drive.connector.ts`

PDF extraction requires `pdftotext` and Office document extraction requires `pandoc`.
These are external system dependencies that:
- May not be installed in all environments
- Create temporary files that may not be cleaned up on crash
- Add deployment complexity

**Recommendation:** Consider using Node.js libraries (e.g., `pdf-parse` for PDFs,
`mammoth` for docx) to reduce external dependencies. Alternatively, document the
required system packages in the Dockerfile and add health checks for these tools.

---

### 3.5 Redundant file saves for unchanged documents

**File:** `indexing/indexing.service.ts`, line 180

The `FileSaverService.saveDocuments` is called for every batch of changed documents.
Since the filesystem write happens alongside the ChromaDB upsert in a `Promise.all`,
the file is rewritten even if only ChromaDB indexing was needed. For documents where
only the relevance weights changed (but the content didn't), this creates unnecessary
I/O.

---

## 4. Incremental Sync Issues

### 4.1 Jira timestamp precision loss

**File:** `connectors/jira.connector.ts`

The `lastSync` value is sliced to 16 characters (line 94), truncating the seconds
and milliseconds from the ISO datetime. If multiple issues are updated within the
same minute, some may be missed on the next incremental sync.

**Recommendation:** Use full ISO datetime precision for the JQL filter.

---

### 4.2 Slack multi-channel sync state can lose progress

**File:** `connectors/slack.connector.ts`

The Slack connector maintains a complex JSON state tracking progress across multiple
channels. If the sync is interrupted mid-channel (crash, timeout, network error), the
`oldest` timestamp won't be updated for the current channel. The next sync will
re-process messages from the previous checkpoint.

This isn't data-loss (duplicates are filtered by hashing), but it wastes API calls
and time.

**Recommendation:** Save per-channel progress to the cursor after each channel
completes, not just at the end of the full sync cycle.

---

### 4.3 Config change triggers full reindex without collection cleanup

**File:** `indexing/indexing.service.ts`, lines 305-307

When the source configuration changes (e.g., different Jira project keys), the system
triggers a full reindex. However, it doesn't clean up documents from the old
configuration. If you switch from indexing Project A to Project B, all of Project A's
documents remain in the index.

**Recommendation:** On config change, either:
- Delete the old collection and reindex from scratch, or
- Track which config produced each document and delete documents from the old config.

---

### 4.4 Confluence cycle detection resets progress

**File:** `connectors/confluence.connector.ts`

The Confluence connector tracks `seenPageIds` to detect API pagination cycles (where
the API returns the same pages repeatedly). When a cycle is detected, the `seenPageIds`
set is cleared, but this can cause previously processed pages to be re-fetched in the
same sync run.

---

## 5. Content Quality

### 5.1 HTML-to-text conversion loses structure

**Files:** `connectors/jira.connector.ts`, `connectors/confluence.connector.ts`

The `html-to-text` library is configured with `wordwrap: 130`, which wraps long lines
but doesn't preserve:
- Code blocks (important for Jira issues with stack traces or code snippets)
- Table structure
- Heading hierarchy
- List nesting

This impacts search quality because structural information is lost.

**Recommendation:** Configure `html-to-text` to preserve code blocks and tables,
or use a markdown conversion approach that retains structure for better embedding
quality.

---

### 5.2 Chunking doesn't respect content boundaries

**File:** `indexing/chroma.service.ts`, lines 80-93

The chunking algorithm splits content at fixed character positions (4,000 chars with
200 overlap). It doesn't respect:
- Sentence boundaries
- Paragraph boundaries
- Code block boundaries
- Heading/section boundaries

This can split a sentence across two chunks, reducing both search accuracy and
retrieval quality. The recent addition of multi-chunk boosting in search (where
documents with multiple matching chunks get score boosts) makes this even more
impactful — better chunk boundaries would produce more semantically meaningful chunks
and more accurate multi-chunk boosting signals.

**Recommendation:** Implement boundary-aware chunking that prefers splitting at
paragraph breaks (`\n\n`), then sentence boundaries (`. `), then word boundaries.
The GitHub connector already has a `ChunkingService` for code files — generalize this
for all content types.

---

### 5.3 Embedding model is fixed to `text-embedding-3-small`

**File:** `indexing/chroma.service.ts`, line 17

The embedding model is hardcoded as the default parameter to `OpenAIEmbedder`. The
constructor already accepts a model parameter, so making it configurable is trivial.
`text-embedding-3-large` (3072 dimensions) may produce better search results for the
diverse content types in this system, though at higher cost per embedding.

**Recommendation:** Make the embedding model configurable via an `OPENAI_EMBEDDING_MODEL`
environment variable, defaulting to `text-embedding-3-small`.

---

## 6. Architecture & Code Quality

### 6.1 Multiple Redis connections

**Files:** `cursor.service.ts`, `analytics.service.ts`, `settings.service.ts`

Each service creates its own Redis connection independently. With 3 services, that's
3 separate connections to Redis, each initialized in `onModuleInit`.

**Recommendation:** Create a shared Redis provider module that manages a single
connection pool and inject it into all services.

---

### 6.2 `isCurrentUser` uses Jira email as fallback for Google services

**File:** `indexing/indexing.service.ts`, lines 519-527

For Drive, Calendar, and Gmail, the `isCurrentUser` check compares against the
Atlassian/Jira email address. This is a fragile coupling — the user may have
different emails for Jira and Google.

**Recommendation:** Add a dedicated `GOOGLE_USER_EMAIL` environment variable for
Google service comparisons.

---

### 6.3 `isInternalEmail` uses a hardcoded public domain list

**File:** `indexing/indexing.service.ts`, lines 530-536

The internal email detection checks against 5 hardcoded public domains
(`gmail.com`, `yahoo.com`, `hotmail.com`, `outlook.com`, `aol.com`). This misses
many public providers and doesn't account for the user's actual company domain.

**Recommendation:** Make the company domain(s) configurable. An email is "internal"
if it matches the configured company domain, not if it doesn't match a public domain
list.

---

### 6.4 File deletion TODO in controller

**File:** `controllers/index.controller.ts`, line 62

There's an existing TODO: `// TODO: Implement file deletion for entire source directory if needed`.
When resetting a collection via `DELETE /index/:source`, the cursor is cleared but
the saved markdown files in `./data/{source}/` are not deleted. ChromaDB collection
deletion is also not triggered.

**Recommendation:** Implement full cleanup: delete filesystem directory, delete
ChromaDB collection, clear Redis hashes.

---

## 7. Observability & Analytics

### 7.1 No per-document error tracking

**File:** `indexing/analytics.service.ts`

Analytics track per-run success/failure, but don't track individual document failures.
If 1 out of 100 documents fails consistently, there's no way to identify it without
reading logs.

**Recommendation:** Add a failed document queue or counter per source that tracks
document IDs that consistently fail processing.

---

### 7.2 No metrics for API usage or rate limit proximity

The system doesn't track how many API calls are made per source per run, or how close
the system is to rate limits. This makes it hard to tune batch sizes and delays.

**Recommendation:** Add API call counters and rate limit headroom metrics to the
analytics pipeline.

---

## 8. Collection-Search Alignment Opportunities

The recent search improvements create new opportunities on the collection side:

### 8.1 Relevancy boosts depend on metadata quality

The new `applyRelevancyBoosts` in search uses `relevance_score`, `title`/`subject`,
and date fields. The effectiveness of these boosts is limited by the metadata quality
at collection time:

- **Slack messages have no title** — the title field is set to a truncated message
  preview. A better approach would be to extract a topic or use the channel name +
  timestamp as a structured title, improving title-match boosting.
- **Gmail `thread_depth`** is hardcoded to `1` (`indexing.service.ts:125`). The
  actual thread depth (number of messages in the thread) is available from the Gmail
  API and would improve the relevance scoring for email threads.
- **Calendar events** don't store `updatedAt` consistently, which means the recency
  boost (`getRecencyHalfLife` returns 14 days for calendar) uses the `start` field
  instead. This means past events get penalized even if they were recently modified.

### 8.2 Source-specific `search_context` field is never populated

All document types include an optional `search_context` field in their metadata, but
no connector populates it. This field could contain a pre-built context string
optimized for embedding quality — e.g., combining the title, key metadata, and a
summary — which would produce better vector search results than embedding raw content
alone.

---

## Priority Matrix

| Improvement | Impact | Effort | Priority |
|------------|--------|--------|----------|
| GitHub issue comments | High | Low | **P0** |
| Deletion tracking | High | Medium | **P0** |
| Shared rate limit handling | High | Medium | **P1** |
| ChromaDB failure recovery | High | Low | **P1** |
| Remove Gmail 30KB truncation | Medium | Trivial | **P1** |
| Boundary-aware chunking | Medium | Medium | **P1** |
| Config change cleanup | Medium | Low | **P1** |
| Full collection deletion | Medium | Low | **P1** |
| Increase batch sizes | Medium | Trivial | **P2** |
| Jira issue links & subtasks | Medium | Low | **P2** |
| Calendar deletion + recurring events | Medium | Medium | **P2** |
| Slack reactions & bot messages | Low | Low | **P2** |
| Shared Redis connection pool | Low | Low | **P2** |
| HTML-to-text improvements | Medium | Medium | **P2** |
| Configurable embedding model | Low | Trivial | **P3** |
| Per-document error tracking | Low | Low | **P3** |
| Drive: native PDF/Office parsing | Low | Medium | **P3** |
| Configurable company domain | Low | Trivial | **P3** |
| `isCurrentUser` Google email fix | Low | Trivial | **P3** |
| New/updated doc analytics | Low | Low | **P3** |
| GitHub file change detection via SHA | Medium | Medium | **P3** |
| Adaptive per-source delays | Low | Medium | **P3** |
| Populate `search_context` field | Medium | Medium | **P2** |
| Drive recursive folder traversal | Medium | Low | **P2** |
| Fix Gmail `thread_depth` (hardcoded to 1) | Low | Trivial | **P3** |
| Improve Slack message titles for search boosting | Low | Low | **P3** |
