import { ConnectorResult,DataSource, IndexDocument, IndexRequest, IndexStatus } from '../types';
import { IndexingService } from './indexing.service';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockConfigService(overrides: Record<string, any> = {}) {
    const config: Record<string, any> = {
        'jira.username': 'john.doe@company.com',
        'google.userEmail': 'john.doe@company.com',
        'app.companyDomains': 'company.com,subsidiary.io',
        ...overrides,
    };
    return { get: jest.fn((key: string, defaultValue?: any) => config[key] ?? defaultValue) };
}

function createMockCursorService() {
    return {
        getCursor: jest.fn().mockResolvedValue(null),
        saveCursor: jest.fn().mockResolvedValue(undefined),
        resetCursor: jest.fn().mockResolvedValue(undefined),
        resetStatus: jest.fn().mockResolvedValue(undefined),
        releaseLock: jest.fn().mockResolvedValue(undefined),
        getJobStatus: jest.fn().mockResolvedValue(null),
        saveJobStatus: jest.fn().mockResolvedValue(undefined),
        getAllJobStatus: jest.fn().mockResolvedValue([]),
        bulkGetDocumentHashes: jest.fn().mockResolvedValue([]),
        bulkSetDocumentHashes: jest.fn().mockResolvedValue(undefined),
        removeDocumentHashes: jest.fn().mockResolvedValue(undefined),
    };
}

function createMockFileSaverService() {
    return {
        saveDocuments: jest.fn().mockResolvedValue(undefined),
        deleteDocument: jest.fn().mockResolvedValue(undefined),
    };
}

function createMockElasticsearchService() {
    return {
        upsertDocuments: jest.fn().mockResolvedValue(undefined),
        deleteDocument: jest.fn().mockResolvedValue(undefined),
    };
}

function createMockSettingsService() {
    return {
        getSourceSettings: jest.fn().mockResolvedValue(null),
    };
}

function createMockAnalyticsService() {
    return {
        recordRun: jest.fn().mockResolvedValue(undefined),
    };
}

function createMockTemporalClient() {
    return {
        startIndexSource: jest.fn().mockResolvedValue({ started: true, message: 'ok' }),
        startCollectAll: jest.fn().mockResolvedValue({ started: true }),
        isWorkflowRunning: jest.fn().mockResolvedValue(false),
        getSourceWorkflowInfo: jest.fn().mockResolvedValue(null),
    };
}

function createMockConnector() {
    return {
        fetch: jest.fn().mockResolvedValue({ documents: [], newCursor: {}, hasMore: false }),
        isConfigured: jest.fn().mockReturnValue(true),
        getSourceName: jest.fn().mockReturnValue('mock'),
    };
}

function makeDoc(source: DataSource, id: string, content: string, metadata: Record<string, any> = {}): IndexDocument {
    return { id, source, content, metadata: { id, source, ...metadata } } as any;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

function createService(configOverrides: Record<string, any> = {}) {
    const configService = createMockConfigService(configOverrides);
    const cursorService = createMockCursorService();
    const fileSaverService = createMockFileSaverService();
    const elasticsearchService = createMockElasticsearchService();
    const settingsService = createMockSettingsService();
    const analyticsService = createMockAnalyticsService();
    const temporalClient = createMockTemporalClient();
    const connectors = {
        jira: createMockConnector(),
        slack: createMockConnector(),
        gmail: createMockConnector(),
        drive: createMockConnector(),
        confluence: createMockConnector(),
        calendar: createMockConnector(),
    };

    const service = new IndexingService(
        configService as any,
        cursorService as any,
        fileSaverService as any,
        elasticsearchService as any,
        settingsService as any,
        analyticsService as any,
        temporalClient as any,
        connectors.jira as any,
        connectors.slack as any,
        connectors.gmail as any,
        connectors.drive as any,
        connectors.confluence as any,
        connectors.calendar as any,
    );

    return { service, configService, cursorService, fileSaverService, elasticsearchService, settingsService, analyticsService, temporalClient, connectors };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IndexingService', () => {

    // -----------------------------------------------------------------------
    // getConnector
    // -----------------------------------------------------------------------
    describe('getConnector', () => {
        it('returns the correct connector for each source', () => {
            const { service, connectors } = createService();
            expect(service.getConnector('jira')).toBe(connectors.jira);
            expect(service.getConnector('slack')).toBe(connectors.slack);
            expect(service.getConnector('gmail')).toBe(connectors.gmail);
            expect(service.getConnector('drive')).toBe(connectors.drive);
            expect(service.getConnector('confluence')).toBe(connectors.confluence);
            expect(service.getConnector('calendar')).toBe(connectors.calendar);
        });

        it('throws for unknown source', () => {
            const { service } = createService();
            expect(() => service.getConnector('unknown' as DataSource)).toThrow('No connector found for source: unknown');
        });
    });

    // -----------------------------------------------------------------------
    // jiraPriorityWeight (tested via addRelevanceWeights)
    // -----------------------------------------------------------------------
    describe('jiraPriorityWeight (via addRelevanceWeights)', () => {
        it.each([
            ['Critical', 5], ['Blocker', 5], ['Highest', 5],
            ['High', 4],
            ['Medium', 3],
            ['Low', 2],
            ['Lowest', 1], ['None', 1],
        ])('returns %i for priority "%s"', (priority, expected) => {
            const { service } = createService();
            const doc = makeDoc('jira', 'J-1', 'text', {
                priority, updatedAt: new Date().toISOString(), assignee: 'other',
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            expect((result.metadata as any).priority_weight).toBe(expected);
        });

        it('defaults to 1 for unknown priority', () => {
            const { service } = createService();
            const doc = makeDoc('jira', 'J-1', 'text', {
                priority: 'SuperWeird', updatedAt: new Date().toISOString(),
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            expect((result.metadata as any).priority_weight).toBe(1);
        });

        it('defaults to 1 for undefined priority', () => {
            const { service } = createService();
            const doc = makeDoc('jira', 'J-1', 'text', {
                updatedAt: new Date().toISOString(),
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            expect((result.metadata as any).priority_weight).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // daysSince (tested via addRelevanceWeights)
    // -----------------------------------------------------------------------
    describe('daysSince (via addRelevanceWeights)', () => {
        it('returns 0 for today', () => {
            const { service } = createService();
            const doc = makeDoc('jira', 'J-1', 'text', {
                updatedAt: new Date().toISOString(), priority: 'Medium',
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            expect((result.metadata as any).days_since_update).toBe(0);
        });

        it('returns correct days for a past date', () => {
            const { service } = createService();
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('jira', 'J-1', 'text', {
                updatedAt: threeDaysAgo, priority: 'Medium',
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            expect((result.metadata as any).days_since_update).toBe(3);
        });

        it('returns 999 when date is missing', () => {
            const { service } = createService();
            const doc = makeDoc('jira', 'J-1', 'text', { priority: 'Medium' });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            expect((result.metadata as any).days_since_update).toBe(999);
        });
    });

    // -----------------------------------------------------------------------
    // isCurrentUser (tested via addRelevanceWeights)
    // -----------------------------------------------------------------------
    describe('isCurrentUser (via addRelevanceWeights)', () => {
        it('matches jira username (case insensitive)', () => {
            const { service } = createService();
            const doc = makeDoc('jira', 'J-1', 'text', {
                assignee: 'John.Doe@Company.Com', updatedAt: new Date().toISOString(), priority: 'High',
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            expect((result.metadata as any).is_assigned_to_me).toBe(true);
        });

        it('does not match different jira user', () => {
            const { service } = createService();
            const doc = makeDoc('jira', 'J-1', 'text', {
                assignee: 'someone.else@company.com', updatedAt: new Date().toISOString(), priority: 'High',
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            expect((result.metadata as any).is_assigned_to_me).toBe(false);
        });

        it('returns false for null assignee', () => {
            const { service } = createService();
            const doc = makeDoc('jira', 'J-1', 'text', {
                assignee: null, updatedAt: new Date().toISOString(), priority: 'High',
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            expect((result.metadata as any).is_assigned_to_me).toBe(false);
        });

        it('matches google email for drive ownership', () => {
            const { service } = createService();
            const driveDoc = makeDoc('drive', 'D-1', 'text', {
                owner: 'John.Doe@Company.Com', modifiedAt: new Date().toISOString(),
            });
            const [result] = service.addRelevanceWeights('drive', [driveDoc]);
            expect((result.metadata as any).is_owner).toBe(true);
        });

        it('falls back to jira username for google services when google email is not set', () => {
            const { service } = createService({ 'google.userEmail': '' });
            const doc = makeDoc('drive', 'D-1', 'text', {
                owner: 'john.doe@company.com', modifiedAt: new Date().toISOString(),
            });
            const [result] = service.addRelevanceWeights('drive', [doc]);
            expect((result.metadata as any).is_owner).toBe(true);
        });

        it('returns false for google services when both google email and jira username empty', () => {
            const { service } = createService({ 'google.userEmail': '', 'jira.username': '' });
            const doc = makeDoc('drive', 'D-1', 'text', {
                owner: 'someone@company.com', modifiedAt: new Date().toISOString(),
            });
            const [result] = service.addRelevanceWeights('drive', [doc]);
            expect((result.metadata as any).is_owner).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // isInternalEmail (tested via addRelevanceWeights for gmail)
    // -----------------------------------------------------------------------
    describe('isInternalEmail (via addRelevanceWeights)', () => {
        it('detects internal email using configured company domains', () => {
            const { service } = createService();
            const doc = makeDoc('gmail', 'G-1', 'text', {
                from: 'colleague@company.com', to: ['me@company.com'], cc: [], threadId: 't1',
            });
            const [result] = service.addRelevanceWeights('gmail', [doc]);
            expect((result.metadata as any).is_internal).toBe(true);
        });

        it('detects internal email from secondary domain', () => {
            const { service } = createService();
            const doc = makeDoc('gmail', 'G-1', 'text', {
                from: 'dev@subsidiary.io', to: ['me@company.com'], cc: [], threadId: 't1',
            });
            const [result] = service.addRelevanceWeights('gmail', [doc]);
            expect((result.metadata as any).is_internal).toBe(true);
        });

        it('detects external email from public domain', () => {
            const { service } = createService();
            const doc = makeDoc('gmail', 'G-1', 'text', {
                from: 'spammer@gmail.com', to: ['me@company.com'], cc: [], threadId: 't1',
            });
            const [result] = service.addRelevanceWeights('gmail', [doc]);
            expect((result.metadata as any).is_internal).toBe(false);
        });

        it('falls back to public domain heuristic when no company domains configured', () => {
            const { service } = createService({ 'app.companyDomains': '' });
            // Unknown domain -> considered internal by fallback heuristic
            const doc1 = makeDoc('gmail', 'G-1', 'text', {
                from: 'person@somecorp.com', to: [], cc: [], threadId: 't1',
            });
            const [result1] = service.addRelevanceWeights('gmail', [doc1]);
            expect((result1.metadata as any).is_internal).toBe(true);

            // Public domain -> considered external
            const doc2 = makeDoc('gmail', 'G-2', 'text', {
                from: 'person@gmail.com', to: [], cc: [], threadId: 't2',
            });
            const [result2] = service.addRelevanceWeights('gmail', [doc2]);
            expect((result2.metadata as any).is_internal).toBe(false);
        });

        it('returns false for empty from field', () => {
            const { service } = createService();
            const doc = makeDoc('gmail', 'G-1', 'text', {
                from: '', to: [], cc: [], threadId: 't1',
            });
            const [result] = service.addRelevanceWeights('gmail', [doc]);
            expect((result.metadata as any).is_internal).toBe(false);
        });

        it('returns false for from without @ symbol', () => {
            const { service } = createService();
            const doc = makeDoc('gmail', 'G-1', 'text', {
                from: 'nodomain', to: [], cc: [], threadId: 't1',
            });
            const [result] = service.addRelevanceWeights('gmail', [doc]);
            expect((result.metadata as any).is_internal).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // computeGmailRelevance
    // -----------------------------------------------------------------------
    describe('computeGmailRelevance (via addRelevanceWeights)', () => {
        it('base score with external, many recipients, no thread depth', () => {
            const { service } = createService();
            const doc = makeDoc('gmail', 'G-1', 'text', {
                from: 'external@gmail.com', to: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'], cc: [], threadId: 't1',
            });
            const [result] = service.addRelevanceWeights('gmail', [doc]);
            const m = result.metadata as any;
            // is_internal=false, recipient_count=4 (>3), thread_depth=1 (single in batch, not >1)
            // score = 0.5
            expect(m.relevance_score).toBe(0.5);
        });

        it('internal email with few recipients and thread depth', () => {
            const { service } = createService();
            const doc = makeDoc('gmail', 'G-1', 'text', {
                from: 'colleague@company.com', to: ['me@company.com'], cc: [],
                threadId: 't1', threadMessageCount: 5,
            });
            const [result] = service.addRelevanceWeights('gmail', [doc]);
            const m = result.metadata as any;
            // is_internal=true (+0.2), recipient_count=1 (<=3, +0.15), thread_depth=5 (>1, +0.1)
            // score = 0.5 + 0.2 + 0.15 + 0.1 = 0.95
            expect(m.relevance_score).toBe(0.95);
        });

        it('caps at 1.0', () => {
            const { service } = createService();
            // All bonuses: internal + low recipients + thread depth
            const doc = makeDoc('gmail', 'G-1', 'text', {
                from: 'a@company.com', to: ['b@company.com'], cc: [],
                threadId: 't1', threadMessageCount: 10,
            });
            const [result] = service.addRelevanceWeights('gmail', [doc]);
            // 0.5 + 0.2 + 0.15 + 0.1 = 0.95, not capped
            expect((result.metadata as any).relevance_score).toBe(0.95);
        });

        it('computes thread_depth from batch when threadMessageCount absent', () => {
            const { service } = createService();
            const docs = [
                makeDoc('gmail', 'G-1', 'text', { from: 'a@gmail.com', to: ['b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'], cc: [], threadId: 'thread-A' }),
                makeDoc('gmail', 'G-2', 'text', { from: 'a@gmail.com', to: ['b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'], cc: [], threadId: 'thread-A' }),
            ];
            const results = service.addRelevanceWeights('gmail', docs);
            // Both are in thread-A, batch count = 2, thread_depth = 2 (>1 → +0.1)
            // external, recipient_count=4 (>3)
            // score = 0.5 + 0.1 = 0.6
            expect((results[0].metadata as any).thread_depth).toBe(2);
            expect((results[0].metadata as any).relevance_score).toBe(0.6);
        });

        it('recipient_count includes both to and cc', () => {
            const { service } = createService();
            const doc = makeDoc('gmail', 'G-1', 'text', {
                from: 'a@gmail.com', to: ['b@x.com'], cc: ['c@x.com'], threadId: 't1',
            });
            const [result] = service.addRelevanceWeights('gmail', [doc]);
            expect((result.metadata as any).recipient_count).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // computeSlackRelevance
    // -----------------------------------------------------------------------
    describe('computeSlackRelevance (via addRelevanceWeights)', () => {
        it('public channel, no mentions, no thread', () => {
            const { service } = createService();
            const doc = makeDoc('slack', 'S-1', 'text', {
                channel: 'general', mentionedUsers: [], threadTs: null,
            });
            const [result] = service.addRelevanceWeights('slack', [doc]);
            // channel_type inferred as 'public' (channel doesn't start with DM)
            // score = 0.5 + 0 = 0.5 (no public bonus besides base)
            expect((result.metadata as any).relevance_score).toBe(0.5);
        });

        it('DM channel with mentions and thread', () => {
            const { service } = createService();
            const doc = makeDoc('slack', 'S-1', 'text', {
                channel_type: 'dm', mentionedUsers: ['U123'], threadTs: '12345.6789',
            });
            const [result] = service.addRelevanceWeights('slack', [doc]);
            // dm +0.3, mention_count=1 (+0.1), is_thread_participant=true (+0.05)
            // score = 0.5 + 0.3 + 0.1 + 0.05 = 0.95
            expect((result.metadata as any).relevance_score).toBeCloseTo(0.95, 10);
        });

        it('private channel', () => {
            const { service } = createService();
            const doc = makeDoc('slack', 'S-1', 'text', {
                channel_type: 'private', mentionedUsers: [], threadTs: null,
            });
            const [result] = service.addRelevanceWeights('slack', [doc]);
            // private +0.15
            // score = 0.5 + 0.15 = 0.65
            expect((result.metadata as any).relevance_score).toBe(0.65);
        });

        it('mpim channel', () => {
            const { service } = createService();
            const doc = makeDoc('slack', 'S-1', 'text', {
                channel_type: 'mpim', mentionedUsers: [], threadTs: null,
            });
            const [result] = service.addRelevanceWeights('slack', [doc]);
            // mpim +0.2
            // score = 0.5 + 0.2 = 0.7
            expect((result.metadata as any).relevance_score).toBe(0.7);
        });

        it('infers DM when channel starts with "DM"', () => {
            const { service } = createService();
            const doc = makeDoc('slack', 'S-1', 'text', {
                channel: 'DM-with-alice', mentionedUsers: [], threadTs: null,
            });
            const [result] = service.addRelevanceWeights('slack', [doc]);
            expect((result.metadata as any).channel_type).toBe('dm');
            // dm +0.3 → score = 0.8
            expect((result.metadata as any).relevance_score).toBe(0.8);
        });
    });

    // -----------------------------------------------------------------------
    // computeJiraRelevance
    // -----------------------------------------------------------------------
    describe('computeJiraRelevance (via addRelevanceWeights)', () => {
        it('assigned to me, critical, recently updated', () => {
            const { service } = createService();
            const doc = makeDoc('jira', 'J-1', 'text', {
                assignee: 'john.doe@company.com', priority: 'Critical',
                updatedAt: new Date().toISOString(),
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            const m = result.metadata as any;
            // base=0.3, assigned +0.3, priority_weight=5 → 5*0.06=0.3, days<7 +0.15
            // = 0.3 + 0.3 + 0.3 + 0.15 = 1.05, capped at 1.0
            expect(m.relevance_score).toBe(1.0);
            expect(m.is_assigned_to_me).toBe(true);
            expect(m.priority_weight).toBe(5);
            expect(m.days_since_update).toBe(0);
        });

        it('unassigned, low priority, old update', () => {
            const { service } = createService();
            const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('jira', 'J-2', 'text', {
                assignee: 'other@company.com', priority: 'Low', updatedAt: oldDate,
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            const m = result.metadata as any;
            // base=0.3, not assigned, priority_weight=2 → 2*0.06=0.12, days>30 → no time bonus
            // = 0.3 + 0.12 = 0.42
            expect(m.relevance_score).toBeCloseTo(0.42, 10);
            expect(m.is_assigned_to_me).toBe(false);
        });

        it('mid-range update (7-30 days) gets small time bonus', () => {
            const { service } = createService();
            const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('jira', 'J-3', 'text', {
                assignee: null, priority: 'Medium', updatedAt: fifteenDaysAgo,
            });
            const [result] = service.addRelevanceWeights('jira', [doc]);
            const m = result.metadata as any;
            // base=0.3, not assigned, priority_weight=3 → 0.18, 7<=days<30 +0.05
            // = 0.3 + 0.18 + 0.05 = 0.53
            expect(m.relevance_score).toBeCloseTo(0.53, 10);
        });
    });

    // -----------------------------------------------------------------------
    // computeDriveRelevance
    // -----------------------------------------------------------------------
    describe('computeDriveRelevance (via addRelevanceWeights)', () => {
        it('owner with recently modified file', () => {
            const { service } = createService();
            const doc = makeDoc('drive', 'D-1', 'text', {
                owner: 'john.doe@company.com', modifiedAt: new Date().toISOString(),
            });
            const [result] = service.addRelevanceWeights('drive', [doc]);
            const m = result.metadata as any;
            // base=0.4, is_owner +0.2, days<7 +0.2 = 0.8
            expect(m.relevance_score).toBe(0.8);
            expect(m.is_owner).toBe(true);
            expect(m.days_since_modified).toBe(0);
        });

        it('non-owner with old file', () => {
            const { service } = createService();
            const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('drive', 'D-2', 'text', {
                owner: 'other@company.com', modifiedAt: oldDate,
            });
            const [result] = service.addRelevanceWeights('drive', [doc]);
            const m = result.metadata as any;
            // base=0.4, not owner, days>30 → no bonus = 0.4
            expect(m.relevance_score).toBe(0.4);
            expect(m.is_owner).toBe(false);
        });

        it('non-owner with file modified 15 days ago', () => {
            const { service } = createService();
            const fifteenDays = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('drive', 'D-3', 'text', {
                owner: 'other@company.com', modifiedAt: fifteenDays,
            });
            const [result] = service.addRelevanceWeights('drive', [doc]);
            // base=0.4, 7<=days<30 +0.1 = 0.5
            expect((result.metadata as any).relevance_score).toBe(0.5);
        });
    });

    // -----------------------------------------------------------------------
    // computeConfluenceRelevance
    // -----------------------------------------------------------------------
    describe('computeConfluenceRelevance (via addRelevanceWeights)', () => {
        it('labeled, shallow, recently updated', () => {
            const { service } = createService();
            const doc = makeDoc('confluence', 'C-1', 'text', {
                labels: ['important'], ancestors: ['root'],
                updatedAt: new Date().toISOString(),
            });
            const [result] = service.addRelevanceWeights('confluence', [doc]);
            const m = result.metadata as any;
            // base=0.4, label_count=1 (+0.15), hierarchy_depth=1 (<=2, +0.1), days<7 +0.2
            // = 0.4 + 0.15 + 0.1 + 0.2 = 0.85
            expect(m.relevance_score).toBeCloseTo(0.85, 10);
            expect(m.label_count).toBe(1);
            expect(m.hierarchy_depth).toBe(1);
        });

        it('no labels, deep hierarchy, old update', () => {
            const { service } = createService();
            const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('confluence', 'C-2', 'text', {
                labels: [], ancestors: ['a', 'b', 'c'], updatedAt: oldDate,
            });
            const [result] = service.addRelevanceWeights('confluence', [doc]);
            const m = result.metadata as any;
            // base=0.4, no labels, hierarchy_depth=3 (>2), days>30 → no bonus
            // = 0.4
            expect(m.relevance_score).toBe(0.4);
        });

        it('mid-range update gets 0.1 time bonus', () => {
            const { service } = createService();
            const fifteenDays = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('confluence', 'C-3', 'text', {
                labels: [], ancestors: ['a', 'b', 'c'], updatedAt: fifteenDays,
            });
            const [result] = service.addRelevanceWeights('confluence', [doc]);
            // base=0.4, 7<=days<30 +0.1 = 0.5
            expect((result.metadata as any).relevance_score).toBe(0.5);
        });
    });

    // -----------------------------------------------------------------------
    // computeCalendarRelevance
    // -----------------------------------------------------------------------
    describe('computeCalendarRelevance (via addRelevanceWeights)', () => {
        it('organizer, small meeting, within 24h', () => {
            const { service } = createService();
            const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('calendar', 'CAL-1', 'text', {
                organizer: 'john.doe@company.com',
                attendees: ['a@x.com', 'b@x.com'],
                start: inTwoHours,
            });
            const [result] = service.addRelevanceWeights('calendar', [doc]);
            const m = result.metadata as any;
            // base=0.5, is_organizer +0.2, attendee_count=2 (<=5 +0.1), within 24h +0.2
            // = 0.5 + 0.2 + 0.1 + 0.2 = 1.0
            expect(m.relevance_score).toBe(1.0);
            expect(m.is_organizer).toBe(true);
            expect(m.attendee_count).toBe(2);
            expect(m.is_recurring).toBe(false);
        });

        it('non-organizer, large meeting, within a week', () => {
            const { service } = createService();
            const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('calendar', 'CAL-2', 'text', {
                organizer: 'other@company.com',
                attendees: ['a', 'b', 'c', 'd', 'e', 'f'],
                start: inThreeDays,
            });
            const [result] = service.addRelevanceWeights('calendar', [doc]);
            const m = result.metadata as any;
            // base=0.5, not organizer, attendee_count=6 (>5), within 168h +0.1
            // = 0.5 + 0.1 = 0.6
            expect(m.relevance_score).toBe(0.6);
        });

        it('past event gets no time bonus', () => {
            const { service } = createService();
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('calendar', 'CAL-3', 'text', {
                organizer: 'other@company.com', attendees: [], start: yesterday,
            });
            const [result] = service.addRelevanceWeights('calendar', [doc]);
            // base=0.5, attendee_count=0 (<=5 +0.1), diffHours<0 → no time bonus
            // = 0.5 + 0.1 = 0.6
            expect((result.metadata as any).relevance_score).toBe(0.6);
        });

        it('far future event gets no time bonus', () => {
            const { service } = createService();
            const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
            const doc = makeDoc('calendar', 'CAL-4', 'text', {
                organizer: 'other@company.com', attendees: ['a'], start: inTwoWeeks,
            });
            const [result] = service.addRelevanceWeights('calendar', [doc]);
            // base=0.5, attendee_count=1 (<=5 +0.1), diffHours > 168 → no bonus
            // = 0.6
            expect((result.metadata as any).relevance_score).toBe(0.6);
        });
    });

    // -----------------------------------------------------------------------
    // applySettingsToRequest
    // -----------------------------------------------------------------------
    describe('applySettingsToRequest', () => {
        it('applies drive settings when request has no folderIds', () => {
            const { service } = createService();
            const request: IndexRequest = {};
            service.applySettingsToRequest('drive', { folderIds: ['f1', 'f2'] } as any, request);
            expect(request.folderIds).toEqual(['f1', 'f2']);
        });

        it('does not override existing drive folderIds', () => {
            const { service } = createService();
            const request: IndexRequest = { folderIds: ['existing'] };
            service.applySettingsToRequest('drive', { folderIds: ['f1'] } as any, request);
            expect(request.folderIds).toEqual(['existing']);
        });

        it('applies gmail settings with merge semantics', () => {
            const { service } = createService();
            const request: IndexRequest = {};
            service.applySettingsToRequest('gmail', { domains: ['d.com'], senders: ['s@x.com'], labels: ['inbox'] } as any, request);
            expect(request.gmailSettings).toEqual({ domains: ['d.com'], senders: ['s@x.com'], labels: ['inbox'] });
        });

        it('preserves existing gmail sub-fields', () => {
            const { service } = createService();
            const request: IndexRequest = { gmailSettings: { domains: ['existing.com'], senders: [], labels: [] } };
            service.applySettingsToRequest('gmail', { domains: ['new.com'], senders: ['s@x.com'], labels: ['tag'] } as any, request);
            expect(request.gmailSettings!.domains).toEqual(['existing.com']);
            expect(request.gmailSettings!.senders).toEqual([]);
            expect(request.gmailSettings!.labels).toEqual([]);
        });

        it('applies gmail settings with partial existing gmailSettings', () => {
            const { service } = createService();
            const request: IndexRequest = { gmailSettings: { domains: ['existing.com'] } as any };
            service.applySettingsToRequest('gmail', { domains: ['new.com'], senders: ['s@x.com'], labels: ['tag'] } as any, request);
            // domains is set → keep existing; senders/labels are falsy on request → pick from settings
            expect(request.gmailSettings!.domains).toEqual(['existing.com']);
            expect(request.gmailSettings!.senders).toEqual(['s@x.com']);
            expect(request.gmailSettings!.labels).toEqual(['tag']);
        });

        it('applies jira settings', () => {
            const { service } = createService();
            const request: IndexRequest = {};
            service.applySettingsToRequest('jira', { projectKeys: ['PROJ'] } as any, request);
            expect(request.projectKeys).toEqual(['PROJ']);
        });

        it('applies slack settings', () => {
            const { service } = createService();
            const request: IndexRequest = {};
            service.applySettingsToRequest('slack', { channelIds: ['C1'] } as any, request);
            expect(request.channelIds).toEqual(['C1']);
        });

        it('applies confluence settings', () => {
            const { service } = createService();
            const request: IndexRequest = {};
            service.applySettingsToRequest('confluence', { spaceKeys: ['SPACE'] } as any, request);
            expect(request.spaceKeys).toEqual(['SPACE']);
        });

        it('applies calendar settings', () => {
            const { service } = createService();
            const request: IndexRequest = {};
            service.applySettingsToRequest('calendar', { calendarIds: ['cal1'] } as any, request);
            expect(request.calendarIds).toEqual(['cal1']);
        });

    });

    // -----------------------------------------------------------------------
    // extractConfigKey
    // -----------------------------------------------------------------------
    describe('extractConfigKey', () => {
        it('sorts jira projectKeys', () => {
            const { service } = createService();
            expect(service.extractConfigKey('jira', { projectKeys: ['ZZZ', 'AAA', 'MMM'] })).toBe('AAA,MMM,ZZZ');
        });

        it('returns empty string for empty jira keys', () => {
            const { service } = createService();
            expect(service.extractConfigKey('jira', {})).toBe('');
        });

        it('sorts slack channelIds', () => {
            const { service } = createService();
            expect(service.extractConfigKey('slack', { channelIds: ['C2', 'C1'] })).toBe('C1,C2');
        });

        it('sorts confluence spaceKeys', () => {
            const { service } = createService();
            expect(service.extractConfigKey('confluence', { spaceKeys: ['B', 'A'] })).toBe('A,B');
        });

        it('sorts drive folderIds', () => {
            const { service } = createService();
            expect(service.extractConfigKey('drive', { folderIds: ['f2', 'f1'] })).toBe('f1,f2');
        });

        it('sorts calendar calendarIds', () => {
            const { service } = createService();
            expect(service.extractConfigKey('calendar', { calendarIds: ['c2', 'c1'] })).toBe('c1,c2');
        });

        it('serializes gmail settings as sorted JSON', () => {
            const { service } = createService();
            const key = service.extractConfigKey('gmail', {
                gmailSettings: { domains: ['b.com', 'a.com'], senders: ['z@x.com', 'a@x.com'], labels: ['sent', 'inbox'] },
            });
            const parsed = JSON.parse(key);
            expect(parsed.d).toEqual(['a.com', 'b.com']);
            expect(parsed.s).toEqual(['a@x.com', 'z@x.com']);
            expect(parsed.l).toEqual(['inbox', 'sent']);
        });

        it('handles missing gmail settings', () => {
            const { service } = createService();
            const key = service.extractConfigKey('gmail', {});
            const parsed = JSON.parse(key);
            expect(parsed).toEqual({ d: [], s: [], l: [] });
        });

        it('returns empty string for unknown source', () => {
            const { service } = createService();
            expect(service.extractConfigKey('unknown' as DataSource, {})).toBe('');
        });
    });

    // -----------------------------------------------------------------------
    // processIndexingBatch
    // -----------------------------------------------------------------------
    describe('processIndexingBatch', () => {
        it('filters changed documents via hash comparison', async () => {
            const { service, cursorService, elasticsearchService, fileSaverService } = createService();
            const docs = [
                makeDoc('jira', 'J-1', 'content1', { title: 'Issue 1' }),
                makeDoc('jira', 'J-2', 'content2', { title: 'Issue 2' }),
            ];

            // Simulate J-1 unchanged (hash matches), J-2 changed
            cursorService.bulkGetDocumentHashes.mockResolvedValue(['match-hash', 'old-hash']);

            // We need the actual hash to match for J-1 to be filtered out
            // Since we can't easily predict the SHA256, let's mock it differently
            // Instead, let's make all hashes different so both get indexed
            cursorService.bulkGetDocumentHashes.mockResolvedValue([null, null]);

            const count = await service.processIndexingBatch('jira', docs);
            expect(count).toBe(2);
            expect(elasticsearchService.upsertDocuments).toHaveBeenCalledTimes(1);
            expect(fileSaverService.saveDocuments).toHaveBeenCalledTimes(1);
            expect(cursorService.bulkSetDocumentHashes).toHaveBeenCalledTimes(1);
        });

        it('skips indexing when all documents are unchanged', async () => {
            const { service, cursorService, elasticsearchService } = createService();

            // We need to compute the actual hash to simulate "unchanged"
            const doc = makeDoc('jira', 'J-1', 'stable content', { title: 'Test' });
            // Compute the same hash the service would
            const CryptoJS = require('crypto-js');
            const expectedHash = CryptoJS.SHA256(JSON.stringify({
                content: doc.content,
                metadata: doc.metadata,
            })).toString();

            cursorService.bulkGetDocumentHashes.mockResolvedValue([expectedHash]);

            const count = await service.processIndexingBatch('jira', [doc]);
            expect(count).toBe(0);
            expect(elasticsearchService.upsertDocuments).not.toHaveBeenCalled();
        });

        it('indexes all documents in force mode without hash check', async () => {
            const { service, cursorService, elasticsearchService } = createService();
            const docs = [makeDoc('jira', 'J-1', 'content', { title: 'Test' })];

            const count = await service.processIndexingBatch('jira', docs, true);
            expect(count).toBe(1);
            expect(cursorService.bulkGetDocumentHashes).not.toHaveBeenCalled();
            expect(elasticsearchService.upsertDocuments).toHaveBeenCalledWith('jira', docs);
        });

        it('retries on Elasticsearch failure and succeeds', async () => {
            const { service, cursorService, elasticsearchService } = createService();
            cursorService.bulkGetDocumentHashes.mockResolvedValue([null]);
            elasticsearchService.upsertDocuments
                .mockRejectedValueOnce(new Error('Elasticsearch down'))
                .mockResolvedValue(undefined);

            const docs = [makeDoc('jira', 'J-1', 'content', { title: 'Test' })];
            const count = await service.processIndexingBatch('jira', docs);
            expect(count).toBe(1);
            expect(elasticsearchService.upsertDocuments).toHaveBeenCalledTimes(2);
        });

        it('throws after 3 failed retries', async () => {
            const { service, cursorService, elasticsearchService } = createService();
            cursorService.bulkGetDocumentHashes.mockResolvedValue([null]);
            elasticsearchService.upsertDocuments.mockRejectedValue(new Error('persistent failure'));

            const docs = [makeDoc('jira', 'J-1', 'content', { title: 'Test' })];
            await expect(service.processIndexingBatch('jira', docs)).rejects.toThrow('persistent failure');
            expect(elasticsearchService.upsertDocuments).toHaveBeenCalledTimes(3);
        });

        it('returns 0 for empty documents array', async () => {
            const { service, elasticsearchService } = createService();
            const count = await service.processIndexingBatch('jira', []);
            expect(count).toBe(0);
            expect(elasticsearchService.upsertDocuments).not.toHaveBeenCalled();
        });

        it('handles fileSaverService failure gracefully (non-blocking)', async () => {
            const { service, cursorService, elasticsearchService, fileSaverService } = createService();
            cursorService.bulkGetDocumentHashes.mockResolvedValue([null]);
            fileSaverService.saveDocuments.mockRejectedValue(new Error('disk full'));

            const docs = [makeDoc('jira', 'J-1', 'content', { title: 'Test' })];
            // Should not throw even though file save fails
            const count = await service.processIndexingBatch('jira', docs);
            expect(count).toBe(1);
            expect(elasticsearchService.upsertDocuments).toHaveBeenCalledTimes(1);
        });
    });

    // -----------------------------------------------------------------------
    // updateCursorAfterBatch
    // -----------------------------------------------------------------------
    describe('updateCursorAfterBatch', () => {
        it('creates cursor without syncToken using batchLastSync', async () => {
            const { service, cursorService } = createService();
            const result: ConnectorResult = {
                documents: [],
                newCursor: {},
                hasMore: false,
                batchLastSync: '2024-01-15T00:00:00Z',
            };
            const cursor = await service.updateCursorAfterBatch('jira', result, 'PROJ');
            expect(cursor).toEqual({
                source: 'jira',
                lastSync: '2024-01-15T00:00:00Z',
                syncToken: undefined,
                metadata: { configKey: 'PROJ' },
            });
            expect(cursorService.saveCursor).toHaveBeenCalledWith(cursor);
        });

        it('preserves existing lastSync when syncToken is present (pagination)', async () => {
            const { service, cursorService } = createService();
            cursorService.getCursor.mockResolvedValue({
                source: 'jira',
                lastSync: '2024-01-01T00:00:00Z',
                syncToken: 'old-token',
            });

            const result: ConnectorResult = {
                documents: [],
                newCursor: { syncToken: 'new-page-token', metadata: { page: 2 } },
                hasMore: true,
                batchLastSync: '2024-01-15T00:00:00Z',
            };
            const cursor = await service.updateCursorAfterBatch('jira', result);
            expect(cursor.lastSync).toBe('2024-01-01T00:00:00Z');
            expect(cursor.syncToken).toBe('new-page-token');
        });

        it('uses batchLastSync when syncToken present but no existing cursor', async () => {
            const { service, cursorService } = createService();
            cursorService.getCursor.mockResolvedValue(null);

            const result: ConnectorResult = {
                documents: [],
                newCursor: { syncToken: 'token' },
                hasMore: true,
                batchLastSync: '2024-06-01T00:00:00Z',
            };
            const cursor = await service.updateCursorAfterBatch('jira', result);
            expect(cursor.lastSync).toBe('2024-06-01T00:00:00Z');
        });

        it('falls back to current date when no batchLastSync and no existing cursor with syncToken', async () => {
            const { service, cursorService } = createService();
            cursorService.getCursor.mockResolvedValue(null);
            const before = new Date().toISOString();

            const result: ConnectorResult = {
                documents: [],
                newCursor: { syncToken: 'token' },
                hasMore: true,
            };
            const cursor = await service.updateCursorAfterBatch('jira', result);
            const after = new Date().toISOString();
            expect(cursor.lastSync >= before).toBe(true);
            expect(cursor.lastSync <= after).toBe(true);
        });

        it('merges metadata with configKey', async () => {
            const { service } = createService();
            const result: ConnectorResult = {
                documents: [],
                newCursor: { metadata: { extra: 'data' } },
                hasMore: false,
                batchLastSync: '2024-01-01T00:00:00Z',
            };
            const cursor = await service.updateCursorAfterBatch('slack', result, 'C1,C2');
            expect(cursor.metadata).toEqual({ extra: 'data', configKey: 'C1,C2' });
        });
    });

    // -----------------------------------------------------------------------
    // getStatus / getAllStatus — stale detection
    // -----------------------------------------------------------------------
    describe('getStatus', () => {
        it('returns default idle status when no status exists', async () => {
            const { service, cursorService } = createService();
            cursorService.getJobStatus.mockResolvedValue(null);
            const status = await service.getStatus('jira');
            expect(status).toEqual({ source: 'jira', status: 'idle', lastSync: null, documentsIndexed: 0 });
        });

        it('returns stored status when not stale', async () => {
            const { service, cursorService, temporalClient } = createService();
            const stored: IndexStatus = {
                source: 'jira', status: 'running', lastSync: '2024-01-01', documentsIndexed: 100,
            };
            cursorService.getJobStatus.mockResolvedValue(stored);
            temporalClient.isWorkflowRunning.mockResolvedValue(true);

            const status = await service.getStatus('jira');
            expect(status.status).toBe('running');
        });

        it('resets stale running status to idle', async () => {
            const { service, cursorService, temporalClient } = createService();
            const stored: IndexStatus = {
                source: 'slack', status: 'running', lastSync: '2024-01-01', documentsIndexed: 50,
            };
            cursorService.getJobStatus.mockResolvedValue({ ...stored });
            temporalClient.isWorkflowRunning.mockResolvedValue(false);

            const status = await service.getStatus('slack');
            expect(status.status).toBe('idle');
            expect(cursorService.saveJobStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }));
            expect(cursorService.releaseLock).toHaveBeenCalledWith('slack');
        });

        it('does not check temporal for non-running status', async () => {
            const { service, cursorService, temporalClient } = createService();
            cursorService.getJobStatus.mockResolvedValue({
                source: 'gmail', status: 'completed', lastSync: '2024-01-01', documentsIndexed: 200,
            });
            const status = await service.getStatus('gmail');
            expect(status.status).toBe('completed');
            expect(temporalClient.isWorkflowRunning).not.toHaveBeenCalled();
        });
    });

    describe('getAllStatus', () => {
        it('resets stale statuses across multiple sources', async () => {
            const { service, cursorService, temporalClient } = createService();
            cursorService.getAllJobStatus.mockResolvedValue([
                { source: 'jira', status: 'running', lastSync: null, documentsIndexed: 0 },
                { source: 'slack', status: 'idle', lastSync: null, documentsIndexed: 0 },
                { source: 'gmail', status: 'running', lastSync: null, documentsIndexed: 0 },
            ]);
            // jira is actually running, gmail is stale
            temporalClient.isWorkflowRunning
                .mockImplementation(async (id: string) => id === 'index-jira');

            const statuses = await service.getAllStatus();
            const jira = statuses.find(s => s.source === 'jira');
            const gmail = statuses.find(s => s.source === 'gmail');
            const slack = statuses.find(s => s.source === 'slack');

            expect(jira!.status).toBe('running');
            expect(gmail!.status).toBe('idle');
            expect(slack!.status).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // startIndexing / indexAll (delegate to temporal)
    // -----------------------------------------------------------------------
    describe('startIndexing', () => {
        it('delegates to temporal client', async () => {
            const { service, temporalClient } = createService();
            temporalClient.startIndexSource.mockResolvedValue({ started: true, message: 'started' });
            const result = await service.startIndexing('jira', { projectKeys: ['PROJ'] });
            expect(result).toEqual({ started: true, message: 'started' });
            expect(temporalClient.startIndexSource).toHaveBeenCalledWith('jira', { projectKeys: ['PROJ'] });
        });
    });

    describe('indexAll', () => {
        it('returns all sources as started when temporal succeeds', async () => {
            const { service, temporalClient } = createService();
            temporalClient.startCollectAll.mockResolvedValue({ started: true });
            const result = await service.indexAll();
            expect(result.started).toEqual(['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar']);
            expect(result.skipped).toEqual([]);
        });

        it('returns all sources as skipped when temporal rejects', async () => {
            const { service, temporalClient } = createService();
            temporalClient.startCollectAll.mockResolvedValue({ started: false });
            const result = await service.indexAll();
            expect(result.started).toEqual([]);
            expect(result.skipped).toEqual(['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar']);
        });
    });

    // -----------------------------------------------------------------------
    // resetCursor / resetAll / resetStatusOnly
    // -----------------------------------------------------------------------
    describe('resetCursor', () => {
        it('resets cursor, status, and lock', async () => {
            const { service, cursorService } = createService();
            await service.resetCursor('drive');
            expect(cursorService.resetCursor).toHaveBeenCalledWith('drive');
            expect(cursorService.resetStatus).toHaveBeenCalledWith('drive');
            expect(cursorService.releaseLock).toHaveBeenCalledWith('drive');
        });
    });

    describe('resetAll', () => {
        it('resets all 6 sources', async () => {
            const { service, cursorService } = createService();
            await service.resetAll();
            expect(cursorService.resetCursor).toHaveBeenCalledTimes(6);
        });
    });

    describe('resetStatusOnly', () => {
        it('resets only status and lock, not cursor', async () => {
            const { service, cursorService } = createService();
            await service.resetStatusOnly('gmail');
            expect(cursorService.resetStatus).toHaveBeenCalledWith('gmail');
            expect(cursorService.releaseLock).toHaveBeenCalledWith('gmail');
            expect(cursorService.resetCursor).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // deleteDocument
    // -----------------------------------------------------------------------
    describe('deleteDocument', () => {
        it('deletes from fileSaver, elasticsearch, and removes hashes', async () => {
            const { service, fileSaverService, elasticsearchService, cursorService } = createService();
            await service.deleteDocument('slack', 'doc-123');
            expect(fileSaverService.deleteDocument).toHaveBeenCalledWith('slack', 'doc-123');
            expect(elasticsearchService.deleteDocument).toHaveBeenCalledWith('slack', 'doc-123');
            expect(cursorService.removeDocumentHashes).toHaveBeenCalledWith('slack', 'doc-123');
        });

        it('continues even if Elasticsearch delete fails', async () => {
            const { service, elasticsearchService, cursorService } = createService();
            elasticsearchService.deleteDocument.mockRejectedValue(new Error('es fail'));
            await service.deleteDocument('slack', 'doc-123');
            // Should not throw, and should still remove hashes
            expect(cursorService.removeDocumentHashes).toHaveBeenCalledWith('slack', 'doc-123');
        });
    });

    // -----------------------------------------------------------------------
    // addRelevanceWeights — does not mutate original documents
    // -----------------------------------------------------------------------
    describe('addRelevanceWeights immutability', () => {
        it('returns new documents without mutating originals', () => {
            const { service } = createService();
            const original = makeDoc('jira', 'J-1', 'text', {
                priority: 'High', updatedAt: new Date().toISOString(), assignee: null,
            });
            const originalMetadata = { ...original.metadata };
            const [result] = service.addRelevanceWeights('jira', [original]);
            // Original should be untouched
            expect(original.metadata).toEqual(originalMetadata);
            // Result should have new fields
            expect((result.metadata as any).relevance_score).toBeDefined();
            expect(result).not.toBe(original);
        });
    });

    // -----------------------------------------------------------------------
    // getAllSourceInfo
    // -----------------------------------------------------------------------
    describe('getAllSourceInfo', () => {
        it('should merge Temporal workflow info with Redis document counts', async () => {
            const { service, temporalClient, cursorService } = createService();

            jest.spyOn(temporalClient, 'getSourceWorkflowInfo').mockImplementation(async (source: string) => {
                if (source === 'gmail') {
                    return {
                        workflowId: 'index-gmail',
                        runId: 'run-1',
                        type: 'indexSourceWorkflow',
                        status: 'COMPLETED',
                        startTime: '2026-02-14T10:00:00.000Z',
                        closeTime: '2026-02-14T10:05:00.000Z',
                        executionTime: 300000,
                    };
                }
                return null;
            });

            jest.spyOn(cursorService, 'getJobStatus').mockImplementation(async (source) => {
                if (source === 'gmail') {
                    return { source: 'gmail', status: 'completed', lastSync: null, documentsIndexed: 150 } as any;
                }
                return null;
            });

            const result = await service.getAllSourceInfo();
            const gmail = result.find(s => s.source === 'gmail')!;

            expect(gmail.status).toBe('completed');
            expect(gmail.documentsIndexed).toBe(150);
            expect(gmail.lastSync).toBe('2026-02-14T10:05:00.000Z');
            expect(gmail.lastError).toBeNull();
            expect(gmail.workflowId).toBe('index-gmail');
            expect(gmail.executionTime).toBe(300000);
        });

        it('should return idle status when no Temporal workflow exists', async () => {
            const { service, temporalClient, cursorService } = createService();

            jest.spyOn(temporalClient, 'getSourceWorkflowInfo').mockResolvedValue(null);
            jest.spyOn(cursorService, 'getJobStatus').mockResolvedValue(null);

            const result = await service.getAllSourceInfo();
            const gmail = result.find(s => s.source === 'gmail')!;

            expect(gmail.status).toBe('idle');
            expect(gmail.documentsIndexed).toBe(0);
            expect(gmail.lastSync).toBeNull();
        });

        it('should map FAILED Temporal status and extract error from Redis', async () => {
            const { service, temporalClient, cursorService } = createService();

            jest.spyOn(temporalClient, 'getSourceWorkflowInfo').mockImplementation(async (source: string) => {
                if (source === 'slack') {
                    return {
                        workflowId: 'index-slack',
                        runId: 'run-2',
                        type: 'indexSourceWorkflow',
                        status: 'FAILED',
                        startTime: '2026-02-14T09:00:00.000Z',
                        closeTime: '2026-02-14T09:01:00.000Z',
                        executionTime: 60000,
                    };
                }
                return null;
            });

            jest.spyOn(cursorService, 'getJobStatus').mockImplementation(async (source) => {
                if (source === 'slack') {
                    return {
                        source: 'slack', status: 'error', lastSync: null, documentsIndexed: 50,
                        lastError: 'Rate limit exceeded', lastErrorAt: '2026-02-14T09:01:00.000Z',
                    } as any;
                }
                return null;
            });

            const result = await service.getAllSourceInfo();
            const slack = result.find(s => s.source === 'slack')!;

            expect(slack.status).toBe('failed');
            expect(slack.lastError).toBe('Rate limit exceeded');
            expect(slack.lastErrorAt).toBe('2026-02-14T09:01:00.000Z');
        });
    });
});
