import { useState, useEffect, useCallback } from 'react';
import { DataSource, ALL_SOURCES } from '../types/api';

const API_BASE_URL = '/api/v1';

export function useEnabledSources() {
  const [enabledSources, setEnabledSources] = useState<DataSource[]>(ALL_SOURCES);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/index/enabled-sources`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: DataSource[] = await response.json();
      setEnabledSources(data);
    } catch {
      // Fall back to all sources on error
      setEnabledSources(ALL_SOURCES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const setSourceEnabled = useCallback(async (source: DataSource, enabled: boolean) => {
    try {
      const response = await fetch(`${API_BASE_URL}/index/sources/${source}/enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Optimistic update
      setEnabledSources(prev =>
        enabled ? [...prev, source] : prev.filter(s => s !== source),
      );
    } catch (e) {
      // Refetch on error to restore correct state
      await refetch();
      throw e;
    }
  }, [refetch]);

  const isEnabled = useCallback((source: DataSource) => {
    return enabledSources.includes(source);
  }, [enabledSources]);

  return { enabledSources, loading, refetch, setSourceEnabled, isEnabled };
}
