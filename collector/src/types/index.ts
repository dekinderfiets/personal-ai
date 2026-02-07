// Data Source Types
export type DataSource = 'jira' | 'slack' | 'gmail' | 'drive' | 'confluence' | 'calendar';

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
        createdAt: string;
        updatedAt: string;
        url: string;
        parentId?: string;
        search_context?: string;
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
        owner: string;
        createdAt: string;
        modifiedAt: string;
        url: string;
        search_context?: string;
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
    };
}

export type IndexDocument = JiraDocument | SlackDocument | GmailDocument | DriveDocument | ConfluenceDocument | CalendarDocument;

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

export type SourceSettings = DriveSettings | GmailSettings | SlackSettings | JiraSettings | ConfluenceSettings | CalendarSettings;

// Connector Interface
export interface ConnectorResult {
    documents: IndexDocument[];
    newCursor: Partial<Cursor>;
    hasMore: boolean;
    batchLastSync?: string; // The timestamp of the last item in this batch
}

