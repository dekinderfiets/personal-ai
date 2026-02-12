// Data Source Types
export type DataSource = 'jira' | 'slack' | 'gmail' | 'drive' | 'confluence' | 'calendar' | 'github';

// Base Document Interface
export interface BaseDocument {
    id: string;
    source: DataSource;
    content: string;
    metadata: Record<string, unknown>;
}

// Jira Document
export interface JiraDocument extends BaseDocument {
    source: 'jira';
    metadata: {
        id: string;
        source: 'jira';
        type: 'issue' | 'comment';
        title: string;
        project: string;
        issueType?: string;
        status?: string;
        priority?: string;
        assignee?: string | null;
        reporter: string;
        labels?: string[];
        components?: string[];
        sprint?: string | null;
        linkedIssues?: string;
        createdAt: string;
        updatedAt: string;
        url: string;
        parentId?: string;
        search_context?: string;
        // Relevance weights
        relevance_score?: number;
        is_assigned_to_me?: boolean;
        priority_weight?: number;
        days_since_update?: number;
    };
}

// Slack Document
export interface SlackDocument extends BaseDocument {
    source: 'slack';
    metadata: {
        id: string;
        source: 'slack';
        type: 'message' | 'thread_reply';
        title: string;
        channel: string;
        channelId: string;
        author: string;
        authorId: string;
        threadTs: string | null;
        timestamp: string;
        hasAttachments: boolean;
        mentionedUsers: string[];
        url: string;
        parentId?: string;
        search_context?: string;
        // Reaction metadata
        reactionCount?: number;
        topReactions?: string[];
        // Bot indicator
        is_bot?: boolean;
        // Relevance weights
        relevance_score?: number;
        channel_type?: 'dm' | 'private' | 'public' | 'mpim';
        is_thread_participant?: boolean;
        mention_count?: number;
    };
}

// Gmail Document
export interface GmailDocument extends BaseDocument {
    source: 'gmail';
    metadata: {
        id: string;
        source: 'gmail';
        type: 'email';
        title: string;
        subject: string;
        from: string;
        to: string[];
        cc: string[];
        labels: string[];
        threadId: string;
        date: string;
        url: string;
        search_context?: string;
        // Relevance weights
        relevance_score?: number;
        is_internal?: boolean;
        thread_depth?: number;
        recipient_count?: number;
    };
}

// Google Drive Document
export interface DriveDocument extends BaseDocument {
    source: 'drive';
    metadata: {
        id: string;
        source: 'drive';
        type: 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'other';
        title: string;
        name: string;
        mimeType: string;
        path: string;
        folderPath: string;
        owner: string;
        createdAt: string;
        modifiedAt: string;
        url: string;
        search_context?: string;
        // Relevance weights
        relevance_score?: number;
        is_owner?: boolean;
        days_since_modified?: number;
    };
}

// Confluence Document
export interface ConfluenceDocument extends BaseDocument {
    source: 'confluence';
    metadata: {
        id: string;
        source: 'confluence';
        type: 'page' | 'blogpost' | 'comment';
        title: string;
        space: string;
        spaceName: string;
        author: string;
        labels: string[];
        ancestors: string[];
        createdAt: string;
        updatedAt: string;
        url: string;
        parentId?: string;
        search_context?: string;
        // Relevance weights
        relevance_score?: number;
        label_count?: number;
        hierarchy_depth?: number;
    };
}

// Calendar Document
export interface CalendarDocument extends BaseDocument {
    source: 'calendar';
    metadata: {
        id: string;
        source: 'calendar';
        type: 'event';
        title: string;
        summary: string;
        description?: string;
        location?: string;
        start: string;
        end: string;
        attendees: string[];
        organizer: string;
        status: string;
        url: string;
        createdAt?: string;
        updatedAt?: string;
        search_context?: string;
        // Relevance weights
        relevance_score?: number;
        is_organizer?: boolean;
        attendee_count?: number;
        is_recurring?: boolean;
    };
}

// GitHub Document
export interface GitHubDocument extends BaseDocument {
    source: 'github';
    preChunked?: { chunks: string[] };
    metadata: {
        id: string;
        source: 'github';
        type: 'repository' | 'issue' | 'pull_request' | 'pr_review' | 'pr_comment' | 'file';
        title: string;
        repo: string;
        number?: number;
        state?: string;
        author: string;
        labels?: string[];
        milestone?: string | null;
        assignees?: string[];
        createdAt: string;
        updatedAt: string;
        url: string;
        parentId?: string;
        search_context?: string;
        // File-specific metadata
        filePath?: string;
        fileExtension?: string;
        fileLanguage?: string;
        fileSha?: string;
        fileSize?: number;
        // Relevance weights
        relevance_score?: number;
        is_assigned_to_me?: boolean;
        is_author?: boolean;
    };
}

export type IndexDocument = JiraDocument | SlackDocument | GmailDocument | DriveDocument | ConfluenceDocument | CalendarDocument | GitHubDocument;

// Cursor/Checkpoint Types
export interface Cursor {
    source: DataSource;
    lastSync: string;
    syncToken?: string;
    metadata?: {
        configKey?: string;
        [key: string]: any;
    };
}

// API Types
export interface IndexRequest {
    fullReindex?: boolean;
    projectKeys?: string[];    // For Jira
    channelIds?: string[];     // For Slack
    spaceKeys?: string[];      // For Confluence
    folderIds?: string[];      // For Drive
    gmailSettings?: GmailSettings;
    calendarIds?: string[];    // For Calendar
    repos?: string[];          // For GitHub
    indexFiles?: boolean;      // For GitHub file indexing
}

export interface IndexStatus {
    source: DataSource;
    status: 'idle' | 'running' | 'completed' | 'error';
    lastSync: string | null;
    documentsIndexed: number;
    error?: string;
    lastError?: string;
    lastErrorAt?: string;
}

export interface IndexResponse {
    status: 'started' | 'already_running' | 'error';
    source: DataSource;
    message?: string;
}

// Settings Types
export interface DriveSettings {
    folderIds: string[];
}

export interface GmailSettings {
    domains: string[];
    senders: string[];
    labels: string[];
}

export interface SlackSettings {
    channelIds: string[];
}

export interface JiraSettings {
    projectKeys: string[];
}

export interface ConfluenceSettings {
    spaceKeys: string[];
}

export interface CalendarSettings {
    calendarIds: string[];
}

export interface GitHubSettings {
    repos: string[];
    indexFiles?: boolean;
}

export type SourceSettings = DriveSettings | GmailSettings | SlackSettings | JiraSettings | ConfluenceSettings | CalendarSettings | GitHubSettings;

// Connector Interface
export interface ConnectorResult {
    documents: IndexDocument[];
    newCursor: Partial<Cursor>;
    hasMore: boolean;
    batchLastSync?: string; // The timestamp of the last item in this batch
}

// Search Types
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
    source: DataSource;
    content: string;
    metadata: Record<string, unknown>;
    score: number;
}

// Navigation Types
export interface NavigationRequest {
    documentId: string;
    direction: 'prev' | 'next' | 'siblings' | 'parent' | 'children';
    scope: 'chunk' | 'datapoint' | 'context';
    limit?: number;
}

export interface NavigationResult {
    current: SearchResult | null;
    related: SearchResult[];
    navigation: {
        hasPrev: boolean;
        hasNext: boolean;
        parentId: string | null;
        contextType: string;
        totalSiblings?: number;
    };
}
