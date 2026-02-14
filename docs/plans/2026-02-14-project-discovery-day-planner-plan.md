# Project Discovery & Day Planner — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a project discovery system that uses an AI agent to find and track projects across indexed sources, with human-in-the-loop review, plus a framework plugin for daily planning.

**Architecture:** Redis-backed projects/proposals storage in the collector service, a stdio MCP server bundled with the collector for agent access, discovery sessions launched via the code-agent service, and a React/MUI frontend for diff-based review. Framework plugin is markdown-only, following existing patterns.

**Tech Stack:** NestJS (backend), React 18 + MUI v7 (frontend), Redis (storage), @modelcontextprotocol/sdk (MCP server), RxJS (SSE), code-agent service (Cursor agent orchestration)

**Design doc:** `docs/plans/2026-02-14-project-discovery-day-planner-design.md`

---

### Task 1: ChromaDB Cleanup

**Files:**
- Modify: `code-agent/.docker/cursor/mcp.json`
- Modify: `code-agent/Dockerfile`

**Step 1: Replace mcp.json with empty config**

Replace `code-agent/.docker/cursor/mcp.json` with:
```json
{
  "mcpServers": {}
}
```

**Step 2: Clean Dockerfile CMD**

In `code-agent/Dockerfile` line 83, simplify the CMD since there's no more placeholder to substitute:
```dockerfile
CMD ["node", "dist/main.js"]
```

**Step 3: Scan for remaining chroma references**

Run: `grep -ri "chroma" code-agent/ --include="*.ts" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.md" --include="Dockerfile"`
Expected: No matches (or only this plan file)

Also scan broader:
Run: `grep -ri "chroma" services/ --include="*.yml" --include="*.yaml" --include="*.env"`
Expected: Clean up any found references

**Step 4: Commit**
```bash
git add code-agent/.docker/cursor/mcp.json code-agent/Dockerfile
git commit -m "chore: remove ChromaDB references from code-agent"
```

---

### Task 2: Project & Proposal Types

**Files:**
- Create: `collector/src/types/projects.ts`

**Step 1: Define project types**

```typescript
export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
export type ProjectRole = 'active' | 'informed' | 'muted';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'edited';
export type ProposalAction = 'approve' | 'reject' | 'edit';

export interface ProjectParticipant {
  name: string;
  role?: string;
  source?: string;
}

export interface ProjectSource {
  type: string; // 'jira_project' | 'slack_channel' | 'github_repo' | 'drive_folder' | 'confluence_space'
  identifier: string; // e.g., 'PROJ', '#channel-name', 'org/repo'
  name?: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  goals: string[];
  status: ProjectStatus;
  myRole: ProjectRole;
  participants: ProjectParticipant[];
  sources: ProjectSource[];
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Proposal {
  id: string;
  projectId: string | null; // null = new project
  sessionId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  status: ProposalStatus;
  reviewedAt: string | null;
  createdAt: string;
}

export interface DiscoverySession {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  proposalCount: number;
  error?: string;
}

// Request/Response DTOs
export interface CreateProjectRequest {
  title: string;
  description: string;
  goals?: string[];
  status?: ProjectStatus;
  myRole?: ProjectRole;
  participants?: ProjectParticipant[];
  sources?: ProjectSource[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectRequest {
  title?: string;
  description?: string;
  goals?: string[];
  status?: ProjectStatus;
  myRole?: ProjectRole;
  participants?: ProjectParticipant[];
  sources?: ProjectSource[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateProposalRequest {
  projectId?: string | null;
  sessionId: string;
  field: string;
  oldValue?: unknown;
  newValue: unknown;
  reason: string;
}

export interface ReviewProposalRequest {
  action: ProposalAction;
  editedValue?: unknown;
}

export interface BatchReviewRequest {
  proposalIds: string[];
  action: ProposalAction;
}

export interface ProposalGroup {
  projectId: string | null;
  projectTitle?: string;
  isNew: boolean;
  proposals: Proposal[];
}
```

**Step 2: Export from types index**

Add to `collector/src/types/index.ts`:
```typescript
export * from './projects';
```

**Step 3: Commit**
```bash
git add collector/src/types/projects.ts collector/src/types/index.ts
git commit -m "feat(projects): add project and proposal type definitions"
```

---

### Task 3: Projects Service (Redis Storage)

**Files:**
- Create: `collector/src/projects/projects.service.ts`
- Test: `collector/src/projects/projects.service.spec.ts`

**Note:** Uses Redis for storage, consistent with the rest of the collector service (settings, cursors, hashes). No new database dependencies needed.

**Step 1: Write the failing tests**

Create `collector/src/projects/projects.service.spec.ts`:
```typescript
import { ConfigService } from '@nestjs/config';

import { ProjectsService } from './projects.service';

function createRedisMock() {
  const store = new Map<string, string>();

  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    }),
    keys: jest.fn(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return [...store.keys()].filter(k => k.startsWith(prefix));
    }),
    quit: jest.fn(async () => 'OK'),
  };
}

describe('ProjectsService', () => {
  let service: ProjectsService;
  let redisMock: ReturnType<typeof createRedisMock>;

  beforeEach(() => {
    redisMock = createRedisMock();
    const configService = {
      get: jest.fn().mockReturnValue('redis://localhost:6379'),
    } as unknown as ConfigService;

    service = new ProjectsService(configService);
    (service as any).redis = redisMock;
  });

  describe('projects CRUD', () => {
    it('creates and retrieves a project', async () => {
      const project = await service.createProject({
        title: 'Test Project',
        description: 'A test',
      });

      expect(project.id).toBeDefined();
      expect(project.title).toBe('Test Project');
      expect(project.status).toBe('active');
      expect(project.myRole).toBe('informed');

      const retrieved = await service.getProject(project.id);
      expect(retrieved).toEqual(project);
    });

    it('lists all projects', async () => {
      await service.createProject({ title: 'P1', description: 'D1' });
      await service.createProject({ title: 'P2', description: 'D2' });

      const projects = await service.listProjects();
      expect(projects).toHaveLength(2);
    });

    it('filters projects by status', async () => {
      await service.createProject({ title: 'Active', description: 'D', status: 'active' });
      await service.createProject({ title: 'Paused', description: 'D', status: 'paused' });

      const active = await service.listProjects({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].title).toBe('Active');
    });

    it('updates a project', async () => {
      const project = await service.createProject({ title: 'Original', description: 'D' });
      const updated = await service.updateProject(project.id, { title: 'Updated' });

      expect(updated.title).toBe('Updated');
      expect(updated.description).toBe('D');
    });

    it('deletes a project', async () => {
      const project = await service.createProject({ title: 'ToDelete', description: 'D' });
      await service.deleteProject(project.id);

      const retrieved = await service.getProject(project.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('proposals', () => {
    it('creates and retrieves a proposal', async () => {
      const proposal = await service.createProposal({
        sessionId: 'session-1',
        projectId: null,
        field: 'title',
        newValue: 'New Project',
        reason: 'Found in Jira',
      });

      expect(proposal.id).toBeDefined();
      expect(proposal.status).toBe('pending');

      const proposals = await service.listProposals({ sessionId: 'session-1' });
      expect(proposals).toHaveLength(1);
    });

    it('approves a proposal and applies it to a new project', async () => {
      // Create proposals for a new project
      const p1 = await service.createProposal({
        sessionId: 's1', projectId: null, field: 'title',
        newValue: 'My Project', reason: 'Found',
      });
      const p2 = await service.createProposal({
        sessionId: 's1', projectId: null, field: 'description',
        newValue: 'A great project', reason: 'Found',
      });

      // Approve both — should create a new project
      await service.reviewProposal(p1.id, { action: 'approve' });
      await service.reviewProposal(p2.id, { action: 'approve' });

      const reviewed = await service.getProposal(p1.id);
      expect(reviewed!.status).toBe('approved');
    });

    it('rejects a proposal', async () => {
      const proposal = await service.createProposal({
        sessionId: 's1', projectId: null, field: 'title',
        newValue: 'Bad Title', reason: 'Guess',
      });

      await service.reviewProposal(proposal.id, { action: 'reject' });

      const reviewed = await service.getProposal(proposal.id);
      expect(reviewed!.status).toBe('rejected');
    });

    it('edits a proposal value', async () => {
      const proposal = await service.createProposal({
        sessionId: 's1', projectId: null, field: 'title',
        newValue: 'Draft Title', reason: 'Guess',
      });

      await service.reviewProposal(proposal.id, {
        action: 'edit',
        editedValue: 'Better Title',
      });

      const reviewed = await service.getProposal(proposal.id);
      expect(reviewed!.status).toBe('edited');
      expect(reviewed!.newValue).toBe('Better Title');
    });

    it('groups proposals by project', async () => {
      await service.createProposal({
        sessionId: 's1', projectId: null, field: 'title',
        newValue: 'Project A', reason: 'Found',
      });
      await service.createProposal({
        sessionId: 's1', projectId: null, field: 'description',
        newValue: 'Desc A', reason: 'Found',
      });
      await service.createProposal({
        sessionId: 's1', projectId: 'existing-123', field: 'status',
        oldValue: 'active', newValue: 'paused', reason: 'No activity',
      });

      const groups = await service.getProposalGroups('s1');
      expect(groups).toHaveLength(2); // One new project group, one update group
    });
  });

  describe('discovery sessions', () => {
    it('creates and retrieves a session', async () => {
      const session = await service.createSession();

      expect(session.id).toBeDefined();
      expect(session.status).toBe('running');

      const retrieved = await service.getSession(session.id);
      expect(retrieved).toEqual(session);
    });

    it('completes a session', async () => {
      const session = await service.createSession();
      await service.updateSession(session.id, { status: 'completed', proposalCount: 5 });

      const updated = await service.getSession(session.id);
      expect(updated!.status).toBe('completed');
      expect(updated!.proposalCount).toBe(5);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest src/projects/projects.service.spec.ts --no-coverage`
Expected: FAIL — module not found

**Step 3: Implement ProjectsService**

Create `collector/src/projects/projects.service.ts`:
```typescript
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
    this.redis = new Redis(this.configService.get<string>('redis.url')!);
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
      const key = proposal.projectId ?? `new:${proposals.filter(p => p.projectId === null).indexOf(proposal) === 0 ? '0' : '0'}`;
      // Group by projectId for updates, or group all null-projectId proposals together for new projects
      const groupKey = proposal.projectId ?? 'new';

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          projectId: proposal.projectId,
          isNew: proposal.projectId === null,
          proposals: [],
        });
      }
      groups.get(groupKey)!.proposals.push(proposal);
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
        // Build a new project from approved field proposals
        const fields: Record<string, unknown> = {};
        for (const p of approved) {
          fields[p.field] = p.newValue;
        }
        const project = await this.createProject({
          title: (fields.title as string) ?? 'Untitled Project',
          description: (fields.description as string) ?? '',
          goals: (fields.goals as string[]) ?? [],
          status: (fields.status as any) ?? 'active',
          myRole: (fields.myRole as any) ?? 'informed',
          participants: (fields.participants as any) ?? [],
          sources: (fields.sources as any) ?? [],
          tags: (fields.tags as string[]) ?? [],
          metadata: (fields.metadata as any) ?? {},
        });
        results.push(project);
      } else {
        // Apply field updates to existing project
        const updates: Record<string, unknown> = {};
        for (const p of approved) {
          updates[p.field] = p.newValue;
        }
        const project = await this.updateProject(group.projectId!, updates as UpdateProjectRequest);
        results.push(project);
      }
    }

    return results;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest src/projects/projects.service.spec.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**
```bash
git add collector/src/projects/
git commit -m "feat(projects): add ProjectsService with Redis storage and tests"
```

---

### Task 4: Projects Controller

**Files:**
- Create: `collector/src/controllers/projects.controller.ts`
- Modify: `collector/src/app.module.ts`

**Step 1: Create the controller**

Create `collector/src/controllers/projects.controller.ts`:
```typescript
import {
  Body, Controller, Delete, Get, HttpException, HttpStatus,
  Param, Post, Put, Query, UseGuards,
} from '@nestjs/common';

import { ApiKeyGuard } from '../auth/api-key.guard';
import { ProjectsService } from '../projects/projects.service';
import {
  BatchReviewRequest,
  CreateProjectRequest,
  CreateProposalRequest,
  ReviewProposalRequest,
  UpdateProjectRequest,
} from '../types/projects';

@Controller('projects')
@UseGuards(ApiKeyGuard)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  // --- Projects CRUD ---

  @Get()
  async listProjects(
    @Query('status') status?: string,
    @Query('myRole') myRole?: string,
  ) {
    return this.projectsService.listProjects({ status, myRole });
  }

  @Get(':id')
  async getProject(@Param('id') id: string) {
    const project = await this.projectsService.getProject(id);
    if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    return project;
  }

  @Post()
  async createProject(@Body() body: CreateProjectRequest) {
    return this.projectsService.createProject(body);
  }

  @Put(':id')
  async updateProject(@Param('id') id: string, @Body() body: UpdateProjectRequest) {
    try {
      return await this.projectsService.updateProject(id, body);
    } catch {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }
  }

  @Delete(':id')
  async deleteProject(@Param('id') id: string) {
    await this.projectsService.deleteProject(id);
    return { message: 'Project deleted' };
  }

  // --- Proposals ---

  @Get('proposals/list')
  async listProposals(
    @Query('sessionId') sessionId?: string,
    @Query('status') status?: string,
  ) {
    return this.projectsService.listProposals({ sessionId, status });
  }

  @Get('proposals/groups/:sessionId')
  async getProposalGroups(@Param('sessionId') sessionId: string) {
    return this.projectsService.getProposalGroups(sessionId);
  }

  @Post('proposals')
  async createProposal(@Body() body: CreateProposalRequest) {
    return this.projectsService.createProposal(body);
  }

  @Put('proposals/:id/review')
  async reviewProposal(
    @Param('id') id: string,
    @Body() body: ReviewProposalRequest,
  ) {
    try {
      return await this.projectsService.reviewProposal(id, body);
    } catch {
      throw new HttpException('Proposal not found', HttpStatus.NOT_FOUND);
    }
  }

  @Post('proposals/batch-review')
  async batchReview(@Body() body: BatchReviewRequest) {
    return this.projectsService.batchReviewProposals(body.proposalIds, body.action);
  }

  @Post('proposals/apply/:sessionId')
  async applyProposals(@Param('sessionId') sessionId: string) {
    return this.projectsService.applyApprovedProposals(sessionId);
  }
}
```

**Step 2: Register in app.module.ts**

Add imports and register the controller and service in `collector/src/app.module.ts`:

Add to imports at top:
```typescript
import { ProjectsController } from './controllers/projects.controller';
import { ProjectsService } from './projects/projects.service';
```

Add `ProjectsController` to the controllers array.
Add `ProjectsService` to the providers array.

**Step 3: Verify the module compiles**

Run: `cd /Volumes/projects/personal-ai/collector && npx nest build`
Expected: Build succeeds

**Step 4: Commit**
```bash
git add collector/src/controllers/projects.controller.ts collector/src/app.module.ts
git commit -m "feat(projects): add projects controller with CRUD and proposals endpoints"
```

---

### Task 5: Discovery Service + SSE

**Files:**
- Create: `collector/src/projects/discovery.service.ts`
- Modify: `collector/src/controllers/projects.controller.ts` (add discovery endpoints)
- Modify: `collector/src/app.module.ts` (register DiscoveryService)
- Modify: `collector/src/config/config.ts` (add code-agent config)

**Step 1: Add code-agent config**

In `collector/src/config/config.ts`, add:
```typescript
export const codeAgentConfig = registerAs('codeAgent', () => ({
  url: process.env.CODE_AGENT_URL || 'http://code-agent:8085',
  collectorApiUrl: process.env.COLLECTOR_API_URL || 'http://collector:8087/api/v1',
  collectorApiKey: process.env.API_KEY || '',
  mcpServerPath: process.env.MCP_SERVER_PATH || '/opt/collector-mcp/dist/index.js',
}));
```

Register it in `app.module.ts` config `load` array.

**Step 2: Create DiscoveryService**

Create `collector/src/projects/discovery.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Subject } from 'rxjs';

import { Proposal } from '../types/projects';
import { ProjectsService } from './projects.service';

export interface DiscoveryEvent {
  type: 'proposal_created' | 'session_completed' | 'session_failed' | 'status_update';
  data: any;
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

    // Run discovery in background
    this.runDiscovery(session.id, subject).catch(async (error) => {
      this.logger.error(`Discovery session ${session.id} failed: ${error.message}`);
      await this.projectsService.updateSession(session.id, {
        status: 'failed',
        error: error.message,
      });
      subject.next({ type: 'session_failed', data: { error: error.message } });
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

    // Get existing projects for context
    const existingProjects = await this.projectsService.listProjects();

    // Build discovery prompt
    const prompt = this.buildDiscoveryPrompt(sessionId, existingProjects);

    // Build MCP config for the temp workspace
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

    // Call code-agent prompt endpoint
    // The code-agent will create a temp workspace; we need to write the MCP config there.
    // For now, we use the prompt endpoint with the MCP config embedded in the prompt,
    // instructing the agent to write .cursor/mcp.json first.
    const response = await axios.post(`${codeAgentUrl}/api/prompt`, {
      prompt: `First, create the file .cursor/mcp.json with this exact content:\n${JSON.stringify(mcpConfig, null, 2)}\n\nThen proceed with the task:\n\n${prompt}`,
      timeout: 600000, // 10 minutes
    });

    // Parse proposals from the agent output
    // The agent uses MCP tools to create proposals directly via the collector API,
    // so we just need to check what proposals were created for this session
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

  private buildDiscoveryPrompt(sessionId: string, existingProjects: any[]): string {
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

  // Called by the proposals endpoint when a new proposal is created via MCP
  async notifyProposalCreated(proposal: Proposal): Promise<void> {
    const subject = this.sessions.get(proposal.sessionId);
    if (subject) {
      subject.next({ type: 'proposal_created', data: proposal });
    }
  }
}
```

**Step 3: Add discovery + SSE endpoints to ProjectsController**

Add to `collector/src/controllers/projects.controller.ts`:

Add imports:
```typescript
import { Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { DiscoveryService, DiscoveryEvent } from '../projects/discovery.service';
```

Add `DiscoveryService` to constructor. Add endpoints:

```typescript
// --- Discovery ---

@Post('discover')
async startDiscovery() {
  return this.discoveryService.startDiscovery();
}

@Get('discover/:sessionId')
async getSession(@Param('sessionId') sessionId: string) {
  const session = await this.projectsService.getSession(sessionId);
  if (!session) throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
  return session;
}

@Sse('discover/:sessionId/events')
discoveryEvents(@Param('sessionId') sessionId: string): Observable<{ data: string }> {
  const subject = this.discoveryService.getSessionEvents(sessionId);
  if (!subject) {
    throw new HttpException('Session not found or already completed', HttpStatus.NOT_FOUND);
  }
  return subject.pipe(
    map((event: DiscoveryEvent) => ({
      data: JSON.stringify(event),
    })),
  );
}
```

**Step 4: Update proposals endpoint to notify discovery service**

Modify the `createProposal` method in the controller to also notify the discovery service:
```typescript
@Post('proposals')
async createProposal(@Body() body: CreateProposalRequest) {
  const proposal = await this.projectsService.createProposal(body);
  await this.discoveryService.notifyProposalCreated(proposal);
  return proposal;
}
```

**Step 5: Register DiscoveryService in app.module.ts**

Add import and add `DiscoveryService` to providers array.

**Step 6: Build and verify**

Run: `cd /Volumes/projects/personal-ai/collector && npx nest build`
Expected: Build succeeds

**Step 7: Commit**
```bash
git add collector/src/projects/discovery.service.ts collector/src/controllers/projects.controller.ts collector/src/app.module.ts collector/src/config/config.ts
git commit -m "feat(projects): add discovery service with code-agent integration and SSE"
```

---

### Task 6: Collector MCP Server

**Files:**
- Create: `collector/mcp-server/package.json`
- Create: `collector/mcp-server/tsconfig.json`
- Create: `collector/mcp-server/src/index.ts`

**Step 1: Initialize MCP server package**

Create `collector/mcp-server/package.json`:
```json
{
  "name": "collector-mcp-server",
  "version": "1.0.0",
  "description": "MCP server for collector search API",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "@types/node": "^22.19.8"
  }
}
```

Create `collector/mcp-server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

**Step 2: Install dependencies**

Run: `cd /Volumes/projects/personal-ai/collector/mcp-server && npm install`

**Step 3: Implement MCP server**

Create `collector/mcp-server/src/index.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const COLLECTOR_API_URL = process.env.COLLECTOR_API_URL || 'http://localhost:8087/api/v1';
const COLLECTOR_API_KEY = process.env.COLLECTOR_API_KEY || '';

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(COLLECTOR_API_KEY ? { 'x-api-key': COLLECTOR_API_KEY } : {}),
};

async function apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${COLLECTOR_API_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json();
}

const server = new McpServer({
  name: 'collector',
  version: '1.0.0',
});

// --- Read Tools ---

server.tool(
  'search',
  'Search across all indexed sources (Jira, Slack, Gmail, Drive, Confluence, Calendar)',
  {
    query: z.string().describe('Search query text'),
    sources: z.array(z.enum(['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'])).optional()
      .describe('Filter by specific sources'),
    searchType: z.enum(['vector', 'keyword', 'hybrid']).optional()
      .describe('Search method: vector (semantic), keyword (exact), hybrid (both). Default: hybrid'),
    startDate: z.string().optional().describe('Filter results after this ISO 8601 date'),
    endDate: z.string().optional().describe('Filter results before this ISO 8601 date'),
    limit: z.number().optional().describe('Max results to return (default: 10)'),
  },
  async ({ query, sources, searchType, startDate, endDate, limit }) => {
    const result = await apiCall('POST', '/search', {
      query, sources, searchType, startDate, endDate, limit,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_index_status',
  'Check indexing status of all sources — shows what is indexed and how fresh the data is',
  {},
  async () => {
    const result = await apiCall('GET', '/index/status');
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_document',
  'Fetch a single indexed document by its ID',
  {
    id: z.string().describe('Document ID'),
  },
  async ({ id }) => {
    const result = await apiCall('GET', `/search/documents/${id}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'list_projects',
  'List all discovered projects in the project repository',
  {
    status: z.enum(['active', 'paused', 'completed', 'archived']).optional()
      .describe('Filter by project status'),
  },
  async ({ status }) => {
    const query = status ? `?status=${status}` : '';
    const result = await apiCall('GET', `/projects${query}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_project',
  'Get full details of a specific project',
  {
    projectId: z.string().describe('Project UUID'),
  },
  async ({ projectId }) => {
    const result = await apiCall('GET', `/projects/${projectId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// --- Write Tools ---

server.tool(
  'propose_new_project',
  'Propose a newly discovered project for user review. Creates one proposal per field.',
  {
    sessionId: z.string().describe('Discovery session ID'),
    title: z.string().describe('Project title'),
    description: z.string().describe('Project description (2-3 sentences)'),
    goals: z.array(z.string()).optional().describe('Key project objectives'),
    status: z.enum(['active', 'paused', 'completed', 'archived']).optional().describe('Project status'),
    participants: z.array(z.object({
      name: z.string(),
      role: z.string().optional(),
      source: z.string().optional(),
    })).optional().describe('People involved'),
    sources: z.array(z.object({
      type: z.string().describe('Source type: jira_project, slack_channel, github_repo, drive_folder, confluence_space'),
      identifier: z.string().describe('Source identifier (e.g., PROJ, #channel-name)'),
      name: z.string().optional(),
    })).optional().describe('Linked source identifiers'),
    tags: z.array(z.string()).optional().describe('Labels/tags'),
    metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
    reason: z.string().describe('Why you believe this is a distinct project'),
  },
  async (args) => {
    const { sessionId, reason, ...fields } = args;
    const proposals = [];

    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const proposal = await apiCall('POST', '/projects/proposals', {
        sessionId,
        projectId: null,
        field,
        newValue: value,
        reason,
      });
      proposals.push(proposal);
    }

    return {
      content: [{
        type: 'text' as const,
        text: `Created ${proposals.length} proposals for new project "${args.title}". Awaiting user review.`,
      }],
    };
  },
);

server.tool(
  'propose_project_update',
  'Propose an update to a specific field of an existing project',
  {
    sessionId: z.string().describe('Discovery session ID'),
    projectId: z.string().describe('UUID of the project to update'),
    field: z.string().describe('Field name to update (title, description, goals, status, participants, sources, tags, metadata)'),
    newValue: z.unknown().describe('The proposed new value for the field'),
    reason: z.string().describe('Why this change is being proposed'),
  },
  async ({ sessionId, projectId, field, newValue, reason }) => {
    // Fetch current value for the diff
    const project = await apiCall('GET', `/projects/${projectId}`) as Record<string, unknown>;
    const oldValue = project[field] ?? null;

    const proposal = await apiCall('POST', '/projects/proposals', {
      sessionId,
      projectId,
      field,
      oldValue,
      newValue,
      reason,
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Created update proposal for "${field}" on project "${project.title}". Old: ${JSON.stringify(oldValue)}, New: ${JSON.stringify(newValue)}. Awaiting user review.`,
      }],
    };
  },
);

// --- Start Server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

**Step 4: Build MCP server**

Run: `cd /Volumes/projects/personal-ai/collector/mcp-server && npm run build`
Expected: Compiles to `dist/index.js`

**Step 5: Commit**
```bash
git add collector/mcp-server/
git commit -m "feat(mcp): add collector MCP server with search and proposal tools"
```

---

### Task 7: Docker Integration

**Files:**
- Modify: `services/ai/docker-compose.yml` (mount MCP server into code-agent)
- Modify: `code-agent/Dockerfile` (install MCP server dependencies)

**Step 1: Add volume mount for MCP server in docker-compose**

In `services/ai/docker-compose.yml`, add to the `code-agent` service `volumes`:
```yaml
- ./collector/mcp-server:/opt/collector-mcp:ro
```

**Step 2: Update code-agent Dockerfile**

In the base and production stages, add after the MCP config copy:
```dockerfile
# Install collector MCP server dependencies
COPY ./collector-mcp /opt/collector-mcp
RUN cd /opt/collector-mcp && npm install --only=production 2>/dev/null || true
```

Note: The volume mount in docker-compose overrides this for development. The Dockerfile COPY is for production builds that don't use volume mounts.

Actually, since the code-agent Dockerfile's build context is `code-agent/`, it can't access `collector/mcp-server/` directly. The volume mount approach in docker-compose is the right solution for both dev and production.

For production, we have two options:
1. Change the Docker build context to the repo root (disruptive)
2. Use the volume mount for both dev and production

Go with the volume mount approach only. In the production docker-compose override (if one exists), also add the mount. If not, the current compose already uses `target: production` with volume mounts.

**Step 3: Add collector env vars for code-agent connection**

Add to `collector/.env` (or `.env.example`):
```
CODE_AGENT_URL=http://code-agent:8085
MCP_SERVER_PATH=/opt/collector-mcp/dist/index.js
```

**Step 4: Verify the compose file is valid**

Run: `cd /Volumes/projects/personal-ai && docker compose -f services/ai/docker-compose.yml config --quiet`
Expected: No errors

**Step 5: Commit**
```bash
git add services/ai/docker-compose.yml collector/.env
git commit -m "feat(docker): mount collector MCP server in code-agent container"
```

---

### Task 8: Frontend — Project Types & API Hooks

**Files:**
- Create: `collector/ui/src/types/projects.ts`
- Create: `collector/ui/src/hooks/useProjects.ts`
- Create: `collector/ui/src/hooks/useDiscovery.ts`

**Step 1: Create frontend types**

Create `collector/ui/src/types/projects.ts` mirroring the backend types (Project, Proposal, DiscoverySession, ProposalGroup, etc.) — same interfaces as `collector/src/types/projects.ts` but without the request DTOs.

**Step 2: Create useProjects hook**

Create `collector/ui/src/hooks/useProjects.ts`:
```typescript
import { useState, useEffect, useCallback } from 'react';
import { Project, Proposal, ProposalGroup, ReviewProposalRequest } from '../types/projects';

const API = '/api/v1/projects';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async (filter?: { status?: string }) => {
    try {
      setLoading(true);
      const query = filter?.status ? `?status=${filter.status}` : '';
      const res = await fetch(`${API}${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProjects(await res.json());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    const res = await fetch(`${API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = await res.json();
    setProjects(prev => prev.map(p => p.id === id ? updated : p));
    return updated;
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    setProjects(prev => prev.filter(p => p.id !== id));
  }, []);

  return { projects, loading, error, fetchProjects, updateProject, deleteProject };
}

export function useProposals(sessionId: string | null) {
  const [groups, setGroups] = useState<ProposalGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/proposals/groups/${sessionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGroups(await res.json());
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const reviewProposal = useCallback(async (id: string, review: ReviewProposalRequest) => {
    const res = await fetch(`${API}/proposals/${id}/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(review),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchGroups(); // Refresh
    return res.json();
  }, [fetchGroups]);

  const batchReview = useCallback(async (proposalIds: string[], action: 'approve' | 'reject') => {
    const res = await fetch(`${API}/proposals/batch-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalIds, action }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchGroups();
  }, [fetchGroups]);

  const applyProposals = useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(`${API}/proposals/apply/${sessionId}`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [sessionId]);

  return { groups, loading, fetchGroups, reviewProposal, batchReview, applyProposals };
}
```

**Step 3: Create useDiscovery hook**

Create `collector/ui/src/hooks/useDiscovery.ts`:
```typescript
import { useState, useCallback, useRef } from 'react';
import { Proposal, DiscoverySession } from '../types/projects';

const API = '/api/v1/projects';

export interface DiscoveryEvent {
  type: 'proposal_created' | 'session_completed' | 'session_failed' | 'status_update';
  data: any;
}

export function useDiscovery() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [events, setEvents] = useState<DiscoveryEvent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const startDiscovery = useCallback(async () => {
    setStatus('running');
    setEvents([]);
    setProposals([]);

    const res = await fetch(`${API}/discover`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { sessionId: sid } = await res.json();
    setSessionId(sid);

    // Connect to SSE
    const es = new EventSource(`${API}/discover/${sid}/events`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const parsed: DiscoveryEvent = JSON.parse(event.data);
      setEvents(prev => [...prev, parsed]);

      if (parsed.type === 'proposal_created') {
        setProposals(prev => [...prev, parsed.data]);
      } else if (parsed.type === 'session_completed') {
        setStatus('completed');
        es.close();
      } else if (parsed.type === 'session_failed') {
        setStatus('failed');
        es.close();
      }
    };

    es.onerror = () => {
      setStatus('failed');
      es.close();
    };
  }, []);

  const stopDiscovery = useCallback(() => {
    eventSourceRef.current?.close();
    setStatus('idle');
  }, []);

  return { sessionId, status, events, proposals, startDiscovery, stopDiscovery };
}
```

**Step 4: Commit**
```bash
git add collector/ui/src/types/projects.ts collector/ui/src/hooks/useProjects.ts collector/ui/src/hooks/useDiscovery.ts
git commit -m "feat(ui): add project types and hooks for projects, proposals, and discovery"
```

---

### Task 9: Frontend — Projects Page

**Files:**
- Create: `collector/ui/src/pages/Projects.tsx`
- Create: `collector/ui/src/components/ProjectCard.tsx`
- Create: `collector/ui/src/components/ProposalDiff.tsx`
- Modify: `collector/ui/src/App.tsx` (add route and nav item)

**Step 1: Create ProjectCard component**

Create `collector/ui/src/components/ProjectCard.tsx`:
- Displays project title, status chip, myRole chip, source icons, participant count, last updated
- Click handler to expand/edit
- Uses MUI: Card, CardContent, Chip, Typography, Box, IconButton

**Step 2: Create ProposalDiff component**

Create `collector/ui/src/components/ProposalDiff.tsx`:
- Shows field name, old value (red background), new value (green background), agent's reason
- Action buttons: Approve (CheckIcon), Edit (EditIcon), Reject (CloseIcon)
- Inline edit mode when Edit is clicked
- Uses MUI: Box, Typography, IconButton, TextField, Chip

**Step 3: Create Projects page**

Create `collector/ui/src/pages/Projects.tsx`:
- Two MUI Tabs: "Projects" and "Discovery"
- Tab 1: Grid of ProjectCards, filter chips for status/role, edit dialog
- Tab 2: "Run Discovery" button, live proposal feed via useDiscovery hook, ProposalDiff components grouped by project, bulk approve/reject buttons
- Follow Dashboard.tsx patterns for layout, loading, error states

**Step 4: Add route and nav item**

In `collector/ui/src/App.tsx`:
- Add import: `import Projects from './pages/Projects';`
- Add nav icon import: `import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';`
- Add to NAV_ITEMS: `{ path: '/projects', label: 'Projects', icon: <AccountTreeOutlinedIcon /> }`
- Add Route: `<Route path="/projects" element={<Projects />} />`

**Step 5: Verify the UI builds**

Run: `cd /Volumes/projects/personal-ai/collector/ui && npx vite build`
Expected: Build succeeds

**Step 6: Commit**
```bash
git add collector/ui/src/pages/Projects.tsx collector/ui/src/components/ProjectCard.tsx collector/ui/src/components/ProposalDiff.tsx collector/ui/src/App.tsx
git commit -m "feat(ui): add projects page with repository view and discovery tab"
```

---

### Task 10: Framework Plugin — Day Planner

**Files:**
- Create: `framework/plugins/day-planner/README.md`
- Create: `framework/plugins/day-planner/skills/project_status/README.md`
- Create: `framework/plugins/day-planner/skills/daily_priorities/README.md`

**Step 1: Create plugin README**

Create `framework/plugins/day-planner/README.md`:
- Plugin metadata: name, version, purpose
- Command: `/plan_day`
- Dependencies: collector tool, time tool, timezone tool
- Instructions: orchestration flow (get projects → parallel skill execution → synthesize)
- Skills: `project_status` (parallel per project), `daily_priorities` (cross-project)
- Output format: structured daily plan
- Error handling: what to do if collector is unreachable

**Step 2: Create project_status skill**

Create `framework/plugins/day-planner/skills/project_status/README.md`:
- Purpose: Build status snapshot for a single project
- Input: Project data from collector API
- Instructions:
  1. Call time tool for current date/time
  2. For `active` role: search Jira for assigned tasks, search Slack for mentions, check calendar for project meetings, search Drive/Confluence for recent docs
  3. For `informed` role: search for key changes only (status changes, blockers, decisions)
  4. For `muted` role: skip entirely
  5. Compile into structured status object
- Output: { projectTitle, role, recentActivity, myTasks, blockers, nextActions, meetings }
- Includes curl templates for collector search API

**Step 3: Create daily_priorities skill**

Create `framework/plugins/day-planner/skills/daily_priorities/README.md`:
- Purpose: Cross-project priority analysis
- Input: All project status snapshots
- Instructions:
  1. Rank by urgency: overdue tasks > today's deadlines > blockers > meetings > routine
  2. Identify conflicts: overlapping meetings, competing deadlines
  3. Suggest focus blocks
  4. Surface unanswered questions/emails
- Output: Ranked priority list with suggested actions

**Step 4: Commit**
```bash
git add framework/plugins/day-planner/
git commit -m "feat(framework): add day-planner plugin with project_status and daily_priorities skills"
```

---

### Task 11: Integration Testing & Final Verification

**Step 1: Run all collector tests**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest --no-coverage`
Expected: All tests pass

**Step 2: Build all components**

Run (parallel):
- `cd /Volumes/projects/personal-ai/collector && npx nest build`
- `cd /Volumes/projects/personal-ai/collector/ui && npx vite build`
- `cd /Volumes/projects/personal-ai/collector/mcp-server && npm run build`
Expected: All build successfully

**Step 3: Lint check**

Run: `cd /Volumes/projects/personal-ai/collector && npm run lint`
Expected: No errors (or fix any that appear)

**Step 4: Verify chroma cleanup**

Run: `grep -ri "chroma" code-agent/ services/ --include="*.ts" --include="*.json" --include="*.yml" --include="*.yaml" --include="Dockerfile" | grep -v node_modules | grep -v ".md"`
Expected: No matches

**Step 5: Final commit if any fixes needed**
```bash
git add -A
git commit -m "fix: integration fixes and cleanup"
```
