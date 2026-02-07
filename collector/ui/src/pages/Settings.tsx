import React, { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Paper,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  TextField,
  Alert,
  Autocomplete,
  LinearProgress,
  Chip
} from '@mui/material';
import { DataSource, SourceSettings, JiraSettings, SlackSettings, DriveSettings, ConfluenceSettings, CalendarSettings } from '../../../src/types'; // Adjust path as needed
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';

const API_BASE_URL = '/api/v1';

const ALL_SOURCES: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'];

const Settings: React.FC = () => {
  const [selectedSource, setSelectedSource] = useState<DataSource | ''>('');
  const [currentSettings, setCurrentSettings] = useState<SourceSettings | null>(null);

  // UI States
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingDiscovery, setLoadingDiscovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Discovery Options States
  const [jiraProjects, setJiraProjects] = useState<any[]>([]);
  const [slackChannels, setSlackChannels] = useState<any[]>([]);
  const [driveFolders, setDriveFolders] = useState<any[]>([]);
  const [confluenceSpaces, setConfluenceSpaces] = useState<any[]>([]);
  const [calendars, setCalendars] = useState<any[]>([]);
  const [gmailLabels, setGmailLabels] = useState<any[]>([]);

  // Load Settings when Source Changes
  useEffect(() => {
    if (selectedSource) {
      setError(null);
      setSuccess(null);
      loadSettings(selectedSource);
      loadDiscoveryData(selectedSource);
    } else {
      setCurrentSettings(null);
    }
  }, [selectedSource]);

  const loadSettings = async (source: DataSource) => {
    setLoadingSettings(true);
    try {
      const res = await fetch(`${API_BASE_URL}/index/settings/${source}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      // Initialize with empty arrays/objects if null to avoid controlled/uncontrolled warnings
      setCurrentSettings(data || {});
    } catch (e: any) {
      setError(`Failed to load settings: ${e.message}`);
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
      else if (source === 'drive') endpoint = 'discovery/drive/folders'; // Top level folders
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
          // Flatten drive options or just use what is returned. 
          // If the API returns a flat list of top-level folders, that's good.
          setDriveFolders(data);
        }
        else if (source === 'confluence') setConfluenceSpaces(data);
        else if (source === 'calendar') setCalendars(data);
        else if (source === 'gmail') setGmailLabels(data);
      }
    } catch (e: any) {
      console.warn(`Discovery failed for ${source}:`, e);
      // Don't block the UI, just maybe show a warning or fallback to manual
      // For now, we just log it. The Autocomplete will just be empty.
    } finally {
      setLoadingDiscovery(false);
    }
  };

  const handleSettingChange = (key: string, value: any) => {
    setCurrentSettings(prev => ({
      ...prev!,
      [key]: value,
    } as any));
  };

  const saveSettings = async () => {
    if (!selectedSource || !currentSettings) return;

    setLoadingSettings(true);
    setError(null);
    setSuccess(null);

    // Prepare payload based on source if needed
    let payload = currentSettings;

    // For Gmail, we need to map the UI state back to the expected structure if we changed how we store it.
    // Actually, let's just ensure we are using the correct keys as per `types/index.ts`
    // GmailSettings: { domains: string[], senders: string[], labels: string[] }

    try {
      const response = await fetch(`${API_BASE_URL}/index/settings/${selectedSource}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      setSuccess('Settings saved successfully!');
    } catch (e: any) {
      setError(`Failed to save settings: ${e.message}`);
    } finally {
      setLoadingSettings(false);
    }
  };

  // --- RENDERERS ---

  const renderJiraSettings = () => (
    <>
      <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>Jira Projects</Typography>
      <Autocomplete
        multiple
        options={jiraProjects}
        getOptionLabel={(option) => {
          // Handle both object option and string value (if saved previously)
          if (typeof option === 'string') return option;
          return `${option.name} (${option.key})`;
        }}
        value={((currentSettings as JiraSettings)?.projectKeys || []).map(key => {
          // Try to find the full object for the key to display nice label
          const found = jiraProjects.find(p => p.key === key);
          return found || key;
        })}
        onChange={(_, newValue) => {
          // Save only the keys
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
            label="Select Projects"
            placeholder="Projects"
            helperText={loadingDiscovery ? "Loading projects..." : "Select projects to index"}
          />
        )}
      />
    </>
  );

  const renderSlackSettings = () => (
    <>
      <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>Slack Channels</Typography>
      <Autocomplete
        multiple
        options={slackChannels}
        getOptionLabel={(option) => {
          if (typeof option === 'string') return option;
          return `#${option.name} ${option.is_private ? '(Private)' : ''}`;
        }}
        value={((currentSettings as SlackSettings)?.channelIds || []).map(id => {
          const found = slackChannels.find(c => c.id === id);
          return found || id;
        })}
        onChange={(_, newValue) => {
          const ids = newValue.map(v => typeof v === 'string' ? v : v.id);
          handleSettingChange('channelIds', ids);
        }}
        isOptionEqualToValue={(option, value) => {
          const optId = typeof option === 'string' ? option : option.id;
          const valId = typeof value === 'string' ? value : value.id;
          return optId === valId;
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Select Channels"
            placeholder="Channels"
            helperText={loadingDiscovery ? "Loading channels..." : "Select public/private channels or DMs"}
          />
        )}
      />
    </>
  );

  const renderDriveSettings = () => (
    <>
      <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>Google Drive Folders</Typography>
      <Autocomplete
        multiple
        options={driveFolders}
        getOptionLabel={(option) => {
          if (typeof option === 'string') return option;
          return option.name;
        }}
        value={((currentSettings as DriveSettings)?.folderIds || []).map(id => {
          const found = driveFolders.find(f => f.id === id);
          return found || id;
        })}
        onChange={(_, newValue) => {
          const ids = newValue.map(v => typeof v === 'string' ? v : v.id);
          handleSettingChange('folderIds', ids);
        }}
        isOptionEqualToValue={(option, value) => {
          const optId = typeof option === 'string' ? option : option.id;
          const valId = typeof value === 'string' ? value : value.id;
          return optId === valId;
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Select Root Folders"
            placeholder="Folders"
            helperText={loadingDiscovery ? "Loading top-level folders..." : "Select folders to index recursively"}
          />
        )}
      />
      <Alert severity="info" sx={{ mt: 1 }}>
        Currently showing top-level folders. Sub-folder selection can be added if needed, but recursive collection covers children.
      </Alert>
    </>
  );

  const renderConfluenceSettings = () => (
    <>
      <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>Confluence Spaces</Typography>
      <Autocomplete
        multiple
        options={confluenceSpaces}
        getOptionLabel={(option) => {
          if (typeof option === 'string') return option;
          return `${option.name} (${option.key})`;
        }}
        value={((currentSettings as ConfluenceSettings)?.spaceKeys || []).map(key => {
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
            label="Select Spaces"
            placeholder="Spaces"
            helperText={loadingDiscovery ? "Loading spaces..." : "Select spaces to index"}
          />
        )}
      />
    </>
  );

  const renderCalendarSettings = () => (
    <>
      <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>Calendars</Typography>
      <Autocomplete
        multiple
        options={calendars}
        getOptionLabel={(option) => {
          if (typeof option === 'string') return option;
          return option.summaryOverride || option.summary || option.id;
        }}
        value={((currentSettings as CalendarSettings)?.calendarIds || []).map(id => {
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
            label="Select Calendars"
            placeholder="Calendars"
            helperText={loadingDiscovery ? "Loading calendars..." : "Select calendars to index"}
          />
        )}
      />
    </>
  );

  const renderGmailSettings = () => (
    <>
      <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>Gmail Settings</Typography>

      <FormControl fullWidth margin="normal">
        <Typography variant="subtitle2" gutterBottom>Labels to Index</Typography>
        <Autocomplete
          multiple
          options={gmailLabels}
          getOptionLabel={(option) => {
            if (typeof option === 'string') return option;
            return option.name;
          }}
          value={((currentSettings as any)?.labels || []).map((id: string) => {
            const found = gmailLabels.find(l => l.id === id || l.name === id);
            return found || id;
          })}
          onChange={(_, newValue) => {
            // Gmail labels are often referenced by ID, but sometimes name is useful. 
            // The backend likely uses IDs or standardized names. 
            // Let's store IDs if available, else name.
            const vals = newValue.map(v => typeof v === 'string' ? v : (v.id || v.name));
            handleSettingChange('labels', vals);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Labels"
              placeholder="Inbox, Sent, etc."
              helperText={loadingDiscovery ? "Loading labels..." : "Select labels"}
            />
          )}
        />
      </FormControl>

      <Typography variant="subtitle2" sx={{ mt: 2 }} gutterBottom>Filter by Domains (Optional)</Typography>
      <Autocomplete
        multiple
        freeSolo
        options={[]}
        value={(currentSettings as any)?.domains || []}
        onChange={(_, newValue) => handleSettingChange('domains', newValue)}
        renderTags={(value: readonly string[], getTagProps) =>
          value.map((option: string, index: number) => (
            <Chip variant="outlined" label={option} {...getTagProps({ index })} />
          ))
        }
        renderInput={(params) => (
          <TextField {...params} label="Allowed Domains" placeholder="e.g. google.com" helperText="Press Enter to add" />
        )}
      />

      <Typography variant="subtitle2" sx={{ mt: 2 }} gutterBottom>Filter by Senders (Optional)</Typography>
      <Autocomplete
        multiple
        freeSolo
        options={[]}
        value={(currentSettings as any)?.senders || []}
        onChange={(_, newValue) => handleSettingChange('senders', newValue)}
        renderTags={(value: readonly string[], getTagProps) =>
          value.map((option: string, index: number) => (
            <Chip variant="outlined" label={option} {...getTagProps({ index })} />
          ))
        }
        renderInput={(params) => (
          <TextField {...params} label="Allowed Senders" placeholder="e.g. boss@company.com" helperText="Press Enter to add" />
        )}
      />
    </>
  );

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        Collector Configuration
      </Typography>

      <Paper elevation={3} sx={{ p: 4, mb: 3 }}>
        <FormControl fullWidth margin="normal">
          <InputLabel id="source-select-label">Select Data Source to Configure</InputLabel>
          <Select
            labelId="source-select-label"
            value={selectedSource}
            label="Select Data Source to Configure"
            onChange={(e) => setSelectedSource(e.target.value as DataSource)}
          >
            <MenuItem value="">
              <em>Select a source...</em>
            </MenuItem>
            {ALL_SOURCES.map((source) => (
              <MenuItem key={source} value={source}>
                {source.charAt(0).toUpperCase() + source.slice(1)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {loadingSettings && <LinearProgress sx={{ mt: 2 }} />}
        {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ my: 2 }}>{success}</Alert>}

        {selectedSource && currentSettings && !loadingSettings && (
          <Box mt={4}>
            <Box mb={4}>
              {selectedSource === 'jira' && renderJiraSettings()}
              {selectedSource === 'slack' && renderSlackSettings()}
              {selectedSource === 'gmail' && renderGmailSettings()}
              {selectedSource === 'drive' && renderDriveSettings()}
              {selectedSource === 'confluence' && renderConfluenceSettings()}
              {selectedSource === 'calendar' && renderCalendarSettings()}
            </Box>

            <Box display="flex" justifyContent="flex-end" gap={2}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={() => {
                  loadSettings(selectedSource);
                  loadDiscoveryData(selectedSource);
                }}
                disabled={loadingDiscovery || loadingSettings}
              >
                Refresh Options
              </Button>
              <Button
                variant="contained"
                color="primary"
                size="large"
                startIcon={<SaveIcon />}
                onClick={saveSettings}
                disabled={loadingSettings}
              >
                Save Configuration
              </Button>
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  );
};

export default Settings;