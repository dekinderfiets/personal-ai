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
    smembers: jest.fn(async (key: string) => {
      const data = store.get(key);
      return data ? JSON.parse(data) : [];
    }),
    sadd: jest.fn(async (key: string, ...members: string[]) => {
      const existing = store.get(key);
      const set = new Set<string>(existing ? JSON.parse(existing) : []);
      let added = 0;
      for (const m of members) {
        if (!set.has(m)) { set.add(m); added++; }
      }
      store.set(key, JSON.stringify([...set]));
      return added;
    }),
    srem: jest.fn(async (key: string, ...members: string[]) => {
      const existing = store.get(key);
      const set = new Set<string>(existing ? JSON.parse(existing) : []);
      let removed = 0;
      for (const m of members) {
        if (set.delete(m)) removed++;
      }
      store.set(key, JSON.stringify([...set]));
      return removed;
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
      const p1 = await service.createProposal({
        sessionId: 's1', projectId: null, field: 'title',
        newValue: 'My Project', reason: 'Found',
      });
      const p2 = await service.createProposal({
        sessionId: 's1', projectId: null, field: 'description',
        newValue: 'A great project', reason: 'Found',
      });

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
      expect(groups).toHaveLength(2);
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
