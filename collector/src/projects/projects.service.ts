import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

import {
  CreateProjectRequest,
  CreateProposalRequest,
  DiscoverySession,
  Project,
  Proposal,
  ProposalGroup,
  ReviewProposalRequest,
  UpdateProjectRequest,
} from '../types/projects';

const KEYS = {
  project: (id: string) => `projects:item:${id}`,
  projectList: 'projects:ids',
  proposal: (id: string) => `projects:proposals:item:${id}`,
  proposalsBySession: (sessionId: string) => `projects:proposals:session:${sessionId}`,
  proposalList: 'projects:proposals:ids',
  session: (id: string) => `projects:sessions:${id}`,
} as const;

@Injectable()
export class ProjectsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectsService.name);
  private redis!: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('redis.url');
    this.redis = new Redis(url ?? 'redis://localhost:6379');
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  // --- Projects CRUD ---

  async createProject(req: CreateProjectRequest): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      title: req.title,
      description: req.description,
      goals: req.goals ?? [],
      status: req.status ?? 'active',
      myRole: req.myRole ?? 'informed',
      participants: req.participants ?? [],
      sources: req.sources ?? [],
      tags: req.tags ?? [],
      metadata: req.metadata ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.redis.set(KEYS.project(project.id), JSON.stringify(project));
    await this.redis.sadd(KEYS.projectList, project.id);
    this.logger.log(`Created project: ${project.title} (${project.id})`);
    return project;
  }

  async getProject(id: string): Promise<Project | null> {
    const data = await this.redis.get(KEYS.project(id));
    return data ? JSON.parse(data) : null;
  }

  async listProjects(filter?: { status?: string; myRole?: string }): Promise<Project[]> {
    const ids = await this.redis.smembers(KEYS.projectList);
    const projects: Project[] = [];

    for (const id of ids) {
      const project = await this.getProject(id);
      if (!project) continue;
      if (filter?.status && project.status !== filter.status) continue;
      if (filter?.myRole && project.myRole !== filter.myRole) continue;
      projects.push(project);
    }

    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateProject(id: string, req: UpdateProjectRequest): Promise<Project> {
    const project = await this.getProject(id);
    if (!project) throw new Error(`Project not found: ${id}`);

    const updated: Project = {
      ...project,
      ...Object.fromEntries(Object.entries(req).filter(([, v]) => v !== undefined)),
      updatedAt: new Date().toISOString(),
    };

    await this.redis.set(KEYS.project(id), JSON.stringify(updated));
    this.logger.log(`Updated project: ${updated.title} (${id})`);
    return updated;
  }

  async deleteProject(id: string): Promise<void> {
    await this.redis.del(KEYS.project(id));
    await this.redis.srem(KEYS.projectList, id);
    this.logger.log(`Deleted project: ${id}`);
  }

  // --- Proposals ---

  async createProposal(req: CreateProposalRequest): Promise<Proposal> {
    const proposal: Proposal = {
      id: randomUUID(),
      projectId: req.projectId ?? null,
      sessionId: req.sessionId,
      field: req.field,
      oldValue: req.oldValue ?? null,
      newValue: req.newValue,
      reason: req.reason,
      status: 'pending',
      reviewedAt: null,
      createdAt: new Date().toISOString(),
    };

    await this.redis.set(KEYS.proposal(proposal.id), JSON.stringify(proposal));
    await this.redis.sadd(KEYS.proposalList, proposal.id);
    await this.redis.sadd(KEYS.proposalsBySession(req.sessionId), proposal.id);
    return proposal;
  }

  async getProposal(id: string): Promise<Proposal | null> {
    const data = await this.redis.get(KEYS.proposal(id));
    return data ? JSON.parse(data) : null;
  }

  async listProposals(filter?: { sessionId?: string; status?: string }): Promise<Proposal[]> {
    let ids: string[];

    if (filter?.sessionId) {
      ids = await this.redis.smembers(KEYS.proposalsBySession(filter.sessionId));
    } else {
      ids = await this.redis.smembers(KEYS.proposalList);
    }

    const proposals: Proposal[] = [];
    for (const id of ids) {
      const proposal = await this.getProposal(id);
      if (!proposal) continue;
      if (filter?.status && proposal.status !== filter.status) continue;
      proposals.push(proposal);
    }

    return proposals.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async reviewProposal(id: string, req: ReviewProposalRequest): Promise<Proposal> {
    const proposal = await this.getProposal(id);
    if (!proposal) throw new Error(`Proposal not found: ${id}`);

    proposal.status = req.action === 'edit' ? 'edited' : req.action === 'approve' ? 'approved' : 'rejected';
    proposal.reviewedAt = new Date().toISOString();
    if (req.action === 'edit' && req.editedValue !== undefined) {
      proposal.newValue = req.editedValue;
    }

    await this.redis.set(KEYS.proposal(id), JSON.stringify(proposal));
    return proposal;
  }

  async batchReviewProposals(proposalIds: string[], action: 'approve' | 'reject'): Promise<Proposal[]> {
    const results: Proposal[] = [];
    for (const id of proposalIds) {
      results.push(await this.reviewProposal(id, { action }));
    }
    return results;
  }

  async getProposalGroups(sessionId: string): Promise<ProposalGroup[]> {
    const proposals = await this.listProposals({ sessionId });
    const groups = new Map<string, ProposalGroup>();

    for (const proposal of proposals) {
      const groupKey = proposal.projectId ?? 'new';

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          projectId: proposal.projectId,
          isNew: proposal.projectId === null,
          proposals: [],
        });
      }
      const group = groups.get(groupKey);
      if (group) group.proposals.push(proposal);
    }

    // For update groups, fetch project title
    for (const group of groups.values()) {
      if (group.projectId) {
        const project = await this.getProject(group.projectId);
        group.projectTitle = project?.title;
      }
    }

    return [...groups.values()];
  }

  // --- Discovery Sessions ---

  async createSession(): Promise<DiscoverySession> {
    const session: DiscoverySession = {
      id: randomUUID(),
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      proposalCount: 0,
    };

    await this.redis.set(KEYS.session(session.id), JSON.stringify(session));
    return session;
  }

  async getSession(id: string): Promise<DiscoverySession | null> {
    const data = await this.redis.get(KEYS.session(id));
    return data ? JSON.parse(data) : null;
  }

  async updateSession(id: string, updates: Partial<DiscoverySession>): Promise<void> {
    const session = await this.getSession(id);
    if (!session) throw new Error(`Session not found: ${id}`);

    const updated = { ...session, ...updates };
    if (updates.status === 'completed' || updates.status === 'failed') {
      updated.completedAt = new Date().toISOString();
    }

    await this.redis.set(KEYS.session(id), JSON.stringify(updated));
  }

  // --- Approval Logic ---

  async applyApprovedProposals(sessionId: string): Promise<Project[]> {
    const groups = await this.getProposalGroups(sessionId);
    const results: Project[] = [];

    for (const group of groups) {
      const approved = group.proposals.filter(p => p.status === 'approved' || p.status === 'edited');
      if (approved.length === 0) continue;

      if (group.isNew) {
        const fields: Record<string, unknown> = {};
        for (const p of approved) {
          fields[p.field] = p.newValue;
        }
        const project = await this.createProject({
          title: (fields.title as string | undefined) ?? 'Untitled Project',
          description: (fields.description as string | undefined) ?? '',
          goals: (fields.goals as string[] | undefined) ?? [],
          status: (fields.status as Project['status'] | undefined) ?? 'active',
          myRole: (fields.myRole as Project['myRole'] | undefined) ?? 'informed',
          participants: (fields.participants as Project['participants'] | undefined) ?? [],
          sources: (fields.sources as Project['sources'] | undefined) ?? [],
          tags: (fields.tags as string[] | undefined) ?? [],
          metadata: (fields.metadata as Record<string, unknown> | undefined) ?? {},
        });
        results.push(project);
      } else if (group.projectId) {
        const updates: Record<string, unknown> = {};
        for (const p of approved) {
          updates[p.field] = p.newValue;
        }
        const project = await this.updateProject(group.projectId, updates as UpdateProjectRequest);
        results.push(project);
      }
    }

    return results;
  }
}
