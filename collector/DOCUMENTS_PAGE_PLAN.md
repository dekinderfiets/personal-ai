# Documents Page Implementation Plan

## Overview

Create a new **Documents** page that merges all existing Search functionality with document management capabilities (browse, delete single/bulk, filter by metadata). The old Search page becomes the Documents page. The Explore page remains separate (detail/navigation view).

---

## Phase 1: Backend Changes

### 1.1 Add new endpoints to SearchController

Add these endpoints to `collector/src/controllers/search.controller.ts`:

**a) `GET /search/documents` — Browse/list documents without requiring a search query**
- Query params: `sources` (comma-separated), `limit` (default 20), `offset` (default 0), `where` (JSON string for metadata filters), `startDate`, `endDate`
- Uses `ChromaService.getDocumentsByMetadata()` internally but enhanced to support pagination and date filtering
- When no filters are provided, lists recent documents across all sources

**b) `GET /search/documents/:id` — Get a single document by ID**
- Exposes `ChromaService.getDocument()`
- Scans all sources to find the document (same as navigate does internally)

**c) `POST /search/documents/delete` — Bulk delete documents**
- Request body: `{ ids: Array<{ source: DataSource, id: string }> }`
- Calls `IndexingService.deleteDocument()` for each
- Returns: `{ deleted: number, errors: Array<{ id: string, error: string }> }`

**d) `GET /search/documents/stats` — Get document counts per source**
- Returns count per source from ChromaDB collections
- Response: `{ sources: Array<{ source: DataSource, count: number }>, total: number }`

### 1.2 Enhance ChromaService

**a) Add `countDocuments(source)` method**
- Uses ChromaDB `collection.count()` to get total document count

**b) Add `listDocuments(source, options)` method**
- Options: `{ limit, offset, where?, startDate?, endDate? }`
- Uses `collection.get()` with metadata filters and pagination
- Sorts by `updatedAtTs` descending (most recent first)

### 1.3 Types

Add to `collector/src/types.ts`:
```ts
interface BulkDeleteRequest {
  ids: Array<{ source: DataSource; id: string }>;
}

interface BulkDeleteResponse {
  deleted: number;
  errors: Array<{ id: string; error: string }>;
}

interface DocumentStats {
  sources: Array<{ source: DataSource; count: number }>;
  total: number;
}
```

---

## Phase 2: Frontend — Documents Page

### 2.1 Create `collector/ui/src/pages/Documents.tsx`

This page starts as a copy of Search.tsx and is extended with management features. Key sections:

#### Header Section
- Title: "Documents" with subtitle showing total document count
- Refresh button to reload stats

#### Stats Bar (new)
- Small summary cards showing document count per source (color-coded chips)
- Total documents count
- Fetched from `GET /search/documents/stats` on mount

#### Search & Filter Section (preserved from Search.tsx — ALL features kept)
- Search bar with text input, clear button, search button, enter key
- Search mode toggle (Semantic / Keyword / Hybrid)
- Source filter chips (all 7 sources)
- Date range filter (from/to)
- Advanced filters collapse (author, document type, results per page slider)
- Clear all filters button

#### Selection & Bulk Actions Bar (new)
- Appears when documents are selected
- Shows count: "X documents selected"
- "Select all on this page" / "Deselect all" toggle
- **Delete selected** button (with confirmation dialog)
- "Select all matching" button — selects all docs matching current search/filters (shows total count from API)

#### Results Section (preserved + enhanced)
- **Checkbox** on each result card for selection (new)
- Source accent bar, source chip, title (clickable to explore), action buttons
- Open original link, explore context button
- **Delete button** per document (new, with confirmation)
- Relevance score (when search is active)
- Date display
- Content snippet (400 chars, frontmatter stripped, 3-line clamp)
- Metadata chips
- Hover effects

#### Browse Mode (new)
- When no search query entered, show "Browse" mode
- Lists recent documents from `GET /search/documents`
- Same result card layout but without relevance scores
- Source filter chips still work in browse mode

#### Sort Controls (preserved)
- Relevance (only when search is active), Date, Source

#### Pagination (preserved)
- Same MUI Pagination component with first/last buttons

#### Delete Confirmation Dialog (new)
- MUI Dialog confirming deletion
- Shows count of documents to delete
- Warning text: "This action cannot be undone"
- Cancel / Delete buttons

### 2.2 Update types/api.ts

Add new types:
```ts
interface DocumentStats {
  sources: Array<{ source: DataSource; count: number }>;
  total: number;
}

interface BulkDeleteRequest {
  ids: Array<{ source: DataSource; id: string }>;
}
```

### 2.3 Update App.tsx

1. Replace Search import with Documents import
2. Update `NAV_ITEMS`:
   - Replace `{ path: '/search', label: 'Search', icon: <SearchOutlinedIcon /> }` with `{ path: '/documents', label: 'Documents', icon: <DescriptionOutlinedIcon /> }`
   - Remove the Explore nav item (keep the route, it's accessed from Documents results)
3. Update routes:
   - Replace `/search` route with `/documents`
   - Add redirect from `/search` to `/documents` for bookmarks
4. Keep `/explore` and `/explore/:documentId` routes unchanged

### 2.4 Update Explore.tsx

- Change "Back to Search" link to "Back to Documents"
- Update navigation link from `/search` to `/documents`

---

## Phase 3: Implementation Details

### State Management (Documents.tsx)

```ts
// Existing search state (preserved)
const [query, setQuery] = useState('');
const [results, setResults] = useState<SearchResult[]>([]);
const [total, setTotal] = useState(0);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
const [searchType, setSearchType] = useState<'vector' | 'keyword' | 'hybrid'>('vector');
const [selectedSources, setSelectedSources] = useState<DataSource[]>([]);
const [startDate, setStartDate] = useState('');
const [endDate, setEndDate] = useState('');
const [author, setAuthor] = useState('');
const [docType, setDocType] = useState('');
const [limit, setLimit] = useState(20);
const [page, setPage] = useState(1);
const [sortMode, setSortMode] = useState<'relevance' | 'date' | 'source'>('relevance');
const [hasSearched, setHasSearched] = useState(false);
const [showAdvanced, setShowAdvanced] = useState(false);

// New management state
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [stats, setStats] = useState<DocumentStats | null>(null);
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
const [deleteTarget, setDeleteTarget] = useState<'selected' | { source: DataSource; id: string } | null>(null);
const [deleting, setDeleting] = useState(false);
```

### API Calls

```ts
// Browse documents (no query)
const browseDocuments = async () => { ... fetch GET /search/documents ... };

// Search (existing, preserved)
const handleSearch = async () => { ... fetch POST /search ... };

// Load stats
const loadStats = async () => { ... fetch GET /search/documents/stats ... };

// Delete single document
const handleDeleteDocument = async (source: DataSource, id: string) => { ... fetch DELETE /index/:source/:id ... };

// Bulk delete
const handleBulkDelete = async () => { ... fetch POST /search/documents/delete ... };
```

### Behavior Notes

1. **Initial load**: Fetch stats + browse recent documents (no search query needed)
2. **Search**: When user types query and hits search, use POST /search (existing behavior)
3. **Browse**: When query is empty but filters are set, use GET /search/documents with filters
4. **Selection**: Checkbox per card, "select all on page" in action bar
5. **Delete single**: Trash icon on each card → confirmation dialog → DELETE /index/:source/:id
6. **Bulk delete**: Select multiple → "Delete selected" button → confirmation dialog → POST /search/documents/delete
7. **After delete**: Refresh current view (re-run search or browse), update stats

---

## File Changes Summary

| File | Action |
|------|--------|
| `collector/src/controllers/search.controller.ts` | Add 4 new endpoints |
| `collector/src/indexing/chroma.service.ts` | Add `countDocuments()`, `listDocuments()` methods |
| `collector/src/types.ts` | Add new interfaces |
| `collector/ui/src/pages/Documents.tsx` | **New file** — based on Search.tsx + management features |
| `collector/ui/src/pages/Search.tsx` | Delete (replaced by Documents.tsx) |
| `collector/ui/src/types/api.ts` | Add DocumentStats, BulkDeleteRequest types |
| `collector/ui/src/App.tsx` | Update nav, routes, imports |
| `collector/ui/src/pages/Explore.tsx` | Update "back to search" → "back to documents" |

---

## Feature Preservation Checklist

Every feature from SEARCH_FEATURES.md must be present in Documents page:

- [ ] Search bar with clear button, search button, enter key trigger
- [ ] Search modes: Semantic, Keyword, Hybrid toggle
- [ ] Source filter chips (all 7 sources with colors)
- [ ] Date range filter (from/to)
- [ ] Advanced filters: Author, Document Type, Results per page slider
- [ ] Clear all filters button with active count badge
- [ ] Loading states (LinearProgress + CircularProgress)
- [ ] Error handling (Alert banner)
- [ ] Empty state (icon + message)
- [ ] Results header with total count
- [ ] Sort controls (Relevance, Date, Source)
- [ ] Result cards: source accent bar, source chip, title link to explore, action buttons
- [ ] Open original link (when URL exists)
- [ ] Explore context button
- [ ] Relevance score with color-coded progress bar
- [ ] Date display
- [ ] Content snippet (400 chars, frontmatter stripped, 3-line clamp)
- [ ] Metadata chips (with hidden keys filtered)
- [ ] Hover effects on cards
- [ ] Pagination with first/last buttons
