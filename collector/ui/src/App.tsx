import { AppBar, Toolbar, Typography, Container, Box, Button, ThemeProvider, CssBaseline } from '@mui/material';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Search from './pages/Search';
import { darkTheme } from './theme';

function App() {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Router>
        <AppBar position="sticky">
          <Toolbar variant="dense">
            <Typography variant="h6" component="div" sx={{ flexGrow: 1, letterSpacing: '0.05em', fontWeight: 800 }}>
              <span style={{ color: darkTheme.palette.primary.main }}>AI</span> COLLECTOR
            </Typography>
            <Button color="inherit" component={Link} to="/" sx={{ mx: 1 }}>Dashboard</Button>
            <Button color="inherit" component={Link} to="/settings" sx={{ mx: 1 }}>Configuration</Button>
          </Toolbar>
        </AppBar>
        <Container maxWidth="xl">
          <Box sx={{ my: 4 }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/search" element={<Search />} />
            </Routes>
          </Box>
        </Container>
      </Router>
    </ThemeProvider>
  );
}

export default App;
