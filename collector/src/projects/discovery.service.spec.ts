import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { Proposal } from '../types/projects';
import { DiscoveryEvent, DiscoveryService } from './discovery.service';
import { ProjectsService } from './projects.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DiscoveryService', () => {
    let service: DiscoveryService;
    let mockConfigService: { get: jest.Mock };
    let mockProjectsService: {
        createSession: jest.Mock;
        listProjects: jest.Mock;
        listProposals: jest.Mock;
        updateSession: jest.Mock;
    };

    const configValues: Record<string, string> = {
        'codeAgent.url': 'http://localhost:3100',
        'codeAgent.collectorApiUrl': 'http://localhost:8087',
        'codeAgent.collectorApiKey': 'test-key',
        'codeAgent.mcpServerPath': '/path/to/mcp-server.js',
    };

    beforeEach(() => {
        jest.clearAllMocks();

        mockConfigService = {
            get: jest.fn((key: string) => configValues[key]),
        };

        mockProjectsService = {
            createSession: jest.fn().mockResolvedValue({ id: 'session-123', status: 'running' }),
            listProjects: jest.fn().mockResolvedValue([]),
            listProposals: jest.fn().mockResolvedValue([]),
            updateSession: jest.fn().mockResolvedValue(undefined),
        };

        mockedAxios.post.mockResolvedValue({ data: { ok: true } });

        service = new DiscoveryService(
            mockConfigService as unknown as ConfigService,
            mockProjectsService as unknown as ProjectsService,
        );
    });

    describe('getSessionEvents', () => {
        it('returns undefined when no session exists', () => {
            const result = service.getSessionEvents('nonexistent');
            expect(result).toBeUndefined();
        });

        it('returns Subject when session exists', async () => {
            await service.startDiscovery();
            const subject = service.getSessionEvents('session-123');
            expect(subject).toBeDefined();
        });
    });

    describe('startDiscovery', () => {
        it('creates a session via projectsService', async () => {
            await service.startDiscovery();
            expect(mockProjectsService.createSession).toHaveBeenCalledTimes(1);
        });

        it('returns the sessionId', async () => {
            const result = await service.startDiscovery();
            expect(result).toEqual({ sessionId: 'session-123' });
        });

        it('registers a Subject in the sessions map', async () => {
            await service.startDiscovery();
            const subject = service.getSessionEvents('session-123');
            expect(subject).toBeDefined();
        });

        it('emits status_update event before calling code-agent', async () => {
            // Track whether status_update was emitted by the time axios.post is called.
            // runDiscovery is fire-and-forget so we can't subscribe externally in time.
            // Instead, inside listProjects (called before status_update), we subscribe
            // to the Subject so we catch the status_update emission.
            let statusUpdateSeenBeforePost = false;
            const events: DiscoveryEvent[] = [];

            mockProjectsService.listProjects.mockImplementation(async () => {
                // At this point the Subject is already stored in the sessions map
                const subject = service.getSessionEvents('session-123');
                if (subject) {
                    subject.subscribe(event => events.push(event));
                }
                return [];
            });

            mockedAxios.post.mockImplementation(async () => {
                // By the time axios.post is called, status_update should have been emitted
                statusUpdateSeenBeforePost = events.some(e => e.type === 'status_update');
                return { data: { ok: true } };
            });

            await service.startDiscovery();

            // Wait for async runDiscovery to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(statusUpdateSeenBeforePost).toBe(true);
            expect(events.some(e => e.type === 'status_update')).toBe(true);
        });

        it('on successful run: emits session_completed, updates session, cleans up', async () => {
            const events: DiscoveryEvent[] = [];

            mockProjectsService.listProposals.mockResolvedValue([
                { id: 'p1' },
                { id: 'p2' },
                { id: 'p3' },
            ]);

            // Subscribe before starting so we capture all events
            const result = await service.startDiscovery();
            const subject = service.getSessionEvents(result.sessionId)!;
            subject.subscribe(event => events.push(event));

            // Wait for async runDiscovery to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockProjectsService.updateSession).toHaveBeenCalledWith('session-123', {
                status: 'completed',
                proposalCount: 3,
            });

            const completedEvent = events.find(e => e.type === 'session_completed');
            expect(completedEvent).toBeDefined();
            expect(completedEvent!.data).toEqual({ proposalCount: 3 });

            // Sessions map should be cleaned up
            expect(service.getSessionEvents('session-123')).toBeUndefined();
        });

        it('on failure: emits session_failed, updates session with error, cleans up', async () => {
            const events: DiscoveryEvent[] = [];

            mockedAxios.post.mockRejectedValue(new Error('Connection refused'));

            const result = await service.startDiscovery();
            const subject = service.getSessionEvents(result.sessionId)!;
            subject.subscribe(event => events.push(event));

            // Wait for async catch handler to run
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockProjectsService.updateSession).toHaveBeenCalledWith('session-123', {
                status: 'failed',
                error: 'Connection refused',
            });

            const failedEvent = events.find(e => e.type === 'session_failed');
            expect(failedEvent).toBeDefined();
            expect(failedEvent!.data).toEqual({ error: 'Connection refused' });

            // Sessions map should be cleaned up
            expect(service.getSessionEvents('session-123')).toBeUndefined();
        });

        it('handles non-Error thrown values in failure path', async () => {
            const events: DiscoveryEvent[] = [];

            mockedAxios.post.mockRejectedValue('string error');

            const result = await service.startDiscovery();
            const subject = service.getSessionEvents(result.sessionId)!;
            subject.subscribe(event => events.push(event));

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockProjectsService.updateSession).toHaveBeenCalledWith('session-123', {
                status: 'failed',
                error: 'string error',
            });

            const failedEvent = events.find(e => e.type === 'session_failed');
            expect(failedEvent).toBeDefined();
            expect(failedEvent!.data).toEqual({ error: 'string error' });
        });
    });

    describe('notifyProposalCreated', () => {
        it('emits proposal_created event when session exists', async () => {
            const events: DiscoveryEvent[] = [];

            await service.startDiscovery();
            const subject = service.getSessionEvents('session-123')!;
            subject.subscribe(event => events.push(event));

            const proposal: Proposal = {
                id: 'prop-1',
                projectId: null,
                sessionId: 'session-123',
                field: 'title',
                oldValue: null,
                newValue: 'New Project',
                reason: 'Found in Jira',
                status: 'pending',
                reviewedAt: null,
                createdAt: '2026-02-14T00:00:00Z',
            };

            service.notifyProposalCreated(proposal);

            const proposalEvent = events.find(e => e.type === 'proposal_created');
            expect(proposalEvent).toBeDefined();
            expect(proposalEvent!.data).toEqual(proposal);
        });

        it('does nothing when session does not exist', () => {
            const proposal: Proposal = {
                id: 'prop-1',
                projectId: null,
                sessionId: 'nonexistent-session',
                field: 'title',
                oldValue: null,
                newValue: 'New Project',
                reason: 'Found in Jira',
                status: 'pending',
                reviewedAt: null,
                createdAt: '2026-02-14T00:00:00Z',
            };

            // Should not throw
            expect(() => service.notifyProposalCreated(proposal)).not.toThrow();
        });
    });

    describe('buildDiscoveryPrompt (via startDiscovery)', () => {
        it('includes sessionId in the prompt sent to code-agent', async () => {
            await service.startDiscovery();

            // Wait for async runDiscovery to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockedAxios.post).toHaveBeenCalledTimes(1);
            const callArgs = mockedAxios.post.mock.calls[0];
            const body = callArgs[1] as { prompt: string };
            expect(body.prompt).toContain('SESSION ID: session-123');
        });

        it('includes existing projects context when projects exist', async () => {
            mockProjectsService.listProjects.mockResolvedValue([
                {
                    id: 'proj-1',
                    title: 'Existing Project',
                    description: 'Already tracked',
                    goals: [],
                    status: 'active',
                    myRole: 'active',
                    participants: [],
                    sources: [],
                    tags: [],
                    metadata: {},
                    createdAt: '2026-01-01T00:00:00Z',
                    updatedAt: '2026-01-01T00:00:00Z',
                },
            ]);

            await service.startDiscovery();

            // Wait for async runDiscovery to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            const callArgs = mockedAxios.post.mock.calls[0];
            const body = callArgs[1] as { prompt: string };
            expect(body.prompt).toContain('Existing projects already discovered');
            expect(body.prompt).toContain('Existing Project');
            expect(body.prompt).toContain('propose_project_update');
        });

        it('uses "No projects" message when no projects exist', async () => {
            mockProjectsService.listProjects.mockResolvedValue([]);

            await service.startDiscovery();

            // Wait for async runDiscovery to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            const callArgs = mockedAxios.post.mock.calls[0];
            const body = callArgs[1] as { prompt: string };
            expect(body.prompt).toContain('No projects have been discovered yet');
            expect(body.prompt).toContain('propose_new_project');
        });

        it('includes MCP config with correct values in the prompt', async () => {
            await service.startDiscovery();

            await new Promise(resolve => setTimeout(resolve, 50));

            const callArgs = mockedAxios.post.mock.calls[0];
            const body = callArgs[1] as { prompt: string };
            expect(body.prompt).toContain('mcp.json');
            expect(body.prompt).toContain(configValues['codeAgent.collectorApiUrl']);
            expect(body.prompt).toContain(configValues['codeAgent.collectorApiKey']);
            expect(body.prompt).toContain(configValues['codeAgent.mcpServerPath']);
        });
    });
});
