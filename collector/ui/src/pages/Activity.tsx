import React, { useState, useEffect, useRef } from 'react';
import {
  Typography,
  Box,
  Paper,
  Alert,
  LinearProgress,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ScheduleIcon from '@mui/icons-material/Schedule';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import PowerIcon from '@mui/icons-material/Power';
import CancelIcon from '@mui/icons-material/Cancel';
import { SOURCE_COLORS, SOURCE_LABELS, WorkflowInfo } from '../types/api';

const API_BASE_URL = '/api/v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IndexingRun {
  id?: string;
  source: string;
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

interface SourceStats {
  source: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  averageDurationMs: number;
  totalDocumentsProcessed: number;
}

interface SystemStats {
  sources: SourceStats[];
  totalDocumentsAcrossAllSources: number;
  totalRunsAcrossAllSources: number;
  recentRuns: IndexingRun[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

const formatTimeAgo = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
};

const getSourceColor = (source: string): string =>
  SOURCE_COLORS[source as keyof typeof SOURCE_COLORS] ?? '#666';

const getSourceLabel = (source: string): string =>
  SOURCE_LABELS[source as keyof typeof SOURCE_LABELS] ?? source.toUpperCase();

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'running':
      return <CircularProgress size={16} color="info" />;
    case 'completed':
      return <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />;
    case 'error':
      return <ErrorIcon sx={{ fontSize: 18, color: 'error.main' }} />;
    default:
      return <ScheduleIcon sx={{ fontSize: 18, color: 'text.secondary' }} />;
  }
};

interface MetricCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ icon, value, label }) => (
  <Paper
    sx={{
      p: 3,
      flex: '1 1 0',
      minWidth: 180,
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 0.5,
    }}
  >
    <Box sx={{ color: 'text.secondary', mb: 0.5 }}>{icon}</Box>
    <Typography variant="h4" fontWeight={700}>
      {value}
    </Typography>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
  </Paper>
);

const SourceChip: React.FC<{ source: string }> = ({ source }) => {
  const color = getSourceColor(source);
  return (
    <Chip
      size="small"
      label={getSourceLabel(source)}
      sx={{
        fontWeight: 600,
        bgcolor: alpha(color, 0.1),
        color,
        borderColor: alpha(color, 0.3),
      }}
      variant="outlined"
    />
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const WORKFLOW_STATUS_COLORS: Record<string, string> = {
  RUNNING: '#2196F3',
  COMPLETED: '#4CAF50',
  FAILED: '#F44336',
  CANCELLED: '#9E9E9E',
  TERMINATED: '#FF9800',
  TIMED_OUT: '#FF5722',
};

const WorkflowStatusChip: React.FC<{ status: string }> = ({ status }) => {
  const color = WORKFLOW_STATUS_COLORS[status] ?? '#666';
  return (
    <Chip
      size="small"
      label={status}
      sx={{
        fontWeight: 600,
        fontSize: '0.7rem',
        height: 22,
        bgcolor: alpha(color, 0.1),
        color,
        borderColor: alpha(color, 0.3),
      }}
      variant="outlined"
    />
  );
};

const Activity: React.FC = () => {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastSseFetchRef = useRef<number>(0);

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/stats`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: SystemStats = await response.json();
      setStats(data);
      setError(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Failed to load analytics: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkflows = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/workflows/recent?limit=20`);
      if (!response.ok) return;
      const data: WorkflowInfo[] = await response.json();
      setWorkflows(data);
    } catch {
      // Network error — will retry on next poll
    }
  };

  const cancelWorkflow = async (workflowId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/workflows/${workflowId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      fetchWorkflows();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Failed to cancel workflow: ${message}`);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchWorkflows();

    // SSE connection for real-time updates
    try {
      const es = new EventSource(`${API_BASE_URL}/events/indexing`);
      eventSourceRef.current = es;

      es.onopen = () => setSseConnected(true);
      es.onmessage = () => {
        const now = Date.now();
        if (now - lastSseFetchRef.current < 5000) return;
        lastSseFetchRef.current = now;
        fetchStats();
        fetchWorkflows();
      };
      es.onerror = () => {
        setSseConnected(false);
        es.close();
      };
    } catch {
      setSseConnected(false);
    }

    // Polling fallback
    const interval = setInterval(() => {
      fetchStats();
      fetchWorkflows();
    }, 10000);

    return () => {
      clearInterval(interval);
      eventSourceRef.current?.close();
    };
  }, []);

  // Derived values
  const activeSources = stats
    ? stats.sources.filter((s) => s.successfulRuns > 0).length
    : 0;
  const totalSources = stats ? stats.sources.length : 0;

  return (
    <Box>
      {/* ---------------------------------------------------------------- */}
      {/* Header                                                           */}
      {/* ---------------------------------------------------------------- */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={4}
      >
        <Typography variant="h5" fontWeight={600}>
          Activity
        </Typography>

        <Box display="flex" alignItems="center" gap={1.5}>
          <Chip
            icon={
              <FiberManualRecordIcon
                sx={{
                  fontSize: '10px !important',
                  color: sseConnected ? 'success.main' : 'text.secondary',
                }}
              />
            }
            label={sseConnected ? 'Live' : 'Polling'}
            size="small"
            variant="outlined"
            color={sseConnected ? 'success' : 'default'}
          />
          <Tooltip title="Refresh">
            <IconButton onClick={fetchStats} size="small">
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Loading & error states */}
      {loading && <LinearProgress sx={{ mb: 3 }} />}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {stats && (
        <>
          {/* -------------------------------------------------------------- */}
          {/* Summary Cards                                                   */}
          {/* -------------------------------------------------------------- */}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 2,
              mb: 4,
            }}
          >
            <MetricCard
              icon={<DescriptionOutlinedIcon />}
              value={stats.totalDocumentsAcrossAllSources.toLocaleString()}
              label="Total Documents"
            />
            <MetricCard
              icon={<SyncAltIcon />}
              value={stats.totalRunsAcrossAllSources.toLocaleString()}
              label="Total Runs"
            />
            <MetricCard
              icon={<PowerIcon />}
              value={`${activeSources}/${totalSources}`}
              label="Active Sources"
            />
          </Box>

          {/* -------------------------------------------------------------- */}
          {/* Source Statistics                                                */}
          {/* -------------------------------------------------------------- */}
          <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
            Source Statistics
          </Typography>

          <TableContainer component={Paper} sx={{ p: 0, mb: 4 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Source</TableCell>
                  <TableCell align="right">Runs</TableCell>
                  <TableCell align="right">Successful</TableCell>
                  <TableCell align="right">Failed</TableCell>
                  <TableCell align="right">Docs Processed</TableCell>
                  <TableCell align="right">Avg Duration</TableCell>
                  <TableCell>Last Run</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stats.sources.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ py: 3 }}
                      >
                        No source statistics available
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  stats.sources.map((source, idx) => {
                    const color = getSourceColor(source.source);
                    return (
                      <TableRow
                        key={source.source}
                        sx={{
                          bgcolor: (theme) =>
                            idx % 2 === 1
                              ? alpha(
                                  theme.palette.action.hover,
                                  theme.palette.mode === 'dark' ? 0.04 : 0.025,
                                )
                              : 'transparent',
                          '&:last-child td': { borderBottom: 0 },
                        }}
                      >
                        <TableCell>
                          <Box
                            display="flex"
                            alignItems="center"
                            gap={1}
                          >
                            <Box
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                bgcolor: color,
                                flexShrink: 0,
                              }}
                            />
                            <Typography variant="body2" fontWeight={600}>
                              {getSourceLabel(source.source)}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          {source.totalRuns}
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            variant="body2"
                            sx={{ color: 'success.main' }}
                          >
                            {source.successfulRuns}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            variant="body2"
                            sx={{
                              color:
                                source.failedRuns > 0
                                  ? 'error.main'
                                  : 'text.secondary',
                            }}
                          >
                            {source.failedRuns}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {source.totalDocumentsProcessed.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          {source.averageDurationMs
                            ? formatDuration(source.averageDurationMs)
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {source.lastRunAt
                              ? formatTimeAgo(source.lastRunAt)
                              : 'Never'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* -------------------------------------------------------------- */}
          {/* Recent Runs                                                     */}
          {/* -------------------------------------------------------------- */}
          <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
            Recent Runs
          </Typography>

          <TableContainer component={Paper} sx={{ p: 0 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 48 }}>Status</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell align="right">Duration</TableCell>
                  <TableCell align="right">Processed</TableCell>
                  <TableCell align="right">New</TableCell>
                  <TableCell align="right">Updated</TableCell>
                  <TableCell align="right">Skipped</TableCell>
                  <TableCell>Error</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stats.recentRuns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ py: 3 }}
                      >
                        No indexing runs recorded yet
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  stats.recentRuns.map((run, i) => (
                    <TableRow
                      key={run.id || i}
                      sx={{
                        bgcolor: (theme) =>
                          i % 2 === 1
                            ? alpha(
                                theme.palette.action.hover,
                                theme.palette.mode === 'dark' ? 0.04 : 0.025,
                              )
                            : 'transparent',
                        '&:last-child td': { borderBottom: 0 },
                      }}
                    >
                      <TableCell>
                        <Box display="flex" alignItems="center">
                          <StatusIcon status={run.status} />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <SourceChip source={run.source} />
                      </TableCell>
                      <TableCell>
                        <Tooltip
                          title={new Date(run.startedAt).toLocaleString()}
                        >
                          <Typography variant="body2">
                            {formatTimeAgo(run.startedAt)}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" color="text.secondary">
                          {run.durationMs
                            ? formatDuration(run.durationMs)
                            : '-'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {run.documentsProcessed}
                      </TableCell>
                      <TableCell align="right">
                        <Typography
                          variant="body2"
                          sx={{
                            color:
                              run.documentsNew > 0
                                ? 'success.main'
                                : 'text.secondary',
                          }}
                        >
                          {run.documentsNew}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography
                          variant="body2"
                          sx={{
                            color:
                              run.documentsUpdated > 0
                                ? 'info.main'
                                : 'text.secondary',
                          }}
                        >
                          {run.documentsUpdated}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" color="text.secondary">
                          {run.documentsSkipped}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {run.error ? (
                          <Tooltip title={run.error}>
                            <Typography
                              variant="caption"
                              color="error"
                              sx={{
                                maxWidth: 200,
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {run.error}
                            </Typography>
                          </Tooltip>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* -------------------------------------------------------------- */}
          {/* Workflow History (Temporal)                                      */}
          {/* -------------------------------------------------------------- */}
          {workflows.length > 0 && (
            <>
              <Typography variant="h5" fontWeight={600} sx={{ mt: 4, mb: 2 }}>
                Workflow History
              </Typography>

              <TableContainer component={Paper} sx={{ p: 0 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Status</TableCell>
                      <TableCell>Workflow ID</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Started</TableCell>
                      <TableCell align="right">Duration</TableCell>
                      <TableCell align="center">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {workflows.map((wf, i) => (
                      <TableRow
                        key={`${wf.workflowId}-${wf.runId}`}
                        sx={{
                          bgcolor: (theme) =>
                            i % 2 === 1
                              ? alpha(
                                  theme.palette.action.hover,
                                  theme.palette.mode === 'dark' ? 0.04 : 0.025,
                                )
                              : 'transparent',
                          '&:last-child td': { borderBottom: 0 },
                        }}
                      >
                        <TableCell>
                          <WorkflowStatusChip status={wf.status} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem">
                            {wf.workflowId}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {wf.type}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Tooltip title={new Date(wf.startTime).toLocaleString()}>
                            <Typography variant="body2">
                              {formatTimeAgo(wf.startTime)}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" color="text.secondary">
                            {wf.executionTime
                              ? formatDuration(wf.executionTime)
                              : wf.status === 'RUNNING'
                                ? 'running...'
                                : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          {wf.status === 'RUNNING' && (
                            <Tooltip title="Cancel workflow">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => cancelWorkflow(wf.workflowId)}
                              >
                                <CancelIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </>
      )}
    </Box>
  );
};

export default Activity;
