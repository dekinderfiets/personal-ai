import { useState, useEffect, useCallback } from 'react';
import { DataSource, ConnectorSettings, AllSettings } from '../types/api';

const STORAGE_KEY = 'collector-settings';

function loadFromStorage(): AllSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveToStorage(settings: AllSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useLocalSettings() {
  const [settings, setSettings] = useState<AllSettings>(loadFromStorage);

  useEffect(() => {
    saveToStorage(settings);
  }, [settings]);

  const getSettings = useCallback((source: DataSource): ConnectorSettings => {
    return settings[source] || {};
  }, [settings]);

  const updateSettings = useCallback((source: DataSource, update: Partial<ConnectorSettings>) => {
    setSettings(prev => ({
      ...prev,
      [source]: { ...(prev[source] || {}), ...update },
    }));
  }, []);

  const setSourceSettings = useCallback((source: DataSource, value: ConnectorSettings) => {
    setSettings(prev => ({ ...prev, [source]: value }));
  }, []);

  const applyDateToAll = useCallback((startDate?: string, endDate?: string, sinceLast?: boolean) => {
    setSettings(prev => {
      const next = { ...prev };
      const sources: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar', 'github'];
      for (const s of sources) {
        next[s] = { ...(next[s] || {}), startDate, endDate, sinceLast };
      }
      return next;
    });
  }, []);

  const mergeServerSettings = useCallback((source: DataSource, serverSettings: ConnectorSettings) => {
    setSettings(prev => {
      const local = prev[source] || {};
      // Local settings take priority over server settings
      return { ...prev, [source]: { ...serverSettings, ...local } };
    });
  }, []);

  return {
    settings,
    getSettings,
    updateSettings,
    setSourceSettings,
    applyDateToAll,
    mergeServerSettings,
  };
}
