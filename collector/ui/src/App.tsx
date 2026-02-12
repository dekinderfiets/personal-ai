import { useState, useMemo } from 'react';
import {
  Box, CssBaseline, ThemeProvider, PaletteMode,
  Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  Typography, IconButton, Tooltip, Divider, alpha,
} from '@mui/material';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';

import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Documents from './pages/Documents';
import Explore from './pages/Explore';
import Activity from './pages/Activity';
import { createAppTheme } from './theme';
import { ColorModeContext } from './context/ColorModeContext';

const SIDEBAR_WIDTH = 220;

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: <DashboardOutlinedIcon /> },
  { path: '/documents', label: 'Documents', icon: <DescriptionOutlinedIcon /> },
  { path: '/activity', label: 'Activity', icon: <TimelineOutlinedIcon /> },
  { path: '/settings', label: 'Settings', icon: <SettingsOutlinedIcon /> },
];

function SidebarContent({ mode, toggleMode }: { mode: PaletteMode; toggleMode: () => void }) {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Logo */}
      <Box sx={{ px: 2.5, py: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <StorageOutlinedIcon sx={{ color: 'primary.main', fontSize: 24 }} />
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em' }}>
          AI Collector
        </Typography>
      </Box>

      <Divider />

      {/* Navigation */}
      <List sx={{ px: 1.5, py: 1.5, flex: 1 }}>
        {NAV_ITEMS.map(({ path, label, icon }) => (
          <ListItemButton
            key={path}
            component={Link}
            to={path}
            selected={isActive(path)}
            sx={{
              mb: 0.5,
              px: 1.5,
              py: 0.75,
              borderRadius: 1,
              '&.Mui-selected': {
                backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.1),
                color: 'primary.main',
                '& .MuiListItemIcon-root': { color: 'primary.main' },
                '&:hover': {
                  backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.15),
                },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
              {icon}
            </ListItemIcon>
            <ListItemText
              primary={label}
              primaryTypographyProps={{ variant: 'body2', fontWeight: isActive(path) ? 600 : 400 }}
            />
          </ListItemButton>
        ))}
      </List>

      <Divider />

      {/* Theme Toggle */}
      <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {mode === 'light' ? 'Light' : 'Dark'} mode
        </Typography>
        <Tooltip title={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`}>
          <IconButton size="small" onClick={toggleMode} sx={{ color: 'text.secondary' }}>
            {mode === 'light' ? <DarkModeOutlinedIcon fontSize="small" /> : <LightModeOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function App() {
  const [mode, setMode] = useState<PaletteMode>(() => {
    return (localStorage.getItem('collector-theme-mode') as PaletteMode) || 'light';
  });

  const toggleMode = () => {
    const next: PaletteMode = mode === 'light' ? 'dark' : 'light';
    setMode(next);
    localStorage.setItem('collector-theme-mode', next);
  };

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ColorModeContext.Provider value={{ mode, toggleMode }}>
        <Router>
          <Box sx={{ display: 'flex', minHeight: '100vh' }}>
            {/* Sidebar */}
            <Drawer
              variant="permanent"
              sx={{
                width: SIDEBAR_WIDTH,
                flexShrink: 0,
                '& .MuiDrawer-paper': {
                  width: SIDEBAR_WIDTH,
                  boxSizing: 'border-box',
                  borderRight: 1,
                  borderColor: 'divider',
                  backgroundColor: 'background.paper',
                },
              }}
            >
              <SidebarContent mode={mode} toggleMode={toggleMode} />
            </Drawer>

            {/* Main content */}
            <Box
              component="main"
              sx={{
                flexGrow: 1,
                minWidth: 0,
                backgroundColor: 'background.default',
                overflow: 'auto',
                height: '100vh',
              }}
            >
              <Box sx={{ maxWidth: 1400, mx: 'auto', px: { xs: 2, sm: 3, md: 4 }, py: 3 }}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/documents" element={<Documents />} />
                  <Route path="/activity" element={<Activity />} />
                  <Route path="/explore" element={<Explore />} />
                  <Route path="/explore/:documentId" element={<Explore />} />
                  <Route path="/search" element={<Navigate to="/documents" replace />} />
                </Routes>
              </Box>
            </Box>
          </Box>
        </Router>
      </ColorModeContext.Provider>
    </ThemeProvider>
  );
}

export default App;
