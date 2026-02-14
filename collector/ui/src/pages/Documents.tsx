import React, { useState, useEffect, useCallback } from 'react';
import {
  Typography, Box, Paper, TextField, Button, Select, MenuItem, FormControl, InputLabel,
  CircularProgress, Alert, Chip, Slider, Collapse, ToggleButtonGroup, ToggleButton,
  LinearProgress, IconButton, Tooltip, Pagination, InputAdornment, Divider,
  Checkbox, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import TuneIcon from '@mui/icons-material/Tune';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ExploreIcon from '@mui/icons-material/Explore';
import SortIcon from '@mui/icons-material/Sort';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useNavigate } from 'react-router-dom';
import {
  DataSource, SearchResult, ALL_SOURCES, DEFAULT_SEARCH_SOURCES, SOURCE_COLORS, SOURCE_LABELS, DocumentStats,
} from '../types/api';

const API_BASE_URL = '/api/v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SearchType = 'vector' | 'keyword' | 'hybrid';
type SortMode = 'relevance' | 'date' | 'source';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  vector: 'Semantic',
  keyword: 'Keyword',
  hybrid: 'Hybrid',
};

const HIDDEN_METADATA_KEYS = new Set([
  'search_context', 'id', 'chunkId', 'chunkIndex', 'totalChunks',
  'timestamp', 'source', 'content', 'title', 'subject', 'name', 'url',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getScorePercent = (result: SearchResult): number => {
  if (result.score != null) return Math.round(result.score * 100);
  if (result.distance != null) return Math.round((1 - result.distance) * 100);
  return 0;
};

const getTitle = (result: SearchResult): string => {
  const m = result.metadata;
  return (m.title as string) || (m.subject as string) || (m.name as string) || result.id;
};

const getResultDate = (result: SearchResult): string | null => {
  const raw = (result.metadata.updatedAt || result.metadata.date || result.metadata.timestamp) as string | undefined;
  if (!raw) return null;
  try {
    return new Date(raw).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return raw;
  }
};

const highlightSnippet = (content: string): string => {
  const text = content.replace(/^---[\s\S]*?---\s*/, '').trim();
  return text.length > 400 ? text.slice(0, 400) + '...' : text;
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const Documents: React.FC = () => {
  const navigate = useNavigate();

  // Search controls
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('vector');
  const [selectedSources, setSelectedSources] = useState<DataSource[]>(DEFAULT_SEARCH_SOURCES);
  const [limit, setLimit] = useState(20);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('date');

  // Advanced filters
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [metaAuthor, setMetaAuthor] = useState('');
  const [metaType, setMetaType] = useState('');

  // Results
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [page, setPage] = useState(1);

  // Browse / search mode
  const [browseMode, setBrowseMode] = useState(true);

  // Document management state
  const [selectedIds, setSelectedIds] = useState<Map<string, { source: DataSource; id: string }>>(new Map());
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<'selected' | { source: DataSource; id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ---------------------------------------------------------------------------
  // API calls
  // ---------------------------------------------------------------------------

  const loadStats = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/search/documents/stats`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setStats(data);
    } catch {
      // Stats are non-critical; silently ignore
    }
  }, []);

  const browseDocuments = useCallback(async (newPage = 1) => {
    setLoading(true);
    setError(null);
    setPage(newPage);

    const params = new URLSearchParams();
    if (selectedSources.length > 0) params.set('sources', selectedSources.join(','));
    params.set('limit', String(limit));
    params.set('offset', String((newPage - 1) * limit));
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    const where: Record<string, unknown> = {};
    if (metaAuthor) where.author = metaAuthor;
    if (metaType) where.type = metaType;
    if (Object.keys(where).length > 0) params.set('where', JSON.stringify(where));

    try {
      const response = await fetch(`${API_BASE_URL}/search/documents?${params}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setResults(data.results || data);
      setTotal(data.total ?? (data.results || data).length);
      setHasSearched(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to load documents: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [selectedSources, limit, startDate, endDate, metaAuthor, metaType]);

  const handleSearch = useCallback(async (newPage = 1) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setPage(newPage);
    setBrowseMode(false);

    const where: Record<string, unknown> = {};
    if (metaAuthor) where.author = metaAuthor;
    if (metaType) where.type = metaType;

    const body = {
      query,
      sources: selectedSources.length > 0 ? selectedSources : undefined,
      searchType,
      limit,
      offset: (newPage - 1) * limit,
      where: Object.keys(where).length > 0 ? where : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };

    try {
      const response = await fetch(`${API_BASE_URL}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setResults(data.results || data);
      setTotal(data.total ?? (data.results || data).length);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Search failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [query, selectedSources, searchType, limit, metaAuthor, metaType, startDate, endDate]);

  const handleDeleteSingle = async (source: DataSource, id: string) => {
    setDeleting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/index/${source}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Delete failed: ${msg}`);
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      // Refresh
      refreshResults();
      loadStats();
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    const ids = Array.from(selectedIds.values());
    try {
      const response = await fetch(`${API_BASE_URL}/search/documents/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Bulk delete failed: ${msg}`);
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setSelectedIds(new Map());
      // Refresh
      refreshResults();
      loadStats();
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const refreshResults = useCallback(() => {
    if (browseMode) {
      browseDocuments(page);
    } else if (query) {
      handleSearch(page);
    }
  }, [browseMode, browseDocuments, handleSearch, page, query]);

  // On mount: load stats + browse
  useEffect(() => {
    loadStats();
    browseDocuments(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    setQuery('');
    setSelectedSources(DEFAULT_SEARCH_SOURCES);
    setSearchType('vector');
    setLimit(20);
    setStartDate('');
    setEndDate('');
    setMetaAuthor('');
    setMetaType('');
    setSortMode('date');
    setResults([]);
    setTotal(0);
    setError(null);
    setHasSearched(false);
    setPage(1);
    setBrowseMode(true);
    setSelectedIds(new Map());
    // Re-browse after clearing
    setTimeout(() => {
      browseDocuments(1);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query) handleSearch();
  };

  const handleSearchClick = () => {
    if (query) {
      setSortMode((prev) => prev === 'date' && !browseMode ? prev : 'relevance');
      handleSearch(1);
    }
  };

  const toggleSource = (source: DataSource) => {
    setSelectedSources(prev =>
      prev.includes(source) ? prev.filter(s => s !== source) : [...prev, source]
    );
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (!value && !browseMode) {
      setBrowseMode(true);
      setSortMode('date');
      setSelectedIds(new Map());
      browseDocuments(1);
    }
  };

  const handleQueryClear = () => {
    setQuery('');
    setBrowseMode(true);
    setSortMode('date');
    setSelectedIds(new Map());
    browseDocuments(1);
  };

  // Pagination handler: delegates to browse or search
  const handlePageChange = (newPage: number) => {
    setSelectedIds(new Map());
    if (browseMode) {
      browseDocuments(newPage);
    } else {
      handleSearch(newPage);
    }
  };

  // Selection helpers
  const toggleSelect = (result: SearchResult) => {
    setSelectedIds(prev => {
      const next = new Map(prev);
      if (next.has(result.id)) {
        next.delete(result.id);
      } else {
        next.set(result.id, { source: result.source, id: result.id });
      }
      return next;
    });
  };

  const selectAllOnPage = () => {
    setSelectedIds(prev => {
      const next = new Map(prev);
      for (const r of sortedResults) {
        next.set(r.id, { source: r.source, id: r.id });
      }
      return next;
    });
  };

  const deselectAll = () => {
    setSelectedIds(new Map());
  };

  const openDeleteDialog = (target: 'selected' | { source: DataSource; id: string }) => {
    setDeleteTarget(target);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget === 'selected') {
      handleBulkDelete();
    } else {
      handleDeleteSingle(deleteTarget.source, deleteTarget.id);
    }
  };

  const deleteCount = deleteTarget === 'selected' ? selectedIds.size : 1;

  // Sorting
  const sortedResults = [...results].sort((a, b) => {
    if (sortMode === 'date') {
      const dateA = (a.metadata.updatedAt || a.metadata.date || a.metadata.timestamp || '') as string;
      const dateB = (b.metadata.updatedAt || b.metadata.date || b.metadata.timestamp || '') as string;
      return dateB.localeCompare(dateA);
    }
    if (sortMode === 'source') return (a.source || '').localeCompare(b.source || '');
    return 0;
  });

  const totalPages = Math.ceil(total / limit);

  const sourcesChanged = selectedSources.length !== DEFAULT_SEARCH_SOURCES.length
    || selectedSources.some(s => !DEFAULT_SEARCH_SOURCES.includes(s));
  const hasActiveFilters = sourcesChanged || startDate || endDate || metaAuthor || metaType;

  return (
    <Box>
      {/* Page Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            Documents
          </Typography>
          {stats && (
            <Typography variant="body2" color="text.secondary">
              {stats.total.toLocaleString()} documents indexed
            </Typography>
          )}
        </Box>
        <Tooltip title="Refresh">
          <IconButton
            size="small"
            onClick={() => { loadStats(); if (browseMode) browseDocuments(page); }}
            sx={{ color: 'text.secondary' }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Stats Bar */}
      {stats && stats.sources.length > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {stats.sources.map(({ source, count }) => (
              <Chip
                key={source}
                label={`${SOURCE_LABELS[source]}: ${count.toLocaleString()}`}
                size="small"
                sx={{
                  backgroundColor: (theme) => alpha(SOURCE_COLORS[source], theme.palette.mode === 'dark' ? 0.2 : 0.1),
                  color: SOURCE_COLORS[source],
                  fontWeight: 600,
                  fontSize: '0.75rem',
                }}
              />
            ))}
          </Box>
        </Paper>
      )}

      {/* Search Bar */}
      <Paper sx={{ p: 3, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'stretch' }}>
          <TextField
            fullWidth
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search across all your indexed data..."
            size="medium"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                endAdornment: query ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={handleQueryClear} edge="end">
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
                sx: {
                  fontSize: '1rem',
                  py: 0.5,
                },
              },
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.04),
                '&:hover': {
                  backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.06),
                },
                '&.Mui-focused': {
                  backgroundColor: 'transparent',
                },
              },
            }}
          />
          <Button
            variant="contained"
            onClick={handleSearchClick}
            disabled={loading || !query}
            sx={{
              px: 4,
              minWidth: 120,
              fontSize: '0.875rem',
            }}
          >
            {loading ? <CircularProgress size={22} color="inherit" /> : 'Search'}
          </Button>
        </Box>
      </Paper>

      {/* Filters Row */}
      <Paper sx={{ p: 3, mb: 2 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'flex-start' }}>
          {/* Search Mode */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
              Mode
            </Typography>
            <ToggleButtonGroup
              value={searchType}
              exclusive
              onChange={(_, val) => val && setSearchType(val)}
              size="small"
            >
              {(['vector', 'keyword', 'hybrid'] as SearchType[]).map((type) => (
                <ToggleButton
                  key={type}
                  value={type}
                  sx={{
                    px: 2,
                    '&.Mui-selected': {
                      backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.12),
                      color: 'primary.main',
                      fontWeight: 600,
                    },
                  }}
                >
                  {SEARCH_TYPE_LABELS[type]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          <Divider orientation="vertical" flexItem />

          {/* Source Filters */}
          <Box sx={{ flex: 1, minWidth: 240 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
              Sources
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {ALL_SOURCES.map(source => {
                const isSelected = selectedSources.includes(source);
                return (
                  <Chip
                    key={source}
                    label={SOURCE_LABELS[source]}
                    onClick={() => toggleSource(source)}
                    variant={isSelected ? 'filled' : 'outlined'}
                    size="small"
                    sx={{
                      borderColor: isSelected ? SOURCE_COLORS[source] : undefined,
                      backgroundColor: isSelected ? alpha(SOURCE_COLORS[source], 0.15) : 'transparent',
                      color: isSelected ? SOURCE_COLORS[source] : 'text.secondary',
                      fontWeight: isSelected ? 600 : 400,
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        backgroundColor: alpha(SOURCE_COLORS[source], 0.1),
                        borderColor: SOURCE_COLORS[source],
                        color: SOURCE_COLORS[source],
                      },
                    }}
                  />
                );
              })}
            </Box>
          </Box>

          <Divider orientation="vertical" flexItem />

          {/* Date Range */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
              Date Range
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                size="small"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <CalendarTodayIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      </InputAdornment>
                    ),
                  },
                  inputLabel: { shrink: true },
                }}
                placeholder="From"
                sx={{ width: 170 }}
              />
              <Typography variant="body2" color="text.secondary">to</Typography>
              <TextField
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                size="small"
                slotProps={{
                  inputLabel: { shrink: true },
                }}
                placeholder="To"
                sx={{ width: 150 }}
              />
            </Box>
          </Box>
        </Box>

        {/* Advanced Filters Toggle + Clear */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
          <Button
            size="small"
            startIcon={<TuneIcon />}
            endIcon={advancedOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            onClick={() => setAdvancedOpen(!advancedOpen)}
            sx={{ color: 'text.secondary', textTransform: 'none', fontWeight: 500 }}
          >
            Advanced Filters
            {(metaAuthor || metaType) && (
              <Chip
                label={[metaAuthor && 'author', metaType && 'type'].filter(Boolean).length}
                size="small"
                color="primary"
                sx={{ ml: 1, height: 20, minWidth: 20, '& .MuiChip-label': { px: 0.75 } }}
              />
            )}
          </Button>
          {hasActiveFilters && (
            <Button
              size="small"
              startIcon={<ClearIcon />}
              onClick={handleClear}
              sx={{ color: 'text.secondary', textTransform: 'none' }}
            >
              Clear all filters
            </Button>
          )}
        </Box>

        {/* Advanced Filters Content */}
        <Collapse in={advancedOpen}>
          <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <TextField
                label="Author"
                value={metaAuthor}
                onChange={(e) => setMetaAuthor(e.target.value)}
                size="small"
                sx={{ width: 220 }}
                placeholder="Filter by author name"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonOutlineIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <FormControl size="small" sx={{ width: 220 }}>
                <InputLabel>Document Type</InputLabel>
                <Select
                  value={metaType}
                  label="Document Type"
                  onChange={(e) => setMetaType(e.target.value)}
                  startAdornment={
                    <InputAdornment position="start">
                      <DescriptionOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                    </InputAdornment>
                  }
                >
                  <MenuItem value=""><em>Any</em></MenuItem>
                  <MenuItem value="issue">Issue</MenuItem>
                  <MenuItem value="message">Message</MenuItem>
                  <MenuItem value="email">Email</MenuItem>
                  <MenuItem value="document">Document</MenuItem>
                  <MenuItem value="page">Page</MenuItem>
                  <MenuItem value="event">Event</MenuItem>
                  <MenuItem value="pull_request">Pull Request</MenuItem>
                  <MenuItem value="comment">Comment</MenuItem>
                  <MenuItem value="file">File</MenuItem>
                </Select>
              </FormControl>
              <Box sx={{ width: 180 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  Results per page: {limit}
                </Typography>
                <Slider
                  value={limit}
                  onChange={(_, val) => setLimit(val as number)}
                  min={5}
                  max={50}
                  step={5}
                  size="small"
                />
              </Box>
            </Box>
          </Box>
        </Collapse>
      </Paper>

      {/* Selection Action Bar */}
      {selectedIds.size > 0 && (
        <Paper sx={(theme) => ({
          p: 2, mb: 2,
          backgroundColor: alpha(theme.palette.primary.main, 0.06),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
        })}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600}>
              {selectedIds.size} selected
            </Typography>
            <Button size="small" onClick={selectAllOnPage} sx={{ textTransform: 'none' }}>
              Select all on page
            </Button>
            <Button size="small" onClick={deselectAll} sx={{ textTransform: 'none' }}>
              Deselect all
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => openDeleteDialog('selected')}
              disabled={deleting}
            >
              Delete selected
            </Button>
          </Box>
        </Paper>
      )}

      {/* Loading Bar */}
      {loading && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

      {/* Error */}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Empty State */}
      {hasSearched && !loading && results.length === 0 && !error && (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <SearchIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.4, mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {browseMode ? 'No documents found' : 'No results found'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {browseMode
              ? 'No documents have been indexed yet. Start indexing from the Dashboard.'
              : 'Try adjusting your search query or filters.'}
          </Typography>
        </Paper>
      )}

      {/* Results */}
      {results.length > 0 && (
        <Box>
          {/* Results Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="body2" color="text.secondary" fontWeight={500}>
              {total} {browseMode ? 'document' : 'result'}{total !== 1 ? 's' : ''} {browseMode ? 'total' : 'found'}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SortIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              <ToggleButtonGroup
                value={sortMode}
                exclusive
                onChange={(_, val) => val && setSortMode(val)}
                size="small"
              >
                {!browseMode && (
                  <ToggleButton value="relevance" sx={{ px: 1.5, py: 0.25, fontSize: '0.75rem' }}>
                    Relevance
                  </ToggleButton>
                )}
                <ToggleButton value="date" sx={{ px: 1.5, py: 0.25, fontSize: '0.75rem' }}>
                  Date
                </ToggleButton>
                <ToggleButton value="source" sx={{ px: 1.5, py: 0.25, fontSize: '0.75rem' }}>
                  Source
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Box>

          {/* Result Cards */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {sortedResults.map((result) => {
              const scorePercent = getScorePercent(result);
              const dateStr = getResultDate(result);
              const sourceColor = SOURCE_COLORS[result.source] || '#666';
              const isSelected = selectedIds.has(result.id);

              return (
                <Paper
                  key={result.id}
                  sx={{
                    p: 0,
                    overflow: 'hidden',
                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                    borderColor: isSelected ? (theme) => alpha(theme.palette.primary.main, 0.4) : undefined,
                    '&:hover': {
                      borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
                      boxShadow: (theme) => `0 2px 8px ${alpha(theme.palette.primary.main, 0.08)}`,
                    },
                  }}
                >
                  <Box sx={{ display: 'flex' }}>
                    {/* Source Accent Bar */}
                    <Box
                      sx={{
                        width: 4,
                        minHeight: '100%',
                        backgroundColor: sourceColor,
                        flexShrink: 0,
                      }}
                    />

                    {/* Content */}
                    <Box sx={{ flex: 1, p: 2.5 }}>
                      {/* Top Row: Checkbox + Source Chip + Title + Actions */}
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                        <Checkbox
                          checked={isSelected}
                          onChange={() => toggleSelect(result)}
                          size="small"
                          sx={{ p: 0, mt: 0.2, mr: 0.5 }}
                        />
                        <Chip
                          label={SOURCE_LABELS[result.source] || result.source}
                          size="small"
                          sx={{
                            backgroundColor: alpha(sourceColor, 0.12),
                            color: sourceColor,
                            fontWeight: 600,
                            fontSize: '0.7rem',
                            height: 22,
                            flexShrink: 0,
                            mt: 0.2,
                          }}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="subtitle1"
                            sx={{
                              fontWeight: 600,
                              color: 'primary.main',
                              cursor: 'pointer',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              '&:hover': { textDecoration: 'underline' },
                            }}
                            onClick={() => navigate(`/explore/${encodeURIComponent(result.id)}`)}
                          >
                            {getTitle(result)}
                          </Typography>
                        </Box>

                        {/* Actions */}
                        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                          {typeof result.metadata.url === 'string' && (
                            <Tooltip title="Open original">
                              <IconButton
                                size="small"
                                component="a"
                                href={result.metadata.url as string}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                  color: 'text.secondary',
                                  '&:hover': { color: 'secondary.main' },
                                }}
                              >
                                <OpenInNewIcon sx={{ fontSize: 18 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Explore context">
                            <IconButton
                              size="small"
                              onClick={() => navigate(`/explore/${encodeURIComponent(result.id)}`)}
                              sx={{
                                color: 'text.secondary',
                                '&:hover': { color: 'primary.main' },
                              }}
                            >
                              <ExploreIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete document">
                            <IconButton
                              size="small"
                              onClick={() => openDeleteDialog({ source: result.source, id: result.id })}
                              sx={{
                                color: 'text.secondary',
                                '&:hover': { color: 'error.main' },
                              }}
                            >
                              <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>

                      {/* Score + Date Row */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                        {!browseMode && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 140 }}>
                            <LinearProgress
                              variant="determinate"
                              value={scorePercent}
                              sx={{
                                width: 80,
                                height: 4,
                                borderRadius: 2,
                                backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.08),
                                '& .MuiLinearProgress-bar': {
                                  borderRadius: 2,
                                  backgroundColor: scorePercent > 70
                                    ? 'success.main'
                                    : scorePercent > 40
                                      ? 'warning.main'
                                      : 'text.secondary',
                                },
                              }}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                              {scorePercent}%
                            </Typography>
                          </Box>
                        )}
                        {dateStr && (
                          <Typography variant="caption" color="text.secondary">
                            {dateStr}
                          </Typography>
                        )}
                      </Box>

                      {/* Snippet */}
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          mb: 1.5,
                          lineHeight: 1.6,
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {highlightSnippet(result.content)}
                      </Typography>

                      {/* Metadata Chips */}
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {Object.entries(result.metadata).map(([key, value]) => {
                          if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
                          if (HIDDEN_METADATA_KEYS.has(key)) return null;
                          const strVal = String(value);
                          if (strVal.length > 60) return null;
                          return (
                            <Chip
                              key={key}
                              label={`${key}: ${strVal}`}
                              size="small"
                              variant="outlined"
                              sx={{
                                fontSize: '0.7rem',
                                height: 22,
                                borderColor: (theme) => alpha(theme.palette.divider, 0.8),
                                color: 'text.secondary',
                              }}
                            />
                          );
                        })}
                      </Box>
                    </Box>
                  </Box>
                </Paper>
              );
            })}
          </Box>

          {/* Pagination */}
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4, mb: 2 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, newPage) => handlePageChange(newPage)}
                color="primary"
                shape="rounded"
                showFirstButton
                showLastButton
              />
            </Box>
          )}
        </Box>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => { if (!deleting) { setDeleteDialogOpen(false); setDeleteTarget(null); } }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningAmberIcon color="error" />
          Delete {deleteCount} document{deleteCount !== 1 ? 's' : ''}?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This action cannot be undone. The selected document{deleteCount !== 1 ? 's' : ''} will be permanently removed from the index.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => { setDeleteDialogOpen(false); setDeleteTarget(null); }}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmDelete}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineIcon />}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Documents;
