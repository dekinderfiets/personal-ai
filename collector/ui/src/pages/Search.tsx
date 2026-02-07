import { Typography, Box, Paper, TextField, Button, Select, MenuItem, FormControl, InputLabel, CircularProgress, Alert, Chip, Divider } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useState } from 'react';
import { DataSource } from '../../../src/types'; // Adjust path as needed

const API_BASE_URL = '/api/v1'; // This will be proxied to the NestJS backend

const ALL_SOURCES: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'];

interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, any>;
  distance: number;
  source: DataSource;
}

const Search: React.FC = () => {
  const [query, setQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<DataSource | ''>('');
  const [limit, setLimit] = useState(10);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setResults([]);

    const params = new URLSearchParams();
    params.append('query', query);
    if (selectedSource) params.append('source', selectedSource);
    if (limit) params.append('limit', limit.toString());
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    try {
      const response = await fetch(`${API_BASE_URL}/index/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: SearchResult[] = await response.json();
      setResults(data);
    } catch (e: any) {
      setError(`Search failed: ${e.message}`);
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setSelectedSource('');
    setLimit(10);
    setStartDate('');
    setEndDate('');
    setResults([]);
    setError(null);
  };

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        Search Indexed Documents
      </Typography>

      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', m: -1 }}>
          <Box sx={{ width: '100%', p: 1 }}>
            <TextField
              fullWidth
              label="Search Query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              variant="outlined"
            />
          </Box>
          <Box sx={{ width: { xs: '100%', sm: '33.33%' }, p: 1 }}>
            <FormControl fullWidth>
              <InputLabel id="source-select-label">Source</InputLabel>
              <Select
                labelId="source-select-label"
                value={selectedSource}
                label="Source"
                onChange={(e) => setSelectedSource(e.target.value as DataSource)}
              >
                <MenuItem value="">
                  <em>Any</em>
                </MenuItem>
                {ALL_SOURCES.map((src) => (
                  <MenuItem key={src} value={src}>
                    {src.toUpperCase()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <Box sx={{ width: { xs: '100%', sm: '33.33%' }, p: 1 }}>
            <TextField
              fullWidth
              label="Limit"
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              variant="outlined"
            />
          </Box>
          <Box sx={{ width: { xs: '100%', sm: '33.33%' }, p: 1 }}>
            <TextField
              fullWidth
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              variant="outlined"
            />
          </Box>
          <Box sx={{ width: { xs: '100%', sm: '33.33%' }, p: 1 }}>
            <TextField
              fullWidth
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              variant="outlined"
            />
          </Box>
          <Box sx={{ width: { xs: '100%', sm: '66.66%' }, p: 1, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<ClearIcon />}
              onClick={handleClear}
            >
              Clear
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={<SearchIcon />}
              onClick={handleSearch}
              disabled={loading || !query}
            >
              Search
            </Button>
          </Box>
        </Box>
      </Paper>

      {loading && (
        <Box display="flex" justifyContent="center" my={4}>
          <CircularProgress />
        </Box>
      )}
      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

      {!loading && !error && results.length === 0 && query && (
        <Alert severity="info">No results found for your query.</Alert>
      )}

      {results.length > 0 && (
        <Box mt={4}>
          <Typography variant="h5" gutterBottom>
            Search Results ({results.length})
          </Typography>
          {results.map((result) => (
            <Paper key={result.id} elevation={2} sx={{ p: 2, mb: 2, textAlign: 'left' }}>
              <Typography variant="h6" color="primary">
                {result.metadata.title || result.metadata.subject || result.id}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Source: {result.source.toUpperCase()} | Distance: {result.distance.toFixed(4)}
                {result.metadata.url && (
                  <> | <a href={result.metadata.url} target="_blank" rel="noopener noreferrer">Link</a></>
                )}
              </Typography>
              <Typography variant="body1" sx={{ mt: 1 }}>
                {result.content.split('---')[1]?.trim() || result.content}
              </Typography>
              <Divider sx={{ my: 1 }} />
              <Box>
                {Object.entries(result.metadata).map(([key, value]) => {
                  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    // Exclude search_context as it's often too long and redundant here
                    if (key === 'search_context' || key === 'id' || key === 'chunkId' || key === 'chunkIndex' || key === 'totalChunks' || key === 'timestamp') {
                      return null;
                    }
                    return <Chip key={key} label={`${key}: ${value}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />;
                  }
                  return null;
                })}
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default Search;