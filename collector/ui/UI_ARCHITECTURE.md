# Collector UI Architecture

Comprehensive reference for implementing new pages in the collector UI.

---

## 1. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React | ^18.2.0 |
| UI Library | MUI (Material UI) | ^7.3.7 |
| Icons | @mui/icons-material | ^7.3.7 |
| Routing | react-router-dom | ^7.13.0 |
| Styling | @emotion/react + @emotion/styled | ^11.14.x |
| Fonts | @fontsource/inter, @fontsource/roboto | ^5.x |
| Build | Vite | ^5.1.4 |
| Language | TypeScript | ^5.2.2 |

**No external state management** (no Redux, Zustand, etc.) — all state is local React state or localStorage.

---

## 2. Project Structure

```
collector/ui/
├── index.html                  # Entry HTML
├── package.json
├── vite.config.ts              # Dev server + API proxy config
├── src/
│   ├── main.tsx                # ReactDOM.createRoot entry
│   ├── App.tsx                 # Root component: Router + Sidebar + Routes
│   ├── App.css                 # Legacy CSS (mostly unused)
│   ├── index.css               # Minimal global CSS (body reset, font)
│   ├── theme.ts                # MUI theme factory (light/dark)
│   ├── context/
│   │   └── ColorModeContext.ts  # React context for theme mode toggle
│   ├── hooks/
│   │   └── useLocalSettings.ts  # localStorage-backed connector settings
│   ├── types/
│   │   └── api.ts              # Shared TypeScript types & constants
│   └── pages/
│       ├── Dashboard.tsx       # Main dashboard with connector cards
│       ├── Search.tsx          # Full-text + vector search
│       ├── Explore.tsx         # Document navigation/exploration
│       ├── Activity.tsx        # Analytics & workflow history
│       └── Settings.tsx        # Per-connector configuration
```

---

## 3. App Shell & Routing

### App.tsx Structure

The root `App` component provides:
1. **Theme** — `ThemeProvider` wrapping `createAppTheme(mode)` from `theme.ts`
2. **CssBaseline** — MUI's CSS reset
3. **ColorModeContext** — Provides `{ mode, toggleMode }` to descendants
4. **BrowserRouter** — Wraps the entire layout
5. **Sidebar + Main** — Flex layout with permanent `Drawer`

```
ThemeProvider
  CssBaseline
  ColorModeContext.Provider
    BrowserRouter
      Box (display: flex)
        Drawer (permanent, width: 220px)
          SidebarContent
        Box (main content area)
          Box (max-width: 1400px, centered, padded)
            Routes
```

### Adding a New Route

1. Add the route to `NAV_ITEMS` array in `App.tsx`:
```tsx
const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: <DashboardOutlinedIcon /> },
  // ... existing items
  { path: '/documents', label: 'Documents', icon: <DescriptionOutlinedIcon /> },
  { path: '/settings', label: 'Settings', icon: <SettingsOutlinedIcon /> },
];
```

2. Import the page component and add to `<Routes>`:
```tsx
<Route path="/documents" element={<Documents />} />
```

3. Sidebar navigation is fully driven by `NAV_ITEMS` — no other changes needed.

### Route Matching

The sidebar uses prefix matching for active state:
- Exact match for `/` (Dashboard)
- `startsWith` for all other paths

---

## 4. Theme System

### theme.ts — `createAppTheme(mode: PaletteMode)`

Returns a full MUI theme object with light/dark variants.

**Key design tokens:**
- **Background:** `#F8FAFC` / `#0F172A` (default), `#FFFFFF` / `#1E293B` (paper)
- **Primary:** Indigo family (`#4F46E5` light, `#818CF8` dark)
- **Secondary:** Cyan family (`#0891B2` light, `#22D3EE` dark)
- **Text:** Slate scale (`#0F172A`/`#F1F5F9` primary, `#64748B`/`#94A3B8` secondary)
- **Divider:** `#E2E8F0` / `#334155`
- **Typography:** Inter/Roboto font stack
- **Border radius:** 8px default, 6px for buttons/list items

**Component overrides built into the theme:**
- `MuiButton` — no elevation, borderRadius 6
- `MuiPaper` — no elevation, 1px border
- `MuiTableCell` — compact padding (12px 16px), uppercase headers
- `MuiChip` — fontWeight 500, small variant height 24
- `MuiTextField` / `MuiSelect` — default size "small"
- `MuiTooltip` — arrows enabled, borderRadius 6
- `MuiLinearProgress` — borderRadius 4, height 4
- Custom scrollbar styling

### Color Mode

- Stored in `localStorage` under key `collector-theme-mode`
- Toggled via `ColorModeContext` (created in `context/ColorModeContext.ts`)
- Access in components: `useColorMode()` hook

---

## 5. Shared Types & Constants (types/api.ts)

### DataSource Type
```tsx
type DataSource = 'jira' | 'slack' | 'gmail' | 'drive' | 'confluence' | 'calendar' | 'github';
```

### Key Exports
| Export | Type | Purpose |
|--------|------|---------|
| `ALL_SOURCES` | `DataSource[]` | All 7 source identifiers |
| `SOURCE_COLORS` | `Record<DataSource, string>` | Brand color per connector |
| `SOURCE_LABELS` | `Record<DataSource, string>` | Display name per connector |
| `SOURCE_ICON_NAMES` | `Record<DataSource, string>` | MUI icon name mapping |
| `SearchResult` | interface | Standard search result shape |
| `IndexStatus` | interface | Connector indexing status |
| `ConnectorSettings` | interface | Per-connector config options |
| `WorkflowInfo` | interface | Temporal workflow metadata |

### SearchResult Shape
```tsx
interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  distance?: number;
  score: number;
  source: DataSource;
}
```

---

## 6. API Communication Pattern

### Base URL

All pages define:
```tsx
const API_BASE_URL = '/api/v1';
```

The Vite dev server proxies `/api` to `http://localhost:8087` (or `API_TARGET` env var).

### Fetch Pattern

All API calls use native `fetch` — no axios or other HTTP libraries. The consistent pattern is:

```tsx
const fetchSomething = async () => {
  setLoading(true);
  setError(null);
  try {
    const response = await fetch(`${API_BASE_URL}/endpoint`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    setState(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    setError(`Failed to do X: ${msg}`);
  } finally {
    setLoading(false);
  }
};
```

### POST requests:
```tsx
const response = await fetch(`${API_BASE_URL}/endpoint`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

### Key conventions:
- Error handling: Always wrap in try/catch, set error state with descriptive message
- Loading state: `useState<boolean>` for loading indicators
- Error state: `useState<string | null>` for error messages
- No auth headers — API is unauthenticated (local use)
- Polling: `setInterval` in `useEffect` with cleanup (Dashboard: 5s, Activity: 10s)
- SSE: `EventSource` for real-time updates (Activity page)

---

## 7. Page Component Pattern

Every page follows the same structure:

```tsx
import React, { useState, useEffect } from 'react';
import { Typography, Box, Paper, /* ... */ } from '@mui/material';
import { alpha } from '@mui/material/styles';

const API_BASE_URL = '/api/v1';

// ---------------------------------------------------------------------------
// Types (page-specific interfaces)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers (pure functions)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sub-components (FC components used only by this page)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const PageName: React.FC = () => {
  // State
  const [data, setData] = useState<Type[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data fetching
  useEffect(() => { /* fetch on mount */ }, []);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          Page Title
        </Typography>
        {/* Action buttons */}
      </Box>

      {/* Error banner */}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Loading */}
      {loading && <LinearProgress sx={{ mb: 3 }} />}

      {/* Main content */}
      {/* ... */}

      {/* Empty state */}
      {data.length === 0 && !loading && (
        <Alert severity="info">No data available.</Alert>
      )}
    </Box>
  );
};

export default PageName;
```

### Conventions:
- Pages are **default exported**
- All sub-components and types are **co-located in the same file** (no separate component files)
- Section separator comments (`// ----` or `// ====`) are used to organize large files
- `React.FC` type annotation for components
- `useCallback` for fetch functions that are used as `useEffect` deps

---

## 8. UI Component Patterns

### Page Header
```tsx
<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
  <Typography variant="h5" fontWeight={600}>Page Title</Typography>
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    {/* Refresh button, action buttons */}
  </Box>
</Box>
```

### Summary/Metric Cards
```tsx
<Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
  <Paper sx={{ p: 3, flex: '1 1 0', minWidth: 160 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 40, height: 40, borderRadius: 2,
        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
        color: 'primary.main',
      }}>
        <SomeIcon fontSize="small" />
      </Box>
      <Box>
        <Typography variant="caption" color="text.secondary">Label</Typography>
        <Typography variant="h6" fontWeight={700} lineHeight={1.2}>Value</Typography>
      </Box>
    </Box>
  </Paper>
</Box>
```

### Grid Layout
```tsx
<Box sx={{
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
  gap: 2,
}}>
```

### Cards with Source Color Accent
```tsx
<Paper sx={{ p: 0, overflow: 'hidden' }}>
  {/* Top color bar */}
  <Box sx={{ height: 3, bgcolor: alpha(sourceColor, 0.15) }} />
  {/* Card content */}
  <Box sx={{ p: 2.5 }}>
    {/* ... */}
  </Box>
</Paper>
```

### Source Chips
```tsx
<Chip
  label={SOURCE_LABELS[source]}
  size="small"
  sx={{
    backgroundColor: alpha(SOURCE_COLORS[source], 0.12),
    color: SOURCE_COLORS[source],
    fontWeight: 600,
    fontSize: '0.7rem',
    height: 22,
  }}
/>
```

### Status Chips
```tsx
<Chip label="Status" color="success" size="small" variant="outlined"
  sx={{ fontWeight: 600, fontSize: '0.7rem', height: 22 }}
/>
```

### Error Banner (dismissible)
```tsx
{error && (
  <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
    {error}
  </Alert>
)}
```

### Empty State
```tsx
<Paper sx={{ p: 6, textAlign: 'center' }}>
  <SomeIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.4, mb: 2 }} />
  <Typography variant="h6" color="text.secondary" gutterBottom>
    No results found
  </Typography>
  <Typography variant="body2" color="text.secondary">
    Helpful explanation text.
  </Typography>
</Paper>
```

### Tables
```tsx
<TableContainer component={Paper} sx={{ p: 0 }}>
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell>Column</TableCell>
        {/* ... */}
      </TableRow>
    </TableHead>
    <TableBody>
      {data.map((item, idx) => (
        <TableRow key={item.id} sx={{
          bgcolor: (theme) => idx % 2 === 1
            ? alpha(theme.palette.action.hover, theme.palette.mode === 'dark' ? 0.04 : 0.025)
            : 'transparent',
          '&:last-child td': { borderBottom: 0 },
        }}>
          {/* ... */}
        </TableRow>
      ))}
    </TableBody>
  </Table>
</TableContainer>
```

### Responsive Split Layout
```tsx
<Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
  <Box sx={{ flex: 2, minWidth: 0 }}>{/* Main panel */}</Box>
  <Box sx={{ flex: 1, minWidth: 280 }}>{/* Side panel */}</Box>
</Box>
```

---

## 9. State Management Patterns

### Local State (Primary)
All pages use `useState` for their data, loading, and error states.

### localStorage Persistence
Via `useLocalSettings` hook — used by Dashboard and Settings for connector settings.

**Storage key:** `collector-settings`

The hook provides:
- `getSettings(source)` — get settings for a DataSource
- `updateSettings(source, partial)` — merge updates
- `setSourceSettings(source, value)` — replace settings
- `applyDateToAll(startDate, endDate, sinceLast)` — broadcast date range
- `mergeServerSettings(source, serverSettings)` — merge server with local (local wins)

### Theme Mode
**Storage key:** `collector-theme-mode`

Stored as `'light'` or `'dark'`, managed in `App.tsx`.

### URL State
- Settings page reads `?source=xxx` from search params to auto-select a connector
- Explore page uses route params: `/explore/:documentId`
- Search page uses local state only (no URL sync)

---

## 10. Icon Pattern

Each page re-creates a `SOURCE_ICONS` map locally:
```tsx
const SOURCE_ICONS: Record<DataSource, React.ReactElement> = {
  jira: <BugReportOutlined />,
  slack: <TagOutlined />,
  gmail: <MailOutlined />,
  drive: <CloudOutlined />,
  confluence: <MenuBookOutlined />,
  calendar: <CalendarMonthOutlined />,
  github: <CodeOutlined />,
};
```

All icons use the `Outlined` variant from `@mui/icons-material`.

---

## 11. Responsive Design

The app uses MUI's responsive `sx` prop syntax:
```tsx
sx={{
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
  px: { xs: 2, sm: 3, md: 4 },
  flexDirection: { xs: 'column', md: 'row' },
}}
```

Main content area is constrained: `maxWidth: 1400, mx: 'auto'`

---

## 12. Key Styling Patterns

### alpha() for Transparent Colors
```tsx
import { alpha } from '@mui/material/styles';

backgroundColor: alpha(theme.palette.primary.main, 0.08)
```

### Theme-aware sx
```tsx
sx={(theme) => ({
  backgroundColor: alpha(theme.palette.primary.main, 0.04),
  border: `1px solid ${theme.palette.divider}`,
})}
```

### Spacing (MUI theme units, 1 unit = 8px)
- Page header bottom margin: `mb: 3` (24px)
- Card padding: `p: 2.5` or `p: 3` (20-24px)
- Grid gap: `gap: 2` (16px)
- Small gaps: `gap: 0.5` to `gap: 1.5`

### Typography Variants Used
| Variant | Usage |
|---------|-------|
| `h4` | Activity page big metric numbers |
| `h5` | Page titles, section headings |
| `h6` | Card titles, panel headers |
| `subtitle1` | Connector names, search result titles |
| `subtitle2` | Section labels (uppercase), form labels |
| `body1` | Document content |
| `body2` | Table cells, descriptions, secondary text |
| `caption` | Metadata, timestamps, helper text |

---

## 13. Existing API Endpoints Used by UI

| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/v1/index/status` | Dashboard |
| POST | `/api/v1/index/all` | Dashboard |
| POST | `/api/v1/index/:source` | Dashboard, Settings |
| DELETE | `/api/v1/index/:source` | Dashboard |
| GET | `/api/v1/index/settings/:source` | Settings |
| POST | `/api/v1/index/settings/:source` | Settings |
| GET | `/api/v1/index/discovery/:source/*` | Settings |
| GET | `/api/v1/analytics/health` | Dashboard |
| GET | `/api/v1/analytics/stats` | Activity |
| GET | `/api/v1/analytics/config/export` | Dashboard |
| POST | `/api/v1/analytics/config/import` | Dashboard |
| POST | `/api/v1/search` | Search |
| GET | `/api/v1/search/navigate/:id` | Explore |
| GET | `/api/v1/workflows/recent` | Activity |
| DELETE | `/api/v1/workflows/:id` | Dashboard, Activity |
| GET | `/api/v1/events/indexing` | Activity (SSE) |

---

## 14. Checklist for Adding a New Page

1. **Create page file** at `src/pages/PageName.tsx`
2. **Follow the component pattern** from Section 7 (types, constants, helpers, sub-components, main)
3. **Add route** in `App.tsx` `<Routes>` section
4. **Add nav item** to `NAV_ITEMS` array in `App.tsx`
5. **Import icon** from `@mui/icons-material` (use `Outlined` variant)
6. **Add types** to `types/api.ts` if needed (shared interfaces)
7. **Use `const API_BASE_URL = '/api/v1'`** for all API calls
8. **Use native `fetch`** with try/catch error handling
9. **Include loading state** (`LinearProgress` for initial, `CircularProgress` for buttons)
10. **Include error state** (dismissible `Alert` banner)
11. **Include empty state** (centered icon + message in `Paper`)
12. **Use `alpha()`** for transparent color overlays
13. **Use MUI `sx` prop** exclusively (no CSS modules, no styled-components)
14. **Use existing `SOURCE_COLORS` and `SOURCE_LABELS`** for connector-specific styling
15. **Default export** the page component
