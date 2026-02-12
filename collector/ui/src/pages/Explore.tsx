import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Typography, Box, Paper, Button, Alert, Chip,
  Breadcrumbs, ToggleButtonGroup, ToggleButton, Divider, IconButton, Tooltip,
  List, ListItemButton, ListItemText, LinearProgress, Stack,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import PeopleIcon from '@mui/icons-material/People';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import SearchIcon from '@mui/icons-material/Search';
import ExploreIcon from '@mui/icons-material/Explore';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DescriptionIcon from '@mui/icons-material/Description';
import PersonIcon from '@mui/icons-material/Person';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useParams, useNavigate } from 'react-router-dom';
import { SearchResult, SOURCE_COLORS, SOURCE_LABELS } from '../types/api';

const API_BASE_URL = '/api/v1';

type Direction = 'prev' | 'next' | 'siblings' | 'parent' | 'children';
type Scope = 'chunk' | 'datapoint' | 'context';

interface NavigationState {
  hasPrev: boolean;
  hasNext: boolean;
  parentId?: string | null;
  contextType?: string;
  totalSiblings?: number;
}

const Explore: React.FC = () => {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();

  const [current, setCurrent] = useState<SearchResult | null>(null);
  const [related, setRelated] = useState<SearchResult[]>([]);
  const [navState, setNavState] = useState<NavigationState>({ hasPrev: false, hasNext: false });
  const [scope, setScope] = useState<Scope>('datapoint');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const pendingDirectionRef = useRef<Direction>('siblings');

  const fetchNavigation = useCallback(async (docId: string, direction: Direction = 'siblings', navScope: Scope = scope) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        direction,
        scope: navScope,
        limit: '10',
      });
      const response = await fetch(`${API_BASE_URL}/search/navigate/${encodeURIComponent(docId)}?${params}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setCurrent(data.current);
      setRelated(data.related || []);
      setNavState(data.navigation || { hasPrev: false, hasNext: false });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Navigation failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    if (documentId) {
      const direction = pendingDirectionRef.current;
      pendingDirectionRef.current = 'siblings';
      fetchNavigation(decodeURIComponent(documentId), direction);
    }
  }, [documentId, fetchNavigation]);

  const navigateTo = (docId: string, direction: Direction = 'siblings') => {
    if (current) {
      setHistory(prev => [...prev, current.id]);
    }
    pendingDirectionRef.current = direction;
    navigate(`/explore/${encodeURIComponent(docId)}`);
  };

  const handleDirection = (direction: Direction) => {
    if (!current) return;
    // Parent navigation should actually navigate to the parent document
    if (direction === 'parent' && navState.parentId) {
      navigateTo(navState.parentId, 'children');
      return;
    }
    fetchNavigation(current.id, direction, scope);
  };

  const goBack = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    pendingDirectionRef.current = 'siblings';
    navigate(`/explore/${encodeURIComponent(prev)}`);
  };

  const getTitle = (item: SearchResult): string => {
    const m = item.metadata;
    return (m.title as string) || (m.subject as string) || (m.name as string) || item.id;
  };

  const getTimestamp = (item: SearchResult): string => {
    const m = item.metadata;
    const d = (m.updatedAt || m.date || m.timestamp || m.createdAt || '') as string;
    return d ? new Date(d).toLocaleString() : '';
  };

  /**
   * Build the middle breadcrumb segments for the current document.
   * Each connector has different hierarchy structures, so we need per-source logic.
   * Clickable segments navigate to the parent document when possible.
   */
  const buildBreadcrumbMiddle = (
    item: SearchResult,
    nav: NavigationState,
    onNavigate: (docId: string, direction?: Direction) => void,
  ): React.ReactNode[] => {
    const m = item.metadata;
    const crumbs: React.ReactNode[] = [];

    const clickableChip = (label: string, docId: string, key: string) => (
      <Chip
        key={key}
        label={label}
        size="small"
        variant="outlined"
        clickable
        onClick={() => onNavigate(docId, 'children')}
        sx={{ cursor: 'pointer' }}
      />
    );

    const staticChip = (label: string, key: string) => (
      <Chip key={key} label={label} size="small" variant="outlined" />
    );

    switch (item.source) {
      case 'jira': {
        // Jira: Project > [Parent Issue] > current
        if (m.project) crumbs.push(staticChip(String(m.project), 'project'));
        // If this is a comment, show the parent issue as clickable
        if (m.type === 'comment' && nav.parentId) {
          // Extract issue key from parentId (it IS the issue key for Jira)
          const issueKey = String(nav.parentId);
          crumbs.push(clickableChip(issueKey, nav.parentId, 'parent-issue'));
        }
        break;
      }
      case 'slack': {
        // Slack: #channel > [thread] > current
        if (m.channel) crumbs.push(staticChip(`#${String(m.channel)}`, 'channel'));
        // If this is a thread reply, show the parent message as clickable
        if (m.type === 'thread_reply' && nav.parentId) {
          crumbs.push(clickableChip('Thread', nav.parentId, 'parent-thread'));
        }
        break;
      }
      case 'gmail': {
        // Gmail: Thread > current
        if (m.threadId) crumbs.push(staticChip(`Thread ${String(m.threadId).slice(0, 8)}...`, 'thread'));
        break;
      }
      case 'drive': {
        // Drive: path segments as breadcrumbs
        if (m.path) {
          const pathStr = String(m.path);
          const segments = pathStr.split('/').filter(Boolean);
          // Show folder segments (all except the last which is the file name)
          const folderSegments = segments.slice(0, -1);
          for (let i = 0; i < folderSegments.length; i++) {
            crumbs.push(staticChip(folderSegments[i], `path-${i}`));
          }
        }
        break;
      }
      case 'confluence': {
        // Confluence: Space > [ancestors] > [parent page] > current
        if (m.space) {
          const spaceLabel = m.spaceName ? String(m.spaceName) : String(m.space);
          crumbs.push(staticChip(spaceLabel, 'space'));
        }
        // Show ancestors if available (they're page titles in order)
        if (m.ancestors) {
          try {
            const ancestors = typeof m.ancestors === 'string' ? JSON.parse(m.ancestors) : m.ancestors;
            if (Array.isArray(ancestors)) {
              for (let i = 0; i < ancestors.length; i++) {
                crumbs.push(staticChip(String(ancestors[i]), `ancestor-${i}`));
              }
            }
          } catch {
            // ancestors might not be parseable; skip
          }
        }
        // If this is a comment, show the parent page as clickable
        if (m.type === 'comment' && nav.parentId) {
          crumbs.push(clickableChip('Parent Page', nav.parentId, 'parent-page'));
        }
        break;
      }
      case 'calendar': {
        // Calendar: just show "Calendar" context
        crumbs.push(staticChip('Events', 'calendar'));
        break;
      }
      case 'github': {
        // GitHub: repo > [PR/Issue] > current
        if (m.repo) crumbs.push(staticChip(String(m.repo), 'repo'));
        // If this is a review or comment, show the parent PR as clickable
        if ((m.type === 'pr_review' || m.type === 'pr_comment') && nav.parentId) {
          const prLabel = m.number ? `PR #${m.number}` : 'Pull Request';
          crumbs.push(clickableChip(prLabel, nav.parentId, 'parent-pr'));
        }
        break;
      }
    }

    return crumbs;
  };

  // -- Empty state: no documentId --
  if (!documentId) {
    return (
      <Box>
        <Typography variant="h5" fontWeight={600} sx={{ mb: 3 }}>
          Explore
        </Typography>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            py: 10,
          }}
        >
          <Box
            sx={(theme) => ({
              width: 72,
              height: 72,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: alpha(theme.palette.primary.main, 0.08),
              mb: 3,
            })}
          >
            <ExploreIcon sx={(theme) => ({ fontSize: 36, color: theme.palette.primary.main })} />
          </Box>
          <Typography variant="h6" sx={{ mb: 1 }}>
            No Document Selected
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 420, textAlign: 'center' }}>
            Select a document from Search results to start exploring. Click the explore button on any search result to navigate through related data.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<SearchIcon />}
            onClick={() => navigate('/search')}
          >
            Go to Search
          </Button>
        </Box>
      </Box>
    );
  }

  // -- Main explore view --
  return (
    <Box>
      {/* Page Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h5" fontWeight={600}>
            Explore
          </Typography>
          {history.length > 0 && (
            <Tooltip title={`Back (${history.length} in history)`}>
              <IconButton size="small" onClick={goBack} sx={{ ml: 0.5 }}>
                <ArrowBackIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<SearchIcon />}
          onClick={() => navigate('/search')}
        >
          Search
        </Button>
      </Box>

      {/* Control Bar */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          {/* Navigation Arrows */}
          <Stack direction="row" spacing={0.5} sx={(theme) => ({
            p: 0.5,
            borderRadius: 1,
            backgroundColor: alpha(theme.palette.primary.main, 0.04),
          })}>
            <Tooltip title="Previous">
              <span>
                <IconButton
                  size="small"
                  onClick={() => handleDirection('prev')}
                  disabled={!navState.hasPrev || loading}
                  sx={(theme) => ({
                    color: theme.palette.primary.main,
                    '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.12) },
                  })}
                >
                  <ArrowBackIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Next">
              <span>
                <IconButton
                  size="small"
                  onClick={() => handleDirection('next')}
                  disabled={!navState.hasNext || loading}
                  sx={(theme) => ({
                    color: theme.palette.primary.main,
                    '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.12) },
                  })}
                >
                  <ArrowForwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />

            <Tooltip title="Parent">
              <span>
                <IconButton
                  size="small"
                  onClick={() => handleDirection('parent')}
                  disabled={!navState.parentId || loading}
                  sx={(theme) => ({
                    color: theme.palette.secondary.main,
                    '&:hover': { backgroundColor: alpha(theme.palette.secondary.main, 0.12) },
                  })}
                >
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Children">
              <span>
                <IconButton
                  size="small"
                  onClick={() => handleDirection('children')}
                  disabled={loading}
                  sx={(theme) => ({
                    color: theme.palette.secondary.main,
                    '&:hover': { backgroundColor: alpha(theme.palette.secondary.main, 0.12) },
                  })}
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />

            <Tooltip title="Siblings">
              <span>
                <IconButton
                  size="small"
                  onClick={() => handleDirection('siblings')}
                  disabled={loading}
                  sx={(theme) => ({
                    color: theme.palette.info.main,
                    '&:hover': { backgroundColor: alpha(theme.palette.info.main, 0.12) },
                  })}
                >
                  <PeopleIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          {/* Scope Toggle */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Scope
            </Typography>
            <ToggleButtonGroup
              value={scope}
              exclusive
              onChange={(_, val) => {
                if (val) {
                  setScope(val);
                  if (current) fetchNavigation(current.id, 'siblings', val);
                }
              }}
              size="small"
            >
              <ToggleButton value="chunk">Chunk</ToggleButton>
              <ToggleButton value="datapoint">Datapoint</ToggleButton>
              <ToggleButton value="context">Context</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* Context Chips */}
          {(navState.contextType || navState.totalSiblings != null) && (
            <Stack direction="row" spacing={0.75} sx={{ ml: 'auto' }}>
              {navState.contextType && (
                <Chip
                  icon={<AccountTreeIcon />}
                  label={navState.contextType}
                  size="small"
                  variant="outlined"
                />
              )}
              {navState.totalSiblings != null && (
                <Chip
                  icon={<DescriptionIcon />}
                  label={`${navState.totalSiblings} siblings`}
                  size="small"
                  variant="outlined"
                />
              )}
            </Stack>
          )}
        </Box>

        {/* Breadcrumb */}
        {current && (
          <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
            <Breadcrumbs separator={<NavigateNextIcon sx={{ fontSize: 16 }} />}>
              <Chip
                label={SOURCE_LABELS[current.source] || current.source}
                size="small"
                sx={{
                  backgroundColor: SOURCE_COLORS[current.source],
                  color: '#fff',
                  fontWeight: 600,
                }}
              />
              {buildBreadcrumbMiddle(current, navState, navigateTo)}
              <Typography variant="body2" color="text.primary" fontWeight={500}>
                {getTitle(current)}
              </Typography>
            </Breadcrumbs>
          </Box>
        )}
      </Paper>

      {/* Loading / Error */}
      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Split Layout */}
      <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>

        {/* Left Panel (2/3): Current Document */}
        <Box sx={{ flex: 2, minWidth: 0 }}>
          {current ? (
            <Paper sx={{ p: 3 }}>
              {/* Document Header */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h5" fontWeight={600} sx={{ mb: 0.75, wordBreak: 'break-word' }}>
                    {getTitle(current)}
                  </Typography>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    {getTimestamp(current) && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="caption" color="text.secondary">
                          {getTimestamp(current)}
                        </Typography>
                      </Box>
                    )}
                    {Boolean(current.metadata.author) && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <PersonIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="caption" color="text.secondary">
                          {String(current.metadata.author)}
                        </Typography>
                      </Box>
                    )}
                  </Stack>
                </Box>
                {Boolean(current.metadata.url) && (
                  <Tooltip title="Open original">
                    <IconButton
                      component="a"
                      href={current.metadata.url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="small"
                      sx={(theme) => ({
                        color: theme.palette.secondary.main,
                        border: `1px solid ${alpha(theme.palette.secondary.main, 0.3)}`,
                        '&:hover': {
                          backgroundColor: alpha(theme.palette.secondary.main, 0.08),
                          borderColor: theme.palette.secondary.main,
                        },
                      })}
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>

              <Divider sx={{ my: 2 }} />

              {/* Document Content */}
              <Box
                sx={(theme) => ({
                  p: 2.5,
                  borderRadius: 1,
                  backgroundColor: alpha(theme.palette.background.default, 0.6),
                  border: `1px solid ${theme.palette.divider}`,
                })}
              >
                <Typography
                  variant="body1"
                  sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, wordBreak: 'break-word' }}
                >
                  {current.content}
                </Typography>
              </Box>

              {/* Metadata Section */}
              <Box sx={{ mt: 2.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Metadata
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {Object.entries(current.metadata).map(([key, value]) => {
                    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
                    if (['search_context', 'content'].includes(key)) return null;
                    const strVal = String(value);
                    if (strVal.length > 80) return null;
                    return (
                      <Chip
                        key={key}
                        label={`${key}: ${strVal}`}
                        size="small"
                        variant="outlined"
                      />
                    );
                  })}
                </Box>
              </Box>
            </Paper>
          ) : (
            !loading && (
              <Paper sx={{ p: 3 }}>
                <Alert severity="info" variant="outlined">
                  No document loaded.
                </Alert>
              </Paper>
            )
          )}
        </Box>

        {/* Right Panel (1/3): Related Documents */}
        <Box sx={{ flex: 1, minWidth: 280 }}>
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h6">
                Related
              </Typography>
              <Chip
                label={related.length}
                size="small"
                sx={(theme) => ({
                  fontWeight: 600,
                  minWidth: 28,
                  backgroundColor: alpha(theme.palette.primary.main, 0.08),
                  color: theme.palette.primary.main,
                })}
              />
            </Box>

            {related.length === 0 && !loading && (
              <Box
                sx={{
                  py: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  No related documents found.
                </Typography>
              </Box>
            )}

            <List disablePadding>
              {related.map((item) => (
                <ListItemButton
                  key={item.id}
                  onClick={() => navigateTo(item.id)}
                  sx={(theme) => ({
                    borderRadius: 1,
                    mb: 0.5,
                    px: 1.5,
                    py: 1,
                    border: `1px solid transparent`,
                    '&:hover': {
                      backgroundColor: alpha(theme.palette.primary.main, 0.04),
                      borderColor: theme.palette.divider,
                    },
                  })}
                >
                  <ListItemText
                    disableTypography
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                        <Chip
                          label={SOURCE_LABELS[item.source] || item.source}
                          size="small"
                          sx={{
                            backgroundColor: SOURCE_COLORS[item.source],
                            color: '#fff',
                            fontSize: '0.65rem',
                            fontWeight: 600,
                            height: 20,
                            flexShrink: 0,
                          }}
                        />
                        <Typography variant="body2" noWrap fontWeight={500}>
                          {getTitle(item)}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      getTimestamp(item) ? (
                        <Typography variant="caption" color="text.secondary" sx={{ pl: 0.25 }}>
                          {getTimestamp(item)}
                        </Typography>
                      ) : null
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
};

export default Explore;
