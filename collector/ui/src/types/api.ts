export type DataSource = 'jira' | 'slack' | 'gmail' | 'drive' | 'confluence' | 'calendar' | 'github';

export const ALL_SOURCES: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar', 'github'];

export const SOURCE_COLORS: Record<DataSource, string> = {
  jira: '#0052CC',
  slack: '#4A154B',
  gmail: '#EA4335',
  drive: '#0F9D58',
  confluence: '#172B4D',
  calendar: '#4285F4',
  github: '#6e5494',
};

export const SOURCE_LABELS: Record<DataSource, string> = {
  jira: 'Jira',
  slack: 'Slack',
  gmail: 'Gmail',
  drive: 'Google Drive',
  confluence: 'Confluence',
  calendar: 'Calendar',
  github: 'GitHub',
};

// MUI icon names mapped per source (import these in components)
export const SOURCE_ICON_NAMES: Record<DataSource, string> = {
  jira: 'BugReport',
  slack: 'Tag',
  gmail: 'Mail',
  drive: 'Cloud',
  confluence: 'MenuBook',
  calendar: 'CalendarMonth',
  github: 'Code',
};

export interface SearchRequest {
  query: string;
  sources?: DataSource[];
  searchType?: 'vector' | 'keyword' | 'hybrid';
  limit?: number;
  offset?: number;
  where?: Record<string, unknown>;
  startDate?: string;
  endDate?: string;
}

export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  distance?: number;
  score: number;
  source: DataSource;
}

export interface NavigationResponse {
  current: SearchResult | null;
  related: SearchResult[];
  navigation: {
    hasPrev: boolean;
    hasNext: boolean;
    parentId?: string | null;
    contextType?: string;
    totalSiblings?: number;
  };
}

export interface IndexStatus {
  source: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  lastSync: string | null;
  documentsIndexed: number;
  error?: string;
  lastError?: string;
  lastErrorAt?: string;
}

export interface ConnectorSettings {
  projectKeys?: string[];
  channelIds?: string[];
  messageTypes?: string[];
  labels?: string[];
  domains?: string[];
  senders?: string[];
  folderIds?: string[];
  spaceKeys?: string[];
  calendarIds?: string[];
  repos?: string[];
  startDate?: string;
  endDate?: string;
  sinceLast?: boolean;
}

export type AllSettings = Partial<Record<DataSource, ConnectorSettings>>;

export interface WorkflowInfo {
  workflowId: string;
  runId: string;
  type: string;
  status: string;
  startTime: string;
  closeTime?: string;
  executionTime?: number;
}
