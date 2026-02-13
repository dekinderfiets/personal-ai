import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Typography,
  Box,
  Paper,
  Button,
  CircularProgress,
  Alert,
  LinearProgress,
  IconButton,
  Tooltip,
  Chip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import SyncIcon from '@mui/icons-material/Sync';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import PowerOutlinedIcon from '@mui/icons-material/PowerOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import BugReportOutlined from '@mui/icons-material/BugReportOutlined';
import TagOutlined from '@mui/icons-material/TagOutlined';
import MailOutlined from '@mui/icons-material/MailOutlined';
import CloudOutlined from '@mui/icons-material/CloudOutlined';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import CodeOutlined from '@mui/icons-material/CodeOutlined';
import { DataSource, IndexStatus, SOURCE_COLORS, SOURCE_LABELS } from '../types/api';
import { useLocalSettings } from '../hooks/useLocalSettings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectorHealth {
  source: string;
  configured: boolean;
  connected: boolean;
  authenticated: boolean;
  latencyMs: number | null;
  error?: string;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE_URL = '/api/v1';

const SOURCE_ICONS: Record<DataSource, React.ReactElement> = {
  jira: <BugReportOutlined />,
  slack: <TagOutlined />,
  gmail: <MailOutlined />,
  drive: <CloudOutlined />,
  confluence: <MenuBookOutlined />,
  calendar: <CalendarMonthOutlined />,
  github: <CodeOutlined />,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatusChip: React.FC<{ status: IndexStatus['status'] }> = ({ status }) => {
  const config: Record<
    IndexStatus['status'],
    { label: string; color: 'default' | 'info' | 'success' | 'error' }
  > = {
    idle: { label: 'Idle', color: 'default' },
    running: { label: 'Running', color: 'info' },
    completed: { label: 'Completed', color: 'success' },
    error: { label: 'Error', color: 'error' },
  };
  const { label, color } = config[status];
  return (
    <Chip
      label={label}
      color={color}
      size="small"
      variant="outlined"
      sx={{ fontWeight: 600, fontSize: '0.7rem', height: 22 }}
    />
  );
};

interface HealthDotProps {
  source: string;
  healthStatuses: Record<string, ConnectorHealth>;
}

const HealthDot: React.FC<HealthDotProps> = ({ source, healthStatuses }) => {
  const health = healthStatuses[source];

  let color: string;
  let tooltip: string;

  if (!health) {
    color = '#9E9E9E';
    tooltip = 'Health not checked';
  } else if (!health.configured) {
    color = '#F44336';
    tooltip = 'Not configured';
  } else if (health.configured && health.connected && health.authenticated) {
    color = '#4CAF50';
    tooltip = `Connected${health.latencyMs != null ? ` (${health.latencyMs}ms)` : ''}`;
  } else if (!health.connected) {
    color = '#FF9800';
    tooltip = `Connection failed${health.error ? `: ${health.error}` : ''}`;
  } else {
    color = '#FF9800';
    tooltip = 'Authentication failed';
  }

  return (
    <Tooltip title={tooltip}>
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
    </Tooltip>
  );
};

interface SummaryCardProps {
  icon: React.ReactElement;
  label: string;
  value: string | number;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ icon, label, value }) => (
  <Paper sx={{ p: 3, flex: '1 1 0', minWidth: 160 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: 2,
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
          color: 'primary.main',
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </Typography>
      </Box>
    </Box>
  </Paper>
);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [statuses, setStatuses] = useState<IndexStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<Record<string, boolean>>({});
  const [healthStatuses, setHealthStatuses] = useState<Record<string, ConnectorHealth>>({});
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuSource, setMenuSource] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { getSettings } = useLocalSettings();

  // ---- Data Fetching ----

  const initialLoadDone = useRef(false);

  const fetchStatuses = useCallback(async () => {
    if (!initialLoadDone.current) setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/index/status`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: IndexStatus[] = await response.json();
      setStatuses(data);
      initialLoadDone.current = true;
    } catch (e: any) {
      if (!initialLoadDone.current) setError(`Failed to fetch statuses: ${e.message}`);
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/health`);
      if (!response.ok) return;
      const data: ConnectorHealth[] = await response.json();
      const map: Record<string, ConnectorHealth> = {};
      data.forEach((h) => {
        map[h.source] = h;
      });
      setHealthStatuses(map);
    } catch {
      // Health check is non-critical
    }
  }, []);

  useEffect(() => {
    fetchStatuses();
    fetchHealth();
    const interval = setInterval(fetchStatuses, 5000);
    return () => clearInterval(interval);
  }, [fetchStatuses, fetchHealth]);

  // Clear pending indexingStatus flags once the status poll confirms 'running'
  useEffect(() => {
    setIndexingStatus((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        if (!next[key]) continue;
        if (key === 'all') {
          // Clear 'all' once any source is running
          if (statuses.some((s) => s.status === 'running')) {
            next[key] = false;
            changed = true;
          }
        } else if (statuses.find((s) => s.source === key)?.status === 'running') {
          next[key] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [statuses]);

  // ---- Actions ----

  const triggerIndexing = async (source: string, extraBody?: Record<string, unknown>) => {
    setIndexingStatus((prev) => ({ ...prev, [source]: true }));
    setError(null);
    // Dismiss per-card error for the source(s) being collected
    setStatuses((prev) =>
      prev.map((s) =>
        source === 'all' || s.source === source
          ? { ...s, lastError: undefined, lastErrorAt: undefined }
          : s,
      ),
    );
    try {
      const endpoint =
        source === 'all' ? `${API_BASE_URL}/index/all` : `${API_BASE_URL}/index/${source}`;
      const settings = source !== 'all' ? getSettings(source as DataSource) : {};
      const body = { ...settings, ...extraBody };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Keep button disabled — cleared once status poll shows 'running'
    } catch (e: any) {
      setError(`Failed to trigger indexing for ${source}: ${e.message}`);
      setIndexingStatus((prev) => ({ ...prev, [source]: false }));
    }
  };

  const triggerQuickIndex = (source: string, daysBack: number) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    triggerIndexing(source, { startDate: startDate.toISOString().split('T')[0] });
  };

  const cancelWorkflow = async (source: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/workflows/index-${source}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setTimeout(fetchStatuses, 1000);
    } catch (e: any) {
      setError(`Failed to cancel workflow for ${source}: ${e.message}`);
    }
  };

  const resetCursor = async (source: string) => {
    if (
      !window.confirm(
        `Are you sure you want to reset the cursor for ${source}? This will cause a full re-index on the next run.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/index/${source}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await fetchStatuses();
    } catch (e: any) {
      setError(`Failed to reset cursor for ${source}: ${e.message}`);
    }
  };

  const deleteCollection = async (source: string) => {
    if (
      !window.confirm(
        `WARNING: This will DELETE ALL indexed data for ${source} and reset its cursor. Are you absolutely sure?`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/index/${source}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await fetchStatuses();
    } catch (e: any) {
      setError(`Failed to delete collection for ${source}: ${e.message}`);
    }
  };

  const exportConfig = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/config/export`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `collector-config-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(`Failed to export config: ${e.message}`);
    }
  };

  const importConfig = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const config = JSON.parse(text);
      const response = await fetch(`${API_BASE_URL}/analytics/config/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setError(null);
      alert(
        `Config imported! Sources: ${result.imported.join(', ')}${result.skipped.length ? `. Skipped: ${result.skipped.join(', ')}` : ''}`,
      );
    } catch (e: any) {
      setError(`Failed to import config: ${e.message}`);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ---- Overflow Menu ----

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, source: string) => {
    setMenuAnchor(event.currentTarget);
    setMenuSource(source);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuSource(null);
  };

  // ---- Computed Values ----

  const totalDocuments = statuses.reduce((sum, s) => sum + s.documentsIndexed, 0);
  const activeSources = statuses.filter((s) => s.documentsIndexed > 0 || s.status === 'running').length;
  const errorCount = statuses.filter((s) => s.status === 'error' || s.lastError).length;

  const lastSyncTime = statuses.reduce<string | null>((latest, s) => {
    if (!s.lastSync) return latest;
    if (!latest) return s.lastSync;
    return new Date(s.lastSync) > new Date(latest) ? s.lastSync : latest;
  }, null);

  // ---- Render ----

  return (
    <Box>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Typography variant="h5" fontWeight={600}>
          Dashboard
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton
              size="small"
              onClick={() => {
                fetchStatuses();
                fetchHealth();
              }}
              disabled={loading}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            size="small"
            startIcon={
              indexingStatus['all'] ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <PlayArrowIcon />
              )
            }
            onClick={() => triggerIndexing('all')}
            disabled={loading || indexingStatus['all']}
          >
            Collect All
          </Button>
        </Box>
      </Box>

      {/* Error banner */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Loading bar (initial load only) */}
      {loading && statuses.length === 0 && <LinearProgress sx={{ mb: 3 }} />}

      {/* Summary Stats Bar */}
      {statuses.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <SummaryCard
            icon={<StorageOutlinedIcon fontSize="small" />}
            label="Total Documents"
            value={totalDocuments}
          />
          <SummaryCard
            icon={<PowerOutlinedIcon fontSize="small" />}
            label="Active Sources"
            value={`${activeSources} / ${statuses.length}`}
          />
          <SummaryCard
            icon={<AccessTimeOutlinedIcon fontSize="small" />}
            label="Last Sync"
            value={lastSyncTime ? formatRelativeTime(lastSyncTime) : 'Never'}
          />
          {errorCount > 0 && (
            <SummaryCard
              icon={<WarningAmberOutlinedIcon fontSize="small" />}
              label="Errors"
              value={errorCount}
            />
          )}
        </Box>
      )}

      {/* Connector Grid */}
      {statuses.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              md: 'repeat(3, 1fr)',
            },
            gap: 2,
          }}
        >
          {statuses.map((status) => {
            const source = status.source as DataSource;
            const sourceColor = SOURCE_COLORS[source] || '#666';
            const isRunning = status.status === 'running';
            const icon = SOURCE_ICONS[source];

            return (
              <Paper
                key={status.source}
                sx={{
                  p: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Running indicator bar at top */}
                {isRunning ? (
                  <LinearProgress
                    sx={{
                      height: 3,
                      '& .MuiLinearProgress-bar': {
                        backgroundColor: sourceColor,
                      },
                      backgroundColor: alpha(sourceColor, 0.12),
                    }}
                  />
                ) : (
                  <Box sx={{ height: 3, bgcolor: alpha(sourceColor, 0.15) }} />
                )}

                {/* Card content */}
                <Box sx={{ p: 2.5 }}>
                  {/* Source header row */}
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 2,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 36,
                          height: 36,
                          borderRadius: 1.5,
                          bgcolor: alpha(sourceColor, 0.1),
                          color: sourceColor,
                          '& .MuiSvgIcon-root': { fontSize: 20 },
                        }}
                      >
                        {icon}
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle1" fontWeight={600}>
                          {SOURCE_LABELS[source] || status.source}
                        </Typography>
                        <HealthDot source={status.source} healthStatuses={healthStatuses} />
                      </Box>
                    </Box>
                    <StatusChip status={status.status} />
                  </Box>

                  {/* Metrics */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Documents
                      </Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {status.documentsIndexed.toLocaleString()}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Last sync
                      </Typography>
                      <Typography variant="body2" fontWeight={500}>
                        {status.lastSync ? formatRelativeTime(status.lastSync) : 'Never'}
                      </Typography>
                    </Box>
                    {healthStatuses[status.source]?.latencyMs != null && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="body2" color="text.secondary">
                          Latency
                        </Typography>
                        <Typography variant="body2" fontWeight={500}>
                          {healthStatuses[status.source].latencyMs}ms
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  {/* Error alert */}
                  {status.lastError && (
                    <Alert
                      severity="error"
                      sx={{
                        mb: 2,
                        py: 0.5,
                        px: 1.5,
                        '& .MuiAlert-message': { overflow: 'hidden' },
                      }}
                    >
                      <Typography
                        variant="caption"
                        fontWeight={600}
                        display="block"
                        sx={{ mb: 0.25 }}
                      >
                        {status.lastErrorAt
                          ? new Date(status.lastErrorAt).toLocaleTimeString()
                          : 'Error'}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {status.lastError}
                      </Typography>
                    </Alert>
                  )}

                  {/* Action row */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      pt: 1,
                      borderTop: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={
                        indexingStatus[status.source] ? (
                          <CircularProgress size={14} />
                        ) : (
                          <SyncIcon sx={{ fontSize: 16 }} />
                        )
                      }
                      onClick={() => triggerIndexing(status.source)}
                      disabled={isRunning || indexingStatus[status.source]}
                      sx={{ flex: 1 }}
                    >
                      {isRunning ? 'Collecting...' : 'Collect'}
                    </Button>
                    <Tooltip title="Quick: last 24 hours">
                      <span>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => triggerQuickIndex(status.source, 1)}
                          disabled={isRunning}
                          sx={{
                            minWidth: 36,
                            px: 1,
                            fontSize: '0.7rem',
                            color: 'text.secondary',
                            borderColor: 'divider',
                          }}
                        >
                          24h
                        </Button>
                      </span>
                    </Tooltip>
                    <Tooltip title="Quick: last 7 days">
                      <span>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => triggerQuickIndex(status.source, 7)}
                          disabled={isRunning}
                          sx={{
                            minWidth: 36,
                            px: 1,
                            fontSize: '0.7rem',
                            color: 'text.secondary',
                            borderColor: 'divider',
                          }}
                        >
                          7d
                        </Button>
                      </span>
                    </Tooltip>
                    {isRunning && (
                      <Tooltip title="Cancel indexing">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => cancelWorkflow(status.source)}
                        >
                          <StopCircleOutlinedIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="More actions">
                      <span>
                        <IconButton
                          size="small"
                          onClick={(e) => handleMenuOpen(e, status.source)}
                          disabled={isRunning}
                        >
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}

      {/* Empty state */}
      {statuses.length === 0 && !loading && (
        <Alert severity="info">
          No status information available. Check backend connection.
        </Alert>
      )}

      {/* Overflow menu (shared) */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            if (menuSource) navigate(`/settings?source=${menuSource}`);
            handleMenuClose();
          }}
        >
          <ListItemIcon>
            <SettingsOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Settings"
            secondary="Configure connector options"
            primaryTypographyProps={{ variant: 'body2' }}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuSource) resetCursor(menuSource);
            handleMenuClose();
          }}
        >
          <ListItemIcon>
            <RestartAltIcon fontSize="small" color="warning" />
          </ListItemIcon>
          <ListItemText
            primary="Reset Cursor"
            secondary="Force full re-collection next run"
            primaryTypographyProps={{ variant: 'body2' }}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuSource) deleteCollection(menuSource);
            handleMenuClose();
          }}
        >
          <ListItemIcon>
            <DeleteForeverIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText
            primary="Delete Collection"
            secondary="Remove all data and reset"
            primaryTypographyProps={{ variant: 'body2' }}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>
      </Menu>

      {/* Config Export / Import */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1,
          mt: 3,
          pt: 2,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={importConfig}
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={<FileUploadIcon />}
          onClick={() => fileInputRef.current?.click()}
          sx={{ color: 'text.secondary', borderColor: 'divider' }}
        >
          Import Config
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<FileDownloadIcon />}
          onClick={exportConfig}
          sx={{ color: 'text.secondary', borderColor: 'divider' }}
        >
          Export Config
        </Button>
      </Box>
    </Box>
  );
};

export default Dashboard;
