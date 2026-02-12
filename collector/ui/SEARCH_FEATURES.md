# Search Page Feature Inventory

Comprehensive inventory of all features in the current Search page (`collector/ui/src/pages/Search.tsx`) and its companion Explore page (`collector/ui/src/pages/Explore.tsx`).

---

## 1. Search Bar

- **Text input** with `SearchIcon` start adornment and placeholder: "Search across all your indexed data..."
- **Clear button** (X icon) appears inside the text field when query is non-empty
- **Search button** with loading spinner (`CircularProgress`) when searching; disabled when loading or query is empty
- **Enter key** triggers search (`handleKeyDown` on `Enter`)
- Styled with a subtle primary-color background tint that clears on focus

## 2. Search Modes (Toggle Group)

Three mutually exclusive modes via `ToggleButtonGroup`:
| Value     | Label      | Description                   |
|-----------|------------|-------------------------------|
| `vector`  | Semantic   | Vector/embedding-based search |
| `keyword` | Keyword    | Keyword/text match search     |
| `hybrid`  | Hybrid     | Combined vector + keyword     |

Default: `vector` (Semantic)

## 3. Source Filters

- Chip-based multi-select for 7 data sources (from `ALL_SOURCES`):
  - **Jira** (blue `#0052CC`)
  - **Slack** (purple `#4A154B`)
  - **Gmail** (red `#EA4335`)
  - **Google Drive** (green `#0F9D58`)
  - **Confluence** (navy `#172B4D`)
  - **Calendar** (blue `#4285F4`)
  - **GitHub** (purple `#6e5494`)
- Toggle behavior: click to select/deselect; selected chips get filled style with source color
- When no sources selected, search spans all sources (no filter sent to API)
- Source colors and labels defined in `types/api.ts`: `SOURCE_COLORS`, `SOURCE_LABELS`, `ALL_SOURCES`

## 4. Date Range Filter

- Two native date inputs (`type="date"`) with "From" / "To" labels
- Start date has a `CalendarTodayIcon` adornment
- Values sent as `startDate` / `endDate` strings to the API
- Both are optional; either can be used independently

## 5. Advanced Filters (Collapsible Section)

Toggled by "Advanced Filters" button with `TuneIcon`; shows active-count badge chip when filters are set.

### 5a. Author Filter
- Free-text `TextField` with `PersonOutlineIcon` adornment
- Placeholder: "Filter by author name"
- Sent as `where.author` in the API request

### 5b. Document Type Filter
- `Select` dropdown with `DescriptionOutlinedIcon` adornment
- Options:
  - *Any* (empty value)
  - Issue
  - Message
  - Email
  - Document
  - Page
  - Event
  - Pull Request
  - Comment
  - File
- Sent as `where.type` in the API request

### 5c. Results Per Page (Slider)
- `Slider` component: min 5, max 50, step 5
- Default: 20
- Label shows current value: "Results per page: {limit}"

## 6. Clear All Filters

- "Clear all filters" button appears when any filter is active (`hasActiveFilters`)
- Resets: query, selectedSources, searchType (to vector), limit (to 20), dates, author, type, sortMode, results, total, error, hasSearched, page

## 7. Loading States

- `LinearProgress` bar displayed below filters during search
- Search button shows `CircularProgress` spinner while loading

## 8. Error Handling

- `Alert` component (`severity="error"`) shows error message on search failure
- Error message format: "Search failed: {message}"

## 9. Empty State

- Shown when search has been performed, not loading, no results, no error
- Large `SearchIcon` (48px, faded), "No results found" heading, "Try adjusting your search query or filters" body text

## 10. Results Header

- Total result count: "{total} result(s) found"
- **Sort controls** via `ToggleButtonGroup` with `SortIcon`:
  - **Relevance** (default) — keeps API order
  - **Date** — sorts by `updatedAt` || `date` || `timestamp` descending
  - **Source** — sorts alphabetically by source name

## 11. Result Cards

Each result rendered as a `Paper` card with:

### 11a. Source Accent Bar
- 4px vertical colored bar on the left edge, colored by `SOURCE_COLORS[result.source]`

### 11b. Source Chip
- Small chip with source label, colored background (12% opacity), bold text

### 11c. Title
- Derived from metadata: `title` → `subject` → `name` → `id` (fallback)
- Clickable: navigates to `/explore/{encodedId}`
- Truncated with ellipsis (`text-overflow: ellipsis`)
- Underline on hover

### 11d. Action Buttons
- **Open original** (`OpenInNewIcon`): only shown if `metadata.url` exists; opens in new tab
- **Explore context** (`ExploreIcon`): always shown; navigates to `/explore/{encodedId}`

### 11e. Relevance Score
- `LinearProgress` bar (80px wide, 4px height) showing score percentage
- Numeric label: `{scorePercent}%`
- Score calculation: `result.score * 100` or `(1 - result.distance) * 100`
- Color coding:
  - >70%: `success.main` (green)
  - >40%: `warning.main` (amber)
  - <=40%: `text.secondary` (gray)

### 11f. Date Display
- Formatted from `updatedAt` || `date` || `timestamp`
- Format: `toLocaleDateString()` with `{ year: 'numeric', month: 'short', day: 'numeric' }`

### 11g. Content Snippet
- First 400 characters of content, with YAML frontmatter stripped (`/^---[\s\S]*?---\s*/`)
- Clamped to 3 lines via `-webkit-line-clamp: 3`
- Line height: 1.6

### 11h. Metadata Chips
- Renders all metadata key-value pairs as small outlined chips
- **Hidden keys** (excluded from display): `search_context`, `id`, `chunkId`, `chunkIndex`, `totalChunks`, `timestamp`, `source`, `content`, `title`, `subject`, `name`, `url`
- Only shows string/number/boolean values under 60 characters

### 11i. Hover Effect
- Border color changes to primary (30% opacity)
- Subtle box-shadow with primary color (8% opacity)

## 12. Pagination

- MUI `Pagination` component (rounded shape)
- Shows first/last buttons (`showFirstButton`, `showLastButton`)
- Color: primary
- Total pages: `Math.ceil(total / limit)`
- Page change triggers a new API call with `offset = (page - 1) * limit`
- Only shown when `totalPages > 1`

## 13. API Integration

### Search Endpoint
- `POST /api/v1/search`
- Request body (`SearchRequest`):
  ```ts
  {
    query: string;
    sources?: DataSource[];
    searchType?: 'vector' | 'keyword' | 'hybrid';
    limit?: number;
    offset?: number;
    where?: Record<string, unknown>;  // { author?, type? }
    startDate?: string;
    endDate?: string;
  }
  ```
- Response: `{ results: SearchResult[]; total: number }`

### Navigation Endpoint (used by Explore page)
- `GET /api/v1/search/navigate/:documentId`
- Query params: `direction`, `scope`, `limit`
- Response: `NavigationResult` with `current`, `related[]`, `navigation` state

### Backend
- Controller: `SearchController` at `collector/src/controllers/search.controller.ts`
- Protected by `ApiKeyGuard`
- Delegates to `ChromaService.search()` and `ChromaService.navigate()`

## 14. Shared Types (`types/api.ts`)

| Type/Constant     | Description |
|-------------------|-------------|
| `DataSource`      | Union type: `'jira' \| 'slack' \| 'gmail' \| 'drive' \| 'confluence' \| 'calendar' \| 'github'` |
| `ALL_SOURCES`     | Array of all 7 sources |
| `SOURCE_COLORS`   | Color hex per source |
| `SOURCE_LABELS`   | Display label per source |
| `SOURCE_ICON_NAMES` | MUI icon name per source (not yet used in Search) |
| `SearchRequest`   | API request shape |
| `SearchResult`    | API result shape: `{ id, content, metadata, distance?, score, source }` |
| `NavigationResponse` | Navigation API response |
| `IndexStatus`     | Connector indexing status |
| `ConnectorSettings` | Per-connector filter settings |
| `AllSettings`     | Map of source → settings |
| `WorkflowInfo`    | Temporal workflow info |

## 15. Explore Page (Linked from Search Results)

The Explore page (`/explore/:documentId`) is the detail/navigation view accessed from search results.

### Features:
- **Directional navigation**: Previous, Next, Parent, Children, Siblings buttons
- **Scope toggle**: Chunk / Datapoint / Context — controls the navigation granularity
- **Context chips**: Shows `contextType` and sibling count
- **Breadcrumbs**: Source-specific hierarchical breadcrumbs:
  - Jira: Project > [Parent Issue] > current
  - Slack: #channel > [Thread] > current
  - Gmail: Thread > current
  - Drive: path segments
  - Confluence: Space > [ancestors] > [parent page] > current
  - Calendar: Events > current
  - GitHub: repo > [PR/Issue] > current
- **Back button** with history stack (in-memory, tracks visited document IDs)
- **Split layout**: 2/3 current document view, 1/3 related documents sidebar
- **Document detail panel**: Title, timestamp, author, full content (pre-wrapped), external link, metadata chips
- **Related documents list**: Clickable items with source chip, title, timestamp
- **Empty state**: "No Document Selected" with link to Search page
- **Loading / Error states**: `LinearProgress` bar and `Alert` component

## 16. UI Architecture Notes

- **No custom hooks** used by Search (self-contained state via `useState`)
- **No shared components** — Search and Explore are fully self-contained page components
- **Routing**: `/search` (Search page), `/explore` and `/explore/:documentId` (Explore page)
- **Theme**: MUI v7 with custom `createAppTheme(mode)` — supports light/dark mode
- **Color mode**: `ColorModeContext` with `useColorMode()` hook
- **Settings persistence**: `useLocalSettings` hook (localStorage-based) — used by Settings page, not by Search
- **Navigation**: `react-router-dom` v6 with `useNavigate`, `useParams`, `useLocation`
- **No external state management** (no Redux, no Context for search state)
- **API base URL**: hardcoded as `'/api/v1'` in each page component

## 17. Keyboard Shortcuts

- **Enter** in search field → triggers search (only if query is non-empty)
- No other keyboard shortcuts present

## 18. Missing / Not Implemented

These features are absent from the current search page:
- No search history / recent searches
- No saved searches or bookmarks
- No URL-based query persistence (search state lost on page refresh)
- No debounced/auto-search (explicit button click or Enter required)
- No result grouping by source
- No export/download of results
- No bulk operations on results
- No inline document preview/expansion
- No "load more" pattern (uses pagination instead)
- `SOURCE_ICON_NAMES` defined but not used in Search UI
