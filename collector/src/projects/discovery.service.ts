import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Subject } from 'rxjs';

import { Project, Proposal } from '../types/projects';
import { ProjectsService } from './projects.service';

export interface DiscoveryEvent {
    type: 'proposal_created' | 'session_completed' | 'session_failed' | 'status_update';
    data: unknown;
}

@Injectable()
export class DiscoveryService {
    private readonly logger = new Logger(DiscoveryService.name);
    private readonly sessions = new Map<string, Subject<DiscoveryEvent>>();

    constructor(
        private configService: ConfigService,
        private projectsService: ProjectsService,
    ) {}

    getSessionEvents(sessionId: string): Subject<DiscoveryEvent> | undefined {
        return this.sessions.get(sessionId);
    }

    async startDiscovery(): Promise<{ sessionId: string }> {
        const session = await this.projectsService.createSession();
        const subject = new Subject<DiscoveryEvent>();
        this.sessions.set(session.id, subject);

        this.runDiscovery(session.id, subject).catch(async (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Discovery session ${session.id} failed: ${message}`);
            await this.projectsService.updateSession(session.id, {
                status: 'failed',
                error: message,
            });
            subject.next({ type: 'session_failed', data: { error: message } });
            subject.complete();
            this.sessions.delete(session.id);
        });

        return { sessionId: session.id };
    }

    private async runDiscovery(sessionId: string, subject: Subject<DiscoveryEvent>): Promise<void> {
        const codeAgentUrl = this.configService.get<string>('codeAgent.url');
        const collectorApiUrl = this.configService.get<string>('codeAgent.collectorApiUrl');
        const collectorApiKey = this.configService.get<string>('codeAgent.collectorApiKey');
        const mcpServerPath = this.configService.get<string>('codeAgent.mcpServerPath');

        const existingProjects = await this.projectsService.listProjects();
        const prompt = this.buildDiscoveryPrompt(sessionId, existingProjects);

        const mcpConfig = {
            mcpServers: {
                collector: {
                    command: 'node',
                    args: [mcpServerPath],
                    env: {
                        COLLECTOR_API_URL: collectorApiUrl,
                        COLLECTOR_API_KEY: collectorApiKey,
                    },
                },
            },
        };

        subject.next({
            type: 'status_update',
            data: { message: 'Starting discovery agent...' },
        });

        await axios.post(`${codeAgentUrl}/api/prompt`, {
            prompt: `First, create the file .cursor/mcp.json with this exact content:\n${JSON.stringify(mcpConfig, null, 2)}\n\nThen proceed with the task:\n\n${prompt}`,
            timeout: 600000,
        });

        const proposals = await this.projectsService.listProposals({ sessionId });

        await this.projectsService.updateSession(sessionId, {
            status: 'completed',
            proposalCount: proposals.length,
        });

        subject.next({
            type: 'session_completed',
            data: { proposalCount: proposals.length },
        });
        subject.complete();
        this.sessions.delete(sessionId);
    }

    private buildDiscoveryPrompt(sessionId: string, existingProjects: Project[]): string {
        const projectContext = existingProjects.length > 0
            ? `\n\nExisting projects already discovered:\n${JSON.stringify(existingProjects, null, 2)}\n\nFor existing projects, use propose_project_update to suggest changes. For new projects not yet tracked, use propose_new_project.`
            : '\n\nNo projects have been discovered yet. Use propose_new_project for each project you find.';

        return `You are a project discovery agent. Your task is to search across all indexed sources (Jira, Slack, Gmail, Drive, Confluence, Calendar) to discover and catalog active projects.

SESSION ID: ${sessionId}
Use this session ID for all proposals.

INSTRUCTIONS:
1. First, use get_index_status to see what sources are available and indexed.
2. Use the search tool with various queries to discover projects:
   - Search Jira for active projects and epics
   - Search Slack for active channels and discussions
   - Search Drive/Confluence for project documentation
   - Search Calendar for recurring project meetings
   - Search Gmail for project-related threads
3. Cross-reference signals across sources to identify distinct projects.
4. For each project found, propose it using the MCP tools with structured details:
   - title: Clear, concise project name
   - description: What the project is about (2-3 sentences)
   - goals: Key objectives (list)
   - status: active/paused/completed/archived
   - participants: People involved (name, role if known, source)
   - sources: Linked source identifiers (Jira project key, Slack channel, etc.)
   - tags: Relevant labels
   - metadata: Any extra useful info (priority, deadlines, etc.)
   - reason: Why you believe this is a distinct project
5. Use searchType 'hybrid' for broad queries, 'keyword' for specific identifiers.
6. Be thorough but avoid duplicates. Cross-reference before proposing.
${projectContext}

IMPORTANT: Use the MCP tools (propose_new_project, propose_project_update) to submit your findings. Each tool call creates a reviewable proposal for the user.`;
    }

    notifyProposalCreated(proposal: Proposal): void {
        const subject = this.sessions.get(proposal.sessionId);
        if (subject) {
            subject.next({ type: 'proposal_created', data: proposal });
        }
    }
}
