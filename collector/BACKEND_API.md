# Collector Backend API Inventory

Base URL: `http://localhost:8087/api/v1`

Authentication: `X-API-Key` header (validated by `ApiKeyGuard`). If `APP_API_KEY` env var is not set, all requests are allowed.

Valid sources: `jira | slack | gmail | drive | confluence | calendar`

---

## 1. Root Controller (`/`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Returns service info and available endpoint groups |

**Response:**
```json
{
  "service": "collector",
  "version": "1.0.0",
  "endpoints": {
    "health": "/api/v1/health",
    "index": "/api/v1/index",
    "search": "/api/v1/search",
    "analytics": "/api/v1/analytics",
    "events": "/api/v1/events",
    "workflows": "/api/v1/workflows"
  }
}
```

---

## 2. Health Controller (`/health`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | System health check (Redis, ChromaDB, Temporal) |

**Response:**
```json
{
  "status": "ok" | "partial",
  "service": "index-service",
  "timestamp": "ISO string",
  "dependencies": {
    "redis": "up" | "down",
    "chroma": "up" | "down",
    "temporal": "up" | "down"
  }
}
```

---

## 3. Search Controller (`/search`)

### 3.1 POST `/search` — Full-text / vector / hybrid search

**Auth:** Yes (ApiKeyGuard)

**Request Body** (`SearchRequest`):
```typescript
{
  query: string;                           // Required search query
  sources?: DataSource[];                  // Filter by sources (default: all 7)
  searchType?: 'vector' | 'keyword' | 'hybrid'; // Default: 'vector'
  limit?: number;                          // Default: 20
  offset?: number;                         // Default: 0
  where?: Record<string, unknown>;         // ChromaDB metadata filter
  startDate?: string;                      // ISO date string (filters by createdAtTs >= start of day)
  endDate?: string;                        // ISO date string (filters by createdAtTs <= end of day)
}
```

**Response:**
```typescript
{
  results: SearchResult[];
  total: number;
}
```

**SearchResult shape:**
```typescript
{
  id: string;          // ChromaDB document ID
  source: DataSource;
  content: string;     // Document text content
  metadata: Record<string, unknown>;  // All indexed metadata
  score: number;       // 0-1 relevance score
}
```

**Search internals:**
- **Vector search**: OpenAI embeddings (text-embedding-3-small), cosine similarity
- **Keyword search**: Multi-term `$contains` matching with TF-based scoring
- **Hybrid search**: Reciprocal Rank Fusion (RRF) combining vector + keyword results
- Post-retrieval boosts: connector relevance_score, title match, recency decay (per-source half-life)
- Chunk deduplication: keeps best chunk per parent document, boosts multi-chunk matches


## 4. Index Controller (`/index`)

### 4.1 Indexing Operations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/index/all` | Yes | Trigger indexing for all sources (via Temporal `collectAllWorkflow`) |
| POST | `/index/migrate-timestamps` | Yes | Back-fill numeric timestamps on existing docs |
| POST | `/index/:source` | Yes | Trigger indexing for a single source (via Temporal `indexSourceWorkflow`) |
| GET | `/index/status` | Yes | Get indexing status for all sources |
| GET | `/index/:source/status` | Yes | Get indexing status for one source |

**POST `/index/all` Request Body** (`IndexRequest`, optional):
```typescript
{
  fullReindex?: boolean;
  projectKeys?: string[];    // Jira
  channelIds?: string[];     // Slack
  spaceKeys?: string[];      // Confluence
  folderIds?: string[];      // Drive
  gmailSettings?: { domains: string[]; senders: string[]; labels: string[] };
  calendarIds?: string[];    // Calendar
}
```

**POST `/index/all` Response:**
```typescript
{ started: DataSource[]; skipped: DataSource[] }
```

**POST `/index/:source` Response** (`IndexResponse`):
```typescript
{ status: 'started' | 'already_running'; source: DataSource; message?: string }
```

**GET status Response** (`IndexStatus`):
```typescript
{
  source: DataSource;
  status: 'idle' | 'running' | 'completed' | 'error';
  lastSync: string | null;
  documentsIndexed: number;
  error?: string;
  lastError?: string;
  lastErrorAt?: string;
}
```

### 4.2 Delete / Reset Operations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| DELETE | `/index/all/reset` | Yes | Reset cursor and status for ALL sources |
| DELETE | `/index/:source` | Yes | Reset cursor for a single source (TODO: file deletion) |
| DELETE | `/index/:source/status` | Yes | Reset status & lock only (preserves cursor) |
| DELETE | `/index/:source/:id` | Yes | **Delete a single document** by source + document ID |

**DELETE `/index/:source/:id`** — Deletes from:
1. FileSaverService (markdown file on disk)
2. ChromaDB (vector embeddings + chunks)
3. Redis (document content hashes)

**Response:** `{ message: string }`

### 4.3 Settings Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/index/settings/:source` | Yes | Get connector settings |
| POST | `/index/settings/:source` | Yes | Save connector settings |

**Settings types per source:**
```typescript
DriveSettings     { folderIds: string[] }
GmailSettings     { domains: string[]; senders: string[]; labels: string[] }
SlackSettings     { channelIds: string[] }
JiraSettings      { projectKeys: string[] }
ConfluenceSettings { spaceKeys: string[] }
CalendarSettings  { calendarIds: string[] }
```

### 4.4 Discovery Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/index/discovery/jira/projects` | Yes | List available Jira projects |
| GET | `/index/discovery/slack/channels` | Yes | List available Slack channels |
| GET | `/index/discovery/drive/folders?parentId=` | Yes | List Drive folders (optional parent) |
| GET | `/index/discovery/confluence/spaces` | Yes | List Confluence spaces |
| GET | `/index/discovery/calendar` | Yes | List Google calendars |
| GET | `/index/discovery/gmail/labels` | Yes | List Gmail labels |

---

## 5. Analytics Controller (`/analytics`)

### 5.1 Stats Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/analytics/stats` | Yes | System-wide aggregate stats |
| GET | `/analytics/stats/:source` | Yes | Per-source aggregate stats |

**SystemStats:**
```typescript
{
  sources: SourceStats[];
  totalDocumentsAcrossAllSources: number;
  totalRunsAcrossAllSources: number;
  recentRuns: IndexingRun[];
}
```

**SourceStats:**
```typescript
{
  source: DataSource;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  averageDurationMs: number;
  totalDocumentsProcessed: number;
}
```

### 5.2 Run History

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/analytics/runs?limit=20` | Yes | Recent indexing runs across all sources |
| GET | `/analytics/runs/:source?limit=20` | Yes | Recent runs for a specific source |
| GET | `/analytics/daily/:source?days=30` | Yes | Daily stats for a source |

**IndexingRun:**
```typescript
{
  id: string;
  source: DataSource;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'error';
  documentsProcessed: number;
  documentsNew: number;
  documentsUpdated: number;
  documentsSkipped: number;
  error?: string;
  durationMs?: number;
}
```

**Daily Stats Response:**
```typescript
{ date: string; runs: number; documents: number; errors: number }[]
```

### 5.3 Connector Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/analytics/health` | Yes | Check all connector health |
| GET | `/analytics/health/:source` | Yes | Check single connector health |

**ConnectorHealth:**
```typescript
{
  source: DataSource;
  configured: boolean;
  connected: boolean;
  authenticated: boolean;
  latencyMs: number | null;
  error?: string;
  checkedAt: string;
}
```

### 5.4 Config Export / Import

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/analytics/config/export` | Yes | Download all settings as JSON file |
| POST | `/analytics/config/import` | Yes | Import settings from JSON |

**Import Request Body:**
```typescript
{ settings: Record<DataSource, SourceSettings> }
```

**Import Response:**
```typescript
{ imported: string[]; skipped: string[] }
```

---

## 6. Events Controller (`/events`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| SSE | `/events/indexing?interval=2000` | Yes | Server-Sent Events for real-time indexing status |

**SSE Event Data:**
```json
{
  "type": "status_update",
  "statuses": IndexStatus[],
  "timestamp": "ISO string"
}
```

Poll interval: configurable via `interval` query param (minimum 1000ms, default 2000ms).

---

## 7. Workflows Controller (`/workflows`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/workflows/recent?limit=20` | Yes | List recent Temporal workflows |
| GET | `/workflows/:workflowId` | Yes | Get specific workflow status |
| DELETE | `/workflows/:workflowId` | Yes | Cancel a workflow and reset source status |

**WorkflowInfo:**
```typescript
{
  workflowId: string;
  runId: string;
  type: string;
  status: 'UNSPECIFIED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TERMINATED' | 'CONTINUED_AS_NEW' | 'TIMED_OUT';
  startTime: string;
  closeTime?: string;
  executionTime?: number;
}
```

---

## 8. ChromaDB Service — Internal Capabilities

These methods are available on `ChromaService` but **NOT exposed as REST endpoints** (internal use only):

| Method | Description |
|--------|-------------|
| `upsertDocuments(source, documents)` | Upsert documents with content-hash diffing (skip re-embedding unchanged content) |
| `search(query, options)` | Full search with vector/keyword/hybrid + filters |
| `getDocument(source, documentId)` | Get a single document by ID (scans all sources if needed) |
| `getDocumentsByMetadata(source, where, limit)` | Query documents by arbitrary metadata filter |
| `deleteDocument(source, documentId)` | Delete document + all its chunks |
| `deleteCollection(source)` | Delete entire ChromaDB collection for a source |
| `migrateTimestamps(source)` | Back-fill numeric timestamp fields |

### ChromaDB Collections

One collection per source, named `collector_{source}` (e.g., `collector_jira`, `collector_slack`).

### Document Metadata Fields (common across sources)

All documents include:
- `source` — connector name
- `type` — document subtype (varies by source)
- `title` — display title
- `createdAt` / `updatedAt` — ISO timestamp strings
- `createdAtTs` / `updatedAtTs` — numeric Unix timestamps (for range queries)
- `url` — link back to original source
- `relevance_score` — connector-specific relevance (0-1)
- `_contentHash` — SHA256 hash for change detection
- `search_context` — enriched search text

**Chunk-specific fields** (when content > 8000 chars):
- `parentDocId` — ID of the parent (non-chunked) document
- `chunkIndex` — 0-based index within the parent
- `totalChunks` — total number of chunks for the parent

### Chunking Strategy

- Content > 8000 chars is split into ~4000 char chunks with 200 char overlap
- Boundary detection: paragraph breaks > line breaks > sentence boundaries > word boundaries

---

## 9. Key Observations for Documents Page

### Existing Document Management Capabilities

1. **Single document delete**: `DELETE /index/:source/:id` — already exists, deletes from files + ChromaDB + Redis hashes
2. **Document retrieval by ID**: `ChromaService.getDocument()` — internal only, not exposed as REST
3. **Document listing by metadata**: `ChromaService.getDocumentsByMetadata()` — internal only, not exposed as REST
4. **Collection delete**: `ChromaService.deleteCollection()` — internal only, not exposed as REST
5. **Bulk reset**: `DELETE /index/all/reset` — resets cursors/status only, does not delete documents from ChromaDB

### Missing Endpoints Needed for Documents Page

1. **GET `/search/documents`** or similar — List/browse documents with pagination (without search query)
2. **GET `/search/documents/:id`** — Get single document by ID (expose `ChromaService.getDocument`)
3. **DELETE `/index/:source` bulk document delete** — Currently only resets cursor, does not delete ChromaDB data
4. **GET collection stats** — Document counts per source from ChromaDB (for dashboard/overview)
5. **Bulk delete** — Delete multiple documents by IDs in one request

### Source-Specific Metadata Fields

| Source | Key Metadata |
|--------|-------------|
| **Jira** | project, issueType, status, priority, assignee, reporter, labels, sprint |
| **Slack** | channel, channelId, author, threadTs, reactionCount, channel_type |
| **Gmail** | subject, from, to, cc, labels, threadId, date |
| **Drive** | name, mimeType, path, folderPath, owner, modifiedAt |
| **Confluence** | space, spaceName, author, labels, ancestors, type (page/blogpost/comment) |
| **Calendar** | summary, location, start, end, attendees, organizer, status |
