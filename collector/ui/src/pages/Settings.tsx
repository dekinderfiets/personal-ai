import React, { useState, useEffect } from 'react';
import {
  Typography, Box, Paper, Button, TextField, Alert, Autocomplete,
  LinearProgress, Chip, Switch, FormControlLabel, CircularProgress,
  Collapse, List, ListItemButton, ListItemIcon, ListItemText,
  IconButton, Tooltip, Snackbar, FormControl, Checkbox,
  Tabs, Tab,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useSearchParams } from 'react-router-dom';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import TagOutlinedIcon from '@mui/icons-material/TagOutlined';
import MailOutlinedIcon from '@mui/icons-material/MailOutlined';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DateRangeOutlinedIcon from '@mui/icons-material/DateRangeOutlined';
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import StarOutlinedIcon from '@mui/icons-material/StarOutlined';
import FolderSharedOutlinedIcon from '@mui/icons-material/FolderSharedOutlined';
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined';
import {
  DataSource, ALL_SOURCES, SOURCE_LABELS, SOURCE_COLORS, ConnectorSettings,
} from '../types/api';
import { useLocalSettings } from '../hooks/useLocalSettings';
import { useEnabledSources } from '../hooks/useEnabledSources';

const API_BASE_URL = '/api/v1';

/* ---------- source icon map ---------- */
const SOURCE_ICONS: Record<DataSource, React.ReactElement> = {
  jira: <BugReportOutlinedIcon />,
  slack: <TagOutlinedIcon />,
  gmail: <MailOutlinedIcon />,
  drive: <CloudOutlinedIcon />,
  confluence: <MenuBookOutlinedIcon />,
  calendar: <CalendarMonthOutlinedIcon />,
};

/* ---------- folder tree type ---------- */
interface FolderNode {
  id: string;
  name: string;
  children?: FolderNode[];
  loaded?: boolean;
}

/* ====================================================================== */
/*  Settings Page                                                          */
/* ====================================================================== */
const Settings: React.FC = () => {
  const theme = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedSource, setSelectedSource] = useState<DataSource | ''>(() => {
    const src = searchParams.get('source');
    return src && ALL_SOURCES.includes(src as DataSource) ? (src as DataSource) : '';
  });
  const { getSettings, updateSettings, applyDateToAll, mergeServerSettings } = useLocalSettings();
  const { isEnabled, setSourceEnabled } = useEnabledSources();

  // Sync selectedSource when navigating to /settings?source=xxx
  useEffect(() => {
    const src = searchParams.get('source');
    if (src && ALL_SOURCES.includes(src as DataSource)) {
      setSelectedSource(src as DataSource);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  /* --- ui state --- */
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingDiscovery, setLoadingDiscovery] = useState(false);
  const [indexingSource, setIndexingSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);

  /* --- discovery options --- */
  const [jiraProjects, setJiraProjects] = useState<any[]>([]);
  const [slackChannels, setSlackChannels] = useState<any[]>([]);
  const [driveFolders, setDriveFolders] = useState<FolderNode[]>([]);
  const [confluenceSpaces, setConfluenceSpaces] = useState<any[]>([]);
  const [calendars, setCalendars] = useState<any[]>([]);
  const [gmailLabels, setGmailLabels] = useState<any[]>([]);

  /* --- drive folder tree state --- */
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());

  /* --- drive tabbed views state --- */
  const [driveTab, setDriveTab] = useState(0);
  const [sharedDrives, setSharedDrives] = useState<Array<{ id: string; name: string }>>([]);
  const [sharedDriveFolders, setSharedDriveFolders] = useState<Record<string, FolderNode[]>>({});
  const [expandedSharedDriveFolders, setExpandedSharedDriveFolders] = useState<Set<string>>(new Set());
  const [selectedSharedDriveFolderIds, setSelectedSharedDriveFolderIds] = useState<Set<string>>(new Set());
  const [loadingSharedDriveFolders, setLoadingSharedDriveFolders] = useState<Set<string>>(new Set());

  const currentSettings = selectedSource ? getSettings(selectedSource) : null;

  /* --- helpers --- */
  const handleSettingChange = (key: string, value: unknown) => {
    if (!selectedSource) return;
    updateSettings(selectedSource, { [key]: value } as Partial<ConnectorSettings>);
  };

  const showSnackbar = (msg: string) => {
    setSuccess(msg);
    setSnackbarOpen(true);
  };

  /* --- check if a source has any saved config (empty = index all) --- */
  const isSourceConfigured = (source: DataSource): boolean => {
    const s = getSettings(source);
    return !!s && Object.keys(s).length > 0;
  };

  /* ================================================================== */
  /*  Data loading                                                       */
  /* ================================================================== */

  useEffect(() => {
    if (selectedSource) {
      setError(null);
      setSuccess(null);
      loadServerSettings(selectedSource);
      loadDiscoveryData(selectedSource);
    }
  }, [selectedSource]);

  useEffect(() => {
    if (selectedSource === 'drive' && currentSettings?.folderIds) {
      setSelectedFolderIds(new Set(currentSettings.folderIds));
    }
  }, [selectedSource, currentSettings?.folderIds]);

  useEffect(() => {
    if (selectedSource === 'drive' && currentSettings?.sharedDriveFolderIds) {
      setSelectedSharedDriveFolderIds(new Set(currentSettings.sharedDriveFolderIds));
    }
  }, [selectedSource, currentSettings?.sharedDriveFolderIds]);

  const loadServerSettings = async (source: DataSource) => {
    setLoadingSettings(true);
    try {
      const res = await fetch(`${API_BASE_URL}/index/settings/${source}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      mergeServerSettings(source, data || {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to load settings: ${msg}`);
    } finally {
      setLoadingSettings(false);
    }
  };

  const loadDiscoveryData = async (source: DataSource) => {
    setLoadingDiscovery(true);
    try {
      let endpoint = '';
      if (source === 'jira') endpoint = 'discovery/jira/projects';
      else if (source === 'slack') endpoint = 'discovery/slack/channels';
      else if (source === 'drive') endpoint = 'discovery/drive/folders';
      else if (source === 'confluence') endpoint = 'discovery/confluence/spaces';
      else if (source === 'calendar') endpoint = 'discovery/calendar';
      else if (source === 'gmail') endpoint = 'discovery/gmail/labels';

      if (endpoint) {
        const res = await fetch(`${API_BASE_URL}/index/${endpoint}`);
        if (!res.ok) throw new Error(`Failed to load discovery data (status: ${res.status})`);
        const data = await res.json();

        if (source === 'jira') setJiraProjects(data);
        else if (source === 'slack') setSlackChannels(data);
        else if (source === 'drive') {
          setDriveFolders(data.map((f: any) => ({ id: f.id, name: f.name, loaded: false })));
          // Also fetch shared drives
          try {
            const sdRes = await fetch(`${API_BASE_URL}/index/discovery/drive/shared-drives`);
            if (sdRes.ok) {
              const sdData = await sdRes.json();
              setSharedDrives(sdData);
            }
          } catch (e) {
            console.warn('Failed to load shared drives:', e);
          }
        }
        else if (source === 'confluence') setConfluenceSpaces(data);
        else if (source === 'calendar') setCalendars(data);
        else if (source === 'gmail') setGmailLabels(data);
      }
    } catch (e: unknown) {
      console.warn(`Discovery failed for ${source}:`, e);
    } finally {
      setLoadingDiscovery(false);
    }
  };

  /* --- drive sub-folders --- */
  const loadSubFolders = async (parentId: string) => {
    setLoadingFolders(prev => new Set(prev).add(parentId));
    try {
      const res = await fetch(`${API_BASE_URL}/index/discovery/drive/folders?parentId=${parentId}`);
      if (!res.ok) throw new Error('Failed to load subfolders');
      const data = await res.json();
      const children: FolderNode[] = data.map((f: any) => ({ id: f.id, name: f.name, loaded: false }));

      setDriveFolders(prev => {
        const updateNode = (nodes: FolderNode[]): FolderNode[] =>
          nodes.map(node => {
            if (node.id === parentId) return { ...node, children, loaded: true };
            if (node.children) return { ...node, children: updateNode(node.children) };
            return node;
          });
        return updateNode(prev);
      });
    } catch (e) {
      console.warn('Failed to load subfolders:', e);
    } finally {
      setLoadingFolders(prev => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
  };

  const toggleFolderExpand = async (folderId: string, node: FolderNode) => {
    const wasExpanded = expandedFolders.has(folderId);

    // Update expanded state immediately so Collapse opens/closes right away
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (wasExpanded) next.delete(folderId);
      else next.add(folderId);
      return next;
    });

    // Load children in the background (only when expanding an unloaded folder)
    if (!wasExpanded && !node.loaded) {
      await loadSubFolders(folderId);
    }
  };

  const toggleFolderSelect = (folderId: string) => {
    const next = new Set(selectedFolderIds);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    setSelectedFolderIds(next);
    handleSettingChange('folderIds', Array.from(next));
  };

  /* --- shared drive folder operations --- */
  const loadSharedDriveSubFolders = async (parentId: string, driveId: string) => {
    setLoadingSharedDriveFolders(prev => new Set(prev).add(parentId));
    try {
      const res = await fetch(
        `${API_BASE_URL}/index/discovery/drive/folders?parentId=${parentId}&driveId=${driveId}`
      );
      if (!res.ok) throw new Error('Failed to load subfolders');
      const data = await res.json();
      const children: FolderNode[] = data.map((f: any) => ({ id: f.id, name: f.name, loaded: false }));

      setSharedDriveFolders(prev => {
        const driveNodes = prev[driveId] || [];
        const updateNode = (nodes: FolderNode[]): FolderNode[] =>
          nodes.map(node => {
            if (node.id === parentId) return { ...node, children, loaded: true };
            if (node.children) return { ...node, children: updateNode(node.children) };
            return node;
          });
        return { ...prev, [driveId]: updateNode(driveNodes) };
      });
    } catch (e) {
      console.warn('Failed to load shared drive subfolders:', e);
    } finally {
      setLoadingSharedDriveFolders(prev => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
  };

  const loadSharedDriveRootFolders = async (driveId: string) => {
    setLoadingSharedDriveFolders(prev => new Set(prev).add(driveId));
    try {
      const res = await fetch(
        `${API_BASE_URL}/index/discovery/drive/folders?driveId=${driveId}`
      );
      if (!res.ok) throw new Error('Failed to load drive folders');
      const data = await res.json();
      const children: FolderNode[] = data.map((f: any) => ({ id: f.id, name: f.name, loaded: false }));
      setSharedDriveFolders(prev => ({ ...prev, [driveId]: children }));
    } catch (e) {
      console.warn('Failed to load shared drive root folders:', e);
    } finally {
      setLoadingSharedDriveFolders(prev => {
        const next = new Set(prev);
        next.delete(driveId);
        return next;
      });
    }
  };

  const toggleSharedDriveFolderExpand = async (folderId: string, node: FolderNode, driveId: string) => {
    const wasExpanded = expandedSharedDriveFolders.has(folderId);
    setExpandedSharedDriveFolders(prev => {
      const next = new Set(prev);
      if (wasExpanded) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
    if (!wasExpanded && !node.loaded) {
      await loadSharedDriveSubFolders(folderId, driveId);
    }
  };

  const toggleSharedDriveFolderSelect = (folderId: string) => {
    const next = new Set(selectedSharedDriveFolderIds);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    setSelectedSharedDriveFolderIds(next);
    handleSettingChange('sharedDriveFolderIds', Array.from(next));
  };

  /* ================================================================== */
  /*  Actions                                                            */
  /* ================================================================== */

  const saveSettings = async () => {
    if (!selectedSource || !currentSettings) return;
    setLoadingSettings(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/index/settings/${selectedSource}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentSettings),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      showSnackbar('Settings saved successfully');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to save settings: ${msg}`);
    } finally {
      setLoadingSettings(false);
    }
  };

  /* Build the correct IndexRequest body for each connector */
  const buildIndexRequest = (source: DataSource, settings: ConnectorSettings): Record<string, unknown> => {
    switch (source) {
      case 'jira':
        return { projectKeys: settings.projectKeys };
      case 'slack':
        return { channelIds: settings.channelIds };
      case 'confluence':
        return { spaceKeys: settings.spaceKeys };
      case 'drive':
        return {
          folderIds: settings.folderIds,
          sharedDriveFolderIds: settings.sharedDriveFolderIds,
          sharedWithMe: settings.sharedWithMe,
          starred: settings.starred,
        };
      case 'calendar':
        return { calendarIds: settings.calendarIds };
      case 'gmail':
        return {
          gmailSettings: {
            labels: settings.labels || [],
            domains: settings.domains || [],
            senders: settings.senders || [],
          },
        };
      default:
        return {};
    }
  };

  const triggerIndexNow = async (source: DataSource) => {
    setIndexingSource(source);
    setError(null);
    try {
      const settings = getSettings(source);
      const requestBody = buildIndexRequest(source, settings);
      const response = await fetch(`${API_BASE_URL}/index/${source}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      showSnackbar(`Indexing started for ${SOURCE_LABELS[source]}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to trigger indexing: ${msg}`);
    } finally {
      setTimeout(() => setIndexingSource(null), 1000);
    }
  };

  const handleApplyDateToAll = () => {
    if (!currentSettings) return;
    applyDateToAll(currentSettings.startDate, currentSettings.endDate, currentSettings.sinceLast);
    showSnackbar('Date range applied to all connectors');
  };

  /* ================================================================== */
  /*  Folder tree renderer                                               */
  /* ================================================================== */

  const renderFolderTree = (nodes: FolderNode[], depth = 0) => (
    <List disablePadding>
      {nodes.map(node => {
        const isExpanded = expandedFolders.has(node.id);
        const isSelected = selectedFolderIds.has(node.id);
        const isLoading = loadingFolders.has(node.id);
        return (
          <React.Fragment key={node.id}>
            <ListItemButton
              sx={{
                pl: 1.5 + depth * 2.5,
                py: 0.5,
                borderRadius: 1,
                mb: 0.25,
                ...(isSelected && {
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                }),
              }}
              onClick={() => toggleFolderSelect(node.id)}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolderExpand(node.id, node);
                  }}
                  sx={{ p: 0.25 }}
                >
                  {isLoading ? (
                    <CircularProgress size={14} />
                  ) : isExpanded ? (
                    <ExpandMoreIcon sx={{ fontSize: 18 }} />
                  ) : (
                    <ChevronRightIcon sx={{ fontSize: 18 }} />
                  )}
                </IconButton>
              </ListItemIcon>
              <ListItemIcon sx={{ minWidth: 28 }}>
                {isExpanded
                  ? <FolderOpenIcon sx={{ fontSize: 18, color: theme.palette.primary.main }} />
                  : <FolderIcon sx={{ fontSize: 18, color: theme.palette.text.secondary }} />}
              </ListItemIcon>
              <ListItemText
                primary={node.name}
                primaryTypographyProps={{ variant: 'body2', noWrap: true }}
              />
              <Checkbox
                checked={isSelected}
                size="small"
                disableRipple
                sx={{ p: 0, mr: -0.5 }}
                tabIndex={-1}
              />
            </ListItemButton>
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              {isLoading ? (
                <Box sx={{ pl: 3 + depth * 2.5, py: 1 }}>
                  <LinearProgress sx={{ width: 120 }} />
                </Box>
              ) : node.children && node.children.length > 0 ? (
                renderFolderTree(node.children, depth + 1)
              ) : node.loaded ? (
                <Typography variant="caption" color="text.secondary" sx={{ pl: 3 + depth * 2.5, py: 0.5, display: 'block' }}>
                  No subfolders
                </Typography>
              ) : null}
            </Collapse>
          </React.Fragment>
        );
      })}
    </List>
  );

  const renderSharedDriveFolderTree = (nodes: FolderNode[], driveId: string, depth = 0) => (
    <List disablePadding>
      {nodes.map(node => {
        const isExpanded = expandedSharedDriveFolders.has(node.id);
        const isSelected = selectedSharedDriveFolderIds.has(node.id);
        const isLoading = loadingSharedDriveFolders.has(node.id);
        return (
          <React.Fragment key={node.id}>
            <ListItemButton
              sx={{
                pl: 1.5 + depth * 2.5, py: 0.5, borderRadius: 1, mb: 0.25,
                ...(isSelected && { bgcolor: alpha(theme.palette.primary.main, 0.08) }),
              }}
              onClick={() => toggleSharedDriveFolderSelect(node.id)}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleSharedDriveFolderExpand(node.id, node, driveId); }} sx={{ p: 0.25 }}>
                  {isLoading ? <CircularProgress size={14} /> : isExpanded ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ChevronRightIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </ListItemIcon>
              <ListItemIcon sx={{ minWidth: 28 }}>
                {isExpanded ? <FolderOpenIcon sx={{ fontSize: 18, color: theme.palette.primary.main }} /> : <FolderIcon sx={{ fontSize: 18, color: theme.palette.text.secondary }} />}
              </ListItemIcon>
              <ListItemText primary={node.name} primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
              <Checkbox checked={isSelected} size="small" disableRipple sx={{ p: 0, mr: -0.5 }} tabIndex={-1} />
            </ListItemButton>
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              {isLoading ? (
                <Box sx={{ pl: 3 + depth * 2.5, py: 1 }}><LinearProgress sx={{ width: 120 }} /></Box>
              ) : node.children && node.children.length > 0 ? (
                renderSharedDriveFolderTree(node.children, driveId, depth + 1)
              ) : node.loaded ? (
                <Typography variant="caption" color="text.secondary" sx={{ pl: 3 + depth * 2.5, py: 0.5, display: 'block' }}>No subfolders</Typography>
              ) : null}
            </Collapse>
          </React.Fragment>
        );
      })}
    </List>
  );

  /* ================================================================== */
  /*  Source-specific settings renderers                                  */
  /* ================================================================== */

  const renderJiraSettings = () => (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Projects</Typography>
      <Autocomplete
        multiple
        options={jiraProjects}
        getOptionLabel={(option) => {
          if (typeof option === 'string') return option;
          return `${option.name} (${option.key})`;
        }}
        value={(currentSettings?.projectKeys || []).map(key => {
          const found = jiraProjects.find(p => p.key === key);
          return found || key;
        })}
        onChange={(_, newValue) => {
          const keys = newValue.map(v => typeof v === 'string' ? v : v.key);
          handleSettingChange('projectKeys', keys);
        }}
        isOptionEqualToValue={(option, value) => {
          const optKey = typeof option === 'string' ? option : option.key;
          const valKey = typeof value === 'string' ? value : value.key;
          return optKey === valKey;
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Search projects..."
            helperText={loadingDiscovery ? 'Loading projects...' : 'Select specific projects, or leave empty to index all'}
          />
        )}
      />
    </Box>
  );

  const formatSlackChannelName = (channel: any): string => {
    if (typeof channel === 'string') return channel;
    if (channel.is_im) return `DM: ${channel.user || channel.name}`;
    if (channel.is_mpim) return `Group: ${channel.name}`;
    if (channel.is_private) return `${channel.name} (Private)`;
    return `#${channel.name}`;
  };

  const renderSlackSettings = () => {
    const publicChannels = slackChannels.filter((c: any) => !c.is_private && !c.is_im && !c.is_mpim);
    const privateChannels = slackChannels.filter((c: any) => c.is_private && !c.is_im && !c.is_mpim);
    const dms = slackChannels.filter((c: any) => c.is_im);
    const groupDms = slackChannels.filter((c: any) => c.is_mpim);

    const DEFAULT_MESSAGE_TYPES = ['channel_messages', 'thread_replies'];

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Channels */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Channels</Typography>
          <Autocomplete
            multiple
            disableCloseOnSelect
            filterSelectedOptions
            limitTags={5}
            options={slackChannels}
            groupBy={(option: any) => {
              if (typeof option === 'string') return 'Selected';
              if (option.is_im) return 'Direct Messages';
              if (option.is_mpim) return 'Group DMs';
              if (option.is_private) return 'Private Channels';
              return 'Public Channels';
            }}
            getOptionLabel={(option: any) => formatSlackChannelName(option)}
            value={(currentSettings?.channelIds || []).map((id: string) => {
              const found = slackChannels.find((c: any) => c.id === id);
              return found || id;
            })}
            onChange={(_, newValue: any[]) => {
              const ids = newValue.map((v: any) => typeof v === 'string' ? v : v.id);
              handleSettingChange('channelIds', ids);
            }}
            isOptionEqualToValue={(option: any, value: any) => {
              const optId = typeof option === 'string' ? option : option.id;
              const valId = typeof value === 'string' ? value : value.id;
              return optId === valId;
            }}
            renderOption={(props, option: any, { selected }) => (
              <li {...props} key={typeof option === 'string' ? option : option.id}>
                <Checkbox
                  size="small"
                  checked={selected}
                  sx={{ p: 0, mr: 1 }}
                />
                <Typography variant="body2">{formatSlackChannelName(option)}</Typography>
              </li>
            )}
            renderTags={(value: any[], getTagProps) =>
              value.map((option: any, index: number) => {
                const label = formatSlackChannelName(option);
                return (
                  <Chip
                    variant="outlined"
                    label={label}
                    {...getTagProps({ index })}
                    key={typeof option === 'string' ? option : option.id}
                    size="small"
                  />
                );
              })
            }
            slotProps={{
              listbox: { style: { maxHeight: 280 } },
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Search channels..."
                helperText={
                  loadingDiscovery
                    ? 'Loading channels...'
                    : `${publicChannels.length} public, ${privateChannels.length} private, ${dms.length} DMs, ${groupDms.length} group DMs — leave empty to index all`
                }
              />
            )}
          />
        </Box>

        {/* Message types */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Message Types</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {[
              { key: 'channel_messages', label: 'Channel Messages' },
              { key: 'direct_messages', label: 'Direct Messages' },
              { key: 'group_dms', label: 'Group DMs' },
              { key: 'thread_replies', label: 'Thread Replies' },
            ].map(type => {
              const types = currentSettings?.messageTypes ?? DEFAULT_MESSAGE_TYPES;
              const isActive = types.includes(type.key);
              return (
                <FormControlLabel
                  key={type.key}
                  control={
                    <Switch
                      size="small"
                      checked={isActive}
                      onChange={() => {
                        // Always persist the full array on toggle, including when using defaults
                        const currentTypes = currentSettings?.messageTypes ?? DEFAULT_MESSAGE_TYPES;
                        const next = isActive
                          ? currentTypes.filter((t: string) => t !== type.key)
                          : [...currentTypes, type.key];
                        handleSettingChange('messageTypes', next);
                      }}
                    />
                  }
                  label={<Typography variant="body2">{type.label}</Typography>}
                  sx={{ ml: 0 }}
                />
              );
            })}
          </Box>
        </Box>
      </Box>
    );
  };

  const renderDriveSettings = () => (
    <Box>
      <Tabs
        value={driveTab}
        onChange={(_, v) => setDriveTab(v)}
        sx={{ mb: 2, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5, textTransform: 'none' } }}
      >
        <Tab icon={<FolderIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="My Drive" />
        <Tab icon={<FolderSharedOutlinedIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Shared Drives" />
        <Tab icon={<PeopleOutlinedIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Shared with me" />
        <Tab icon={<StarOutlinedIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Starred" />
      </Tabs>

      {/* My Drive tab */}
      {driveTab === 0 && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Browse and select specific folders to index, or leave empty to index all files.
            Click a folder to select it, click the arrow to expand.
          </Typography>
          {loadingDiscovery ? (
            <LinearProgress sx={{ my: 2 }} />
          ) : driveFolders.length > 0 ? (
            <Paper variant="outlined" sx={{ maxHeight: 360, overflow: 'auto', border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
              {renderFolderTree(driveFolders)}
            </Paper>
          ) : (
            <Alert severity="info" sx={{ mt: 1 }}>No folders found. Check your Google Drive connection.</Alert>
          )}
          {selectedFolderIds.size > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                {selectedFolderIds.size} folder{selectedFolderIds.size > 1 ? 's' : ''} selected
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {Array.from(selectedFolderIds).map(id => {
                  const findName = (nodes: FolderNode[]): string => {
                    for (const n of nodes) {
                      if (n.id === id) return n.name;
                      if (n.children) { const r = findName(n.children); if (r) return r; }
                    }
                    return id;
                  };
                  return <Chip key={id} label={findName(driveFolders)} onDelete={() => toggleFolderSelect(id)} size="small" />;
                })}
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Shared Drives tab */}
      {driveTab === 1 && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Browse shared drives and select folders to index.
          </Typography>
          {loadingDiscovery ? (
            <LinearProgress sx={{ my: 2 }} />
          ) : sharedDrives.length > 0 ? (
            <Paper variant="outlined" sx={{ maxHeight: 360, overflow: 'auto', border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
              <List disablePadding>
                {sharedDrives.map(drive => {
                  const isExpanded = expandedSharedDriveFolders.has(drive.id);
                  const isLoading = loadingSharedDriveFolders.has(drive.id);
                  return (
                    <React.Fragment key={drive.id}>
                      <ListItemButton
                        sx={{ py: 0.75, borderRadius: 1, mb: 0.25 }}
                        onClick={() => {
                          const wasExpanded = expandedSharedDriveFolders.has(drive.id);
                          setExpandedSharedDriveFolders(prev => {
                            const next = new Set(prev);
                            if (wasExpanded) next.delete(drive.id);
                            else next.add(drive.id);
                            return next;
                          });
                          if (!wasExpanded && !sharedDriveFolders[drive.id]) {
                            loadSharedDriveRootFolders(drive.id);
                          }
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 28 }}>
                          {isLoading ? <CircularProgress size={14} /> : isExpanded ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ChevronRightIcon sx={{ fontSize: 18 }} />}
                        </ListItemIcon>
                        <ListItemIcon sx={{ minWidth: 28 }}>
                          <DriveFileMoveOutlinedIcon sx={{ fontSize: 18, color: theme.palette.text.secondary }} />
                        </ListItemIcon>
                        <ListItemText primary={drive.name} primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }} />
                      </ListItemButton>
                      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                        {isLoading ? (
                          <Box sx={{ pl: 5, py: 1 }}><LinearProgress sx={{ width: 120 }} /></Box>
                        ) : sharedDriveFolders[drive.id]?.length > 0 ? (
                          renderSharedDriveFolderTree(sharedDriveFolders[drive.id], drive.id, 1)
                        ) : sharedDriveFolders[drive.id] ? (
                          <Typography variant="caption" color="text.secondary" sx={{ pl: 5, py: 0.5, display: 'block' }}>No folders found</Typography>
                        ) : null}
                      </Collapse>
                    </React.Fragment>
                  );
                })}
              </List>
            </Paper>
          ) : (
            <Alert severity="info" sx={{ mt: 1 }}>No shared drives found.</Alert>
          )}
          {selectedSharedDriveFolderIds.size > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                {selectedSharedDriveFolderIds.size} folder{selectedSharedDriveFolderIds.size > 1 ? 's' : ''} selected
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {Array.from(selectedSharedDriveFolderIds).map(id => {
                  const findName = (drivesMap: Record<string, FolderNode[]>): string => {
                    for (const nodes of Object.values(drivesMap)) {
                      const search = (ns: FolderNode[]): string => {
                        for (const n of ns) {
                          if (n.id === id) return n.name;
                          if (n.children) { const r = search(n.children); if (r) return r; }
                        }
                        return '';
                      };
                      const found = search(nodes);
                      if (found) return found;
                    }
                    return id;
                  };
                  return <Chip key={id} label={findName(sharedDriveFolders)} onDelete={() => toggleSharedDriveFolderSelect(id)} size="small" />;
                })}
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Shared with me tab */}
      {driveTab === 2 && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Include all files that have been shared with you by others.
          </Typography>
          <FormControlLabel
            control={<Switch checked={currentSettings?.sharedWithMe || false} onChange={(e) => handleSettingChange('sharedWithMe', e.target.checked)} />}
            label={<Typography variant="body2">Index files shared with me</Typography>}
            sx={{ ml: 0 }}
          />
        </Box>
      )}

      {/* Starred tab */}
      {driveTab === 3 && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Include all files you have starred in Google Drive.
          </Typography>
          <FormControlLabel
            control={<Switch checked={currentSettings?.starred || false} onChange={(e) => handleSettingChange('starred', e.target.checked)} />}
            label={<Typography variant="body2">Index starred files</Typography>}
            sx={{ ml: 0 }}
          />
        </Box>
      )}
    </Box>
  );

  const renderConfluenceSettings = () => (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Spaces</Typography>
      <Autocomplete
        multiple
        options={confluenceSpaces}
        getOptionLabel={(option) => {
          if (typeof option === 'string') return option;
          return `${option.name} (${option.key})`;
        }}
        value={(currentSettings?.spaceKeys || []).map(key => {
          const found = confluenceSpaces.find(s => s.key === key);
          return found || key;
        })}
        onChange={(_, newValue) => {
          const keys = newValue.map(v => typeof v === 'string' ? v : v.key);
          handleSettingChange('spaceKeys', keys);
        }}
        isOptionEqualToValue={(option, value) => {
          const optKey = typeof option === 'string' ? option : option.key;
          const valKey = typeof value === 'string' ? value : value.key;
          return optKey === valKey;
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Search spaces..."
            helperText={loadingDiscovery ? 'Loading spaces...' : 'Select specific spaces, or leave empty to index all'}
          />
        )}
      />
    </Box>
  );

  const renderCalendarSettings = () => (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Calendars</Typography>
      <Autocomplete
        multiple
        options={calendars}
        getOptionLabel={(option) => {
          if (typeof option === 'string') return option;
          return option.summaryOverride || option.summary || option.id;
        }}
        value={(currentSettings?.calendarIds || []).map(id => {
          const found = calendars.find(c => c.id === id);
          return found || id;
        })}
        onChange={(_, newValue) => {
          const ids = newValue.map(v => typeof v === 'string' ? v : v.id);
          handleSettingChange('calendarIds', ids);
        }}
        isOptionEqualToValue={(option, value) => {
          const optId = typeof option === 'string' ? option : option.id;
          const valId = typeof value === 'string' ? value : value.id;
          return optId === valId;
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Search calendars..."
            helperText={loadingDiscovery ? 'Loading calendars...' : 'Select specific calendars, or leave empty to index all'}
          />
        )}
      />
    </Box>
  );

  const formatGmailLabelName = (label: any): string => {
    if (typeof label === 'string') return label;
    return label.name || label.id;
  };

  const renderGmailSettings = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Labels */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Labels to Index</Typography>
        <FormControl fullWidth>
          <Autocomplete
            multiple
            options={gmailLabels}
            getOptionLabel={(option: any) => formatGmailLabelName(option)}
            value={(currentSettings?.labels || []).map((id: string) => {
              const found = gmailLabels.find((l: any) => l.id === id || l.name === id);
              return found || id;
            })}
            onChange={(_, newValue: any[]) => {
              const vals = newValue.map((v: any) => typeof v === 'string' ? v : v.id);
              handleSettingChange('labels', vals);
            }}
            isOptionEqualToValue={(option: any, value: any) => {
              const optId = typeof option === 'string' ? option : option.id;
              const valId = typeof value === 'string' ? value : value.id;
              return optId === valId;
            }}
            renderTags={(value: any[], getTagProps) =>
              value.map((option: any, index: number) => {
                const label = formatGmailLabelName(option);
                return (
                  <Chip
                    variant="outlined"
                    label={label}
                    {...getTagProps({ index })}
                    key={typeof option === 'string' ? option : option.id}
                    size="small"
                  />
                );
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Inbox, Sent, etc."
                helperText={loadingDiscovery ? 'Loading labels...' : 'Select specific labels, or leave empty to index all'}
              />
            )}
          />
        </FormControl>
      </Box>

      {/* Domains */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Filter by Domains</Typography>
        <Autocomplete
          multiple
          freeSolo
          options={[] as string[]}
          value={currentSettings?.domains || []}
          onChange={(_, newValue) => handleSettingChange('domains', newValue)}
          renderTags={(value: readonly string[], getTagProps) =>
            value.map((option: string, index: number) => (
              <Chip variant="outlined" label={option} {...getTagProps({ index })} key={index} size="small" />
            ))
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="e.g. google.com"
              helperText="Type a domain and press Enter to add — leave empty to include all domains"
            />
          )}
        />
      </Box>

      {/* Senders */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Filter by Senders</Typography>
        <Autocomplete
          multiple
          freeSolo
          options={[] as string[]}
          value={currentSettings?.senders || []}
          onChange={(_, newValue) => handleSettingChange('senders', newValue)}
          renderTags={(value: readonly string[], getTagProps) =>
            value.map((option: string, index: number) => (
              <Chip variant="outlined" label={option} {...getTagProps({ index })} key={index} size="small" />
            ))
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="e.g. boss@company.com"
              helperText="Type an email and press Enter to add — leave empty to include all senders"
            />
          )}
        />
      </Box>
    </Box>
  );

  /* --- source-specific settings dispatcher --- */
  const renderSettingsForSource = () => {
    if (!selectedSource) return null;
    switch (selectedSource) {
      case 'jira': return renderJiraSettings();
      case 'slack': return renderSlackSettings();
      case 'gmail': return renderGmailSettings();
      case 'drive': return renderDriveSettings();
      case 'confluence': return renderConfluenceSettings();
      case 'calendar': return renderCalendarSettings();
      default: return null;
    }
  };

  /* --- date range section --- */
  const renderDateRange = () => (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <DateRangeOutlinedIcon sx={{ fontSize: 18, color: theme.palette.text.secondary }} />
        <Typography variant="subtitle2">Date Range</Typography>
      </Box>

      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={currentSettings?.sinceLast || false}
            onChange={(e) => handleSettingChange('sinceLast', e.target.checked)}
          />
        }
        label={<Typography variant="body2">Since last sync</Typography>}
        sx={{ ml: 0, mb: 1.5 }}
      />

      {!currentSettings?.sinceLast && (
        <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
          <TextField
            label="Start Date"
            type="date"
            value={currentSettings?.startDate || ''}
            onChange={(e) => handleSettingChange('startDate', e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            size="small"
            sx={{ flex: 1 }}
          />
          <TextField
            label="End Date"
            type="date"
            value={currentSettings?.endDate || ''}
            onChange={(e) => handleSettingChange('endDate', e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            size="small"
            sx={{ flex: 1 }}
          />
        </Box>
      )}

      <Tooltip title="Copy this date range configuration to all connectors">
        <Button
          size="small"
          variant="text"
          startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />}
          onClick={handleApplyDateToAll}
          sx={{ color: theme.palette.text.secondary }}
        >
          Apply to All Sources
        </Button>
      </Tooltip>
    </Box>
  );

  /* ================================================================== */
  /*  Layout                                                             */
  /* ================================================================== */

  const sourceColor = selectedSource ? SOURCE_COLORS[selectedSource] : undefined;

  return (
    <Box>
      {/* Page header */}
      <Typography variant="h5" fontWeight={600} sx={{ mb: 3 }}>
        Settings
      </Typography>

      <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'flex-start' }}>
        {/* ---- Left: Source navigation ---- */}
        <Paper
          sx={{
            p: 1,
            width: 200,
            minWidth: 200,
            flexShrink: 0,
            position: 'sticky',
            top: 24,
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{ px: 1.5, pt: 1, pb: 1.5 }}
          >
            Connectors
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {ALL_SOURCES.map(source => {
              const isActive = selectedSource === source;
              const configured = isSourceConfigured(source);
              const enabled = isEnabled(source);
              const color = SOURCE_COLORS[source];
              return (
                <Box
                  key={source}
                  onClick={() => setSelectedSource(source)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    px: 1.5,
                    py: 1,
                    borderRadius: 1,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                    opacity: enabled ? 1 : 0.5,
                    ...(isActive
                      ? {
                          bgcolor: alpha(color, 0.10),
                          '&::before': {
                            content: '""',
                            position: 'absolute',
                            left: 0,
                            top: '20%',
                            bottom: '20%',
                            width: 3,
                            borderRadius: 2,
                            bgcolor: color,
                          },
                        }
                      : {
                          '&:hover': {
                            bgcolor: alpha(theme.palette.text.primary, 0.04),
                          },
                        }),
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isActive ? color : theme.palette.text.secondary,
                      '& .MuiSvgIcon-root': { fontSize: 20 },
                    }}
                  >
                    {SOURCE_ICONS[source]}
                  </Box>

                  <Typography
                    variant="body2"
                    sx={{
                      flex: 1,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? theme.palette.text.primary : theme.palette.text.secondary,
                    }}
                  >
                    {SOURCE_LABELS[source]}
                  </Typography>

                  {enabled && configured && (
                    <CheckCircleIcon
                      sx={{
                        fontSize: 14,
                        color: alpha(theme.palette.success.main, 0.7),
                      }}
                    />
                  )}
                </Box>
              );
            })}
          </Box>
        </Paper>

        {/* ---- Right: Settings panel ---- */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {!selectedSource ? (
            /* Empty state */
            <Paper
              sx={{
                p: 3,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 320,
                textAlign: 'center',
              }}
            >
              <Typography variant="body1" color="text.secondary" sx={{ mb: 0.5 }}>
                Select a connector from the left to configure its settings.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Each connector can be independently configured with source-specific options and a shared date range.
              </Typography>
            </Paper>
          ) : (
            <Paper sx={{ p: 3, position: 'relative', overflow: 'hidden' }}>
              {/* Loading bar */}
              {loadingSettings && (
                <LinearProgress
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                  }}
                />
              )}

              {/* Source header */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  mb: 3,
                  pb: 2,
                  borderBottom: `1px solid ${theme.palette.divider}`,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: 1,
                    bgcolor: alpha(sourceColor!, 0.10),
                    color: sourceColor,
                    '& .MuiSvgIcon-root': { fontSize: 20 },
                  }}
                >
                  {SOURCE_ICONS[selectedSource]}
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h6">
                    {SOURCE_LABELS[selectedSource]}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Configure indexing settings for {SOURCE_LABELS[selectedSource]}
                  </Typography>
                </Box>
                {loadingDiscovery && (
                  <CircularProgress size={18} sx={{ color: theme.palette.text.secondary }} />
                )}
                <FormControlLabel
                  control={
                    <Switch
                      checked={isEnabled(selectedSource)}
                      onChange={(e) => setSourceEnabled(selectedSource, e.target.checked)}
                    />
                  }
                  label={
                    <Typography variant="body2" color="text.secondary">
                      {isEnabled(selectedSource) ? 'Enabled' : 'Disabled'}
                    </Typography>
                  }
                  labelPlacement="start"
                  sx={{ ml: 1, mr: 0 }}
                />
              </Box>

              {/* Error / Success */}
              {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}

              {/* Disabled banner */}
              {selectedSource && !isEnabled(selectedSource) && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  This connector is disabled. It will be excluded from indexing, search, and all dashboards.
                </Alert>
              )}

              {/* Source-specific settings */}
              {currentSettings && !loadingSettings && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {/* Main config */}
                  <Box sx={{ mb: 3 }}>
                    {renderSettingsForSource()}
                  </Box>

                  {/* Date range */}
                  <Box
                    sx={{
                      pt: 2.5,
                      borderTop: `1px solid ${theme.palette.divider}`,
                      mb: 3,
                    }}
                  >
                    {renderDateRange()}
                  </Box>

                  {/* Action bar */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      pt: 2.5,
                      borderTop: `1px solid ${theme.palette.divider}`,
                    }}
                  >
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={
                        indexingSource === selectedSource
                          ? <CircularProgress size={14} color="inherit" />
                          : <PlayArrowIcon sx={{ fontSize: 18 }} />
                      }
                      onClick={() => triggerIndexNow(selectedSource)}
                      disabled={indexingSource === selectedSource}
                    >
                      Index Now
                    </Button>

                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<RefreshIcon sx={{ fontSize: 18 }} />}
                        onClick={() => {
                          loadServerSettings(selectedSource);
                          loadDiscoveryData(selectedSource);
                        }}
                        disabled={loadingDiscovery || loadingSettings}
                      >
                        Refresh
                      </Button>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<SaveIcon sx={{ fontSize: 18 }} />}
                        onClick={saveSettings}
                        disabled={loadingSettings}
                      >
                        Save Settings
                      </Button>
                    </Box>
                  </Box>
                </Box>
              )}
            </Paper>
          )}
        </Box>
      </Box>

      {/* Snackbar for success messages */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbarOpen(false)}
          severity="success"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {success}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Settings;
