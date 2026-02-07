import React, { useState, useEffect, useCallback } from 'react';
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
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import SyncIcon from '@mui/icons-material/Sync';

// Define types based on backend (src/types.ts)
interface IndexStatus {
  source: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  lastSync: string | null;
  documentsIndexed: number;
  error?: string;
  lastError?: string;
  lastErrorAt?: string;
}

const API_BASE_URL = '/api/v1';

const Dashboard: React.FC = () => {
  const [statuses, setStatuses] = useState<IndexStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<Record<string, boolean>>({});

  const fetchStatuses = useCallback(async () => {
    // Only set loading true on first load or manual refresh, not polling
    if (statuses.length === 0) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/index/status`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: IndexStatus[] = await response.json();
      setStatuses(data);
    } catch (e: any) {
      if (statuses.length === 0) setError(`Failed to fetch statuses: ${e.message}`);
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [statuses.length]);

  useEffect(() => {
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, [fetchStatuses]);

  const triggerIndexing = async (source: string) => {
    setIndexingStatus(prev => ({ ...prev, [source]: true }));
    setError(null);
    try {
      const endpoint = source === 'all' ? `${API_BASE_URL}/index/all` : `${API_BASE_URL}/index/${source}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Status will be updated by polling
    } catch (e: any) {
      setError(`Failed to trigger indexing for ${source}: ${e.message}`);
    } finally {
      setTimeout(() => {
        setIndexingStatus(prev => ({ ...prev, [source]: false }));
      }, 1000);
    }
  };

  const resetCursor = async (source: string) => {
    if (!window.confirm(`Are you sure you want to reset the cursor for ${source}? This will cause a full re-index on the next run.`)) {
      return;
    }
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/index/${source}/reset`, {
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
    if (!window.confirm(`WARNING: This will DELETE ALL indexed data for ${source} from ChromaDB and reset its cursor. Are you absolutely sure?`)) {
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

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Typography variant="h4" component="h1">
          Collector Dashboard
        </Typography>
        <Box display="flex" gap={2}>
          <Button
            variant="contained"
            color="primary"
            startIcon={indexingStatus['all'] ? <CircularProgress size={20} color="inherit" /> : <PlayArrowIcon />}
            onClick={() => triggerIndexing('all')}
            disabled={loading || indexingStatus['all']}
          >
            Collect All Sources
          </Button>
          <Tooltip title="Refresh Status">
            <IconButton color="default" onClick={fetchStatuses} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {loading && statuses.length === 0 && <LinearProgress sx={{ my: 4 }} />}
      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {statuses.map((status) => (
          <Box key={status.source} sx={{ width: { xs: '100%', sm: 'calc(50% - 12px)', md: 'calc(33.333% - 16px)' } }}>
            <Paper elevation={2} sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
              {status.status === 'running' && (
                <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />
              )}

              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" component="h3" sx={{ fontWeight: 'bold' }}>
                  {status.source.toUpperCase()}
                </Typography>
                <ChipStatus status={status.status} />
              </Box>

              <Box sx={{ flexGrow: 1, mb: 3 }}>
                <InfoRow label="Files Collected" value={status.documentsIndexed.toLocaleString()} />
                <InfoRow
                  label="Last Sync"
                  value={status.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never'}
                />

                {status.lastError && (
                  <Alert severity="error" sx={{ mt: 2, fontSize: '0.85rem', py: 0 }}>
                    <Typography variant="caption" display="block" sx={{ fontWeight: 'bold' }}>
                      Error ({status.lastErrorAt ? new Date(status.lastErrorAt).toLocaleTimeString() : ''}):
                    </Typography>
                    {status.lastError}
                  </Alert>
                )}
              </Box>

              <Box display="flex" justifyContent="space-between" gap={1}>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={indexingStatus[status.source] ? <CircularProgress size={16} /> : <SyncIcon />}
                  onClick={() => triggerIndexing(status.source)}
                  disabled={status.status === 'running' || indexingStatus[status.source]}
                  fullWidth
                >
                  {status.status === 'running' ? 'Collecting' : 'Collect'}
                </Button>

                <Tooltip title="Reset Cursor (Force full re-collection next time)">
                  <IconButton
                    size="small"
                    color="warning"
                    onClick={() => resetCursor(status.source)}
                    disabled={status.status === 'running'}
                  >
                    <RefreshIcon />
                  </IconButton>
                </Tooltip>

                <Tooltip title="Delete All Files & Reset">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => deleteCollection(status.source)}
                    disabled={status.status === 'running'}
                  >
                    <DeleteForeverIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </Paper>
          </Box>
        ))}
        {statuses.length === 0 && !loading && (
          <Box sx={{ width: '100%' }}>
            <Alert severity="info">No status information available. Check backend connection.</Alert>
          </Box>
        )}
      </Box>
    </Box>
  );
};

// Helper Components
const ChipStatus = ({ status }: { status: string }) => {
  let color: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" = "default";
  let label = status.toUpperCase();

  switch (status) {
    case 'running': color = 'info'; break;
    case 'completed': color = 'success'; break;
    case 'error': color = 'error'; break;
    case 'idle': color = 'default'; break;
  }

  return (
    <Alert icon={false} severity={color === 'default' ? 'info' : color} sx={{ py: 0, px: 1, '.MuiAlert-message': { p: 0 } }}>
      <Typography variant="caption" fontWeight="bold">{label}</Typography>
    </Alert>
  );
};

const InfoRow = ({ label, value }: { label: string, value: string | number }) => (
  <Box display="flex" justifyContent="space-between" mb={1}>
    <Typography variant="body2" color="text.secondary">{label}:</Typography>
    <Typography variant="body2" fontWeight="medium">{value}</Typography>
  </Box>
);

export default Dashboard;
