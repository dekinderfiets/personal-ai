import { HttpException, HttpStatus } from '@nestjs/common';
import { firstValueFrom, Subject, toArray } from 'rxjs';

import { ProjectsController } from './projects.controller';

describe('ProjectsController', () => {
    let controller: ProjectsController;
    let mockProjectsService: any;
    let mockDiscoveryService: any;

    const mockProject = {
        id: 'proj-1',
        title: 'Test Project',
        description: 'A test project',
        goals: ['goal1'],
        status: 'active',
        myRole: 'active',
        participants: [],
        sources: [],
        tags: [],
        metadata: {},
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    };

    const mockProposal = {
        id: 'prop-1',
        projectId: 'proj-1',
        sessionId: 'session-1',
        field: 'title',
        oldValue: 'Old Title',
        newValue: 'New Title',
        reason: 'Better name',
        status: 'pending',
        reviewedAt: null,
        createdAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
        mockProjectsService = {
            listProjects: jest.fn(),
            createProject: jest.fn(),
            getProject: jest.fn(),
            updateProject: jest.fn(),
            deleteProject: jest.fn(),
            listProposals: jest.fn(),
            getProposal: jest.fn(),
            createProposal: jest.fn(),
            reviewProposal: jest.fn(),
            getProposalGroups: jest.fn(),
            batchReviewProposals: jest.fn(),
            applyApprovedProposals: jest.fn(),
            getSession: jest.fn(),
        };
        mockDiscoveryService = {
            startDiscovery: jest.fn(),
            notifyProposalCreated: jest.fn(),
            getSessionEvents: jest.fn(),
        };
        controller = new ProjectsController(mockProjectsService as any, mockDiscoveryService as any);
    });

    // --- Projects CRUD ---

    describe('listProjects', () => {
        it('should delegate to service with filters', async () => {
            const projects = [mockProject];
            mockProjectsService.listProjects.mockResolvedValue(projects);

            const result = await controller.listProjects('active', 'active');

            expect(result).toEqual(projects);
            expect(mockProjectsService.listProjects).toHaveBeenCalledWith({
                status: 'active',
                myRole: 'active',
            });
        });

        it('should delegate with undefined filters', async () => {
            mockProjectsService.listProjects.mockResolvedValue([]);

            const result = await controller.listProjects(undefined, undefined);

            expect(result).toEqual([]);
            expect(mockProjectsService.listProjects).toHaveBeenCalledWith({
                status: undefined,
                myRole: undefined,
            });
        });
    });

    describe('createProject', () => {
        it('should delegate to service', async () => {
            const body = { title: 'New Project', description: 'Desc' };
            mockProjectsService.createProject.mockResolvedValue(mockProject);

            const result = await controller.createProject(body);

            expect(result).toEqual(mockProject);
            expect(mockProjectsService.createProject).toHaveBeenCalledWith(body);
        });
    });

    describe('getProject', () => {
        it('should return project when found', async () => {
            mockProjectsService.getProject.mockResolvedValue(mockProject);

            const result = await controller.getProject('proj-1');

            expect(result).toEqual(mockProject);
            expect(mockProjectsService.getProject).toHaveBeenCalledWith('proj-1');
        });

        it('should throw HttpException 404 when not found', async () => {
            mockProjectsService.getProject.mockResolvedValue(null);

            await expect(controller.getProject('nonexistent')).rejects.toThrow(HttpException);
            await expect(controller.getProject('nonexistent')).rejects.toThrow('Project not found');
        });
    });

    describe('updateProject', () => {
        it('should delegate to service', async () => {
            const body = { title: 'Updated Title' };
            const updated = { ...mockProject, title: 'Updated Title' };
            mockProjectsService.updateProject.mockResolvedValue(updated);

            const result = await controller.updateProject('proj-1', body);

            expect(result).toEqual(updated);
            expect(mockProjectsService.updateProject).toHaveBeenCalledWith('proj-1', body);
        });

        it('should throw HttpException 404 when service throws', async () => {
            mockProjectsService.updateProject.mockRejectedValue(new Error('Project not found'));

            await expect(controller.updateProject('nonexistent', { title: 'X' })).rejects.toThrow(HttpException);
            await expect(controller.updateProject('nonexistent', { title: 'X' })).rejects.toThrow('Project not found');
        });
    });

    describe('deleteProject', () => {
        it('should delegate and return { deleted: true }', async () => {
            mockProjectsService.deleteProject.mockResolvedValue(undefined);

            const result = await controller.deleteProject('proj-1');

            expect(result).toEqual({ deleted: true });
            expect(mockProjectsService.deleteProject).toHaveBeenCalledWith('proj-1');
        });
    });

    // --- Proposals ---

    describe('listProposals', () => {
        it('should delegate with filters', async () => {
            const proposals = [mockProposal];
            mockProjectsService.listProposals.mockResolvedValue(proposals);

            const result = await controller.listProposals('session-1', 'pending');

            expect(result).toEqual(proposals);
            expect(mockProjectsService.listProposals).toHaveBeenCalledWith({
                sessionId: 'session-1',
                status: 'pending',
            });
        });

        it('should delegate with undefined filters', async () => {
            mockProjectsService.listProposals.mockResolvedValue([]);

            const result = await controller.listProposals(undefined, undefined);

            expect(result).toEqual([]);
            expect(mockProjectsService.listProposals).toHaveBeenCalledWith({
                sessionId: undefined,
                status: undefined,
            });
        });
    });

    describe('getProposal', () => {
        it('should return proposal when found', async () => {
            mockProjectsService.getProposal.mockResolvedValue(mockProposal);

            const result = await controller.getProposal('prop-1');

            expect(result).toEqual(mockProposal);
            expect(mockProjectsService.getProposal).toHaveBeenCalledWith('prop-1');
        });

        it('should throw 404 when not found', async () => {
            mockProjectsService.getProposal.mockResolvedValue(null);

            await expect(controller.getProposal('nonexistent')).rejects.toThrow(HttpException);
            await expect(controller.getProposal('nonexistent')).rejects.toThrow('Proposal not found');
        });
    });

    describe('createProposal', () => {
        it('should delegate and notify discovery service', async () => {
            const body = {
                projectId: 'proj-1',
                sessionId: 'session-1',
                field: 'title',
                newValue: 'New Title',
                reason: 'Better name',
            };
            mockProjectsService.createProposal.mockResolvedValue(mockProposal);

            const result = await controller.createProposal(body);

            expect(result).toEqual(mockProposal);
            expect(mockProjectsService.createProposal).toHaveBeenCalledWith(body);
            expect(mockDiscoveryService.notifyProposalCreated).toHaveBeenCalledWith(mockProposal);
        });
    });

    describe('reviewProposal', () => {
        it('should delegate to service', async () => {
            const body = { action: 'approve' as const };
            const reviewed = { ...mockProposal, status: 'approved' };
            mockProjectsService.reviewProposal.mockResolvedValue(reviewed);

            const result = await controller.reviewProposal('prop-1', body);

            expect(result).toEqual(reviewed);
            expect(mockProjectsService.reviewProposal).toHaveBeenCalledWith('prop-1', body);
        });

        it('should throw 404 when service throws', async () => {
            mockProjectsService.reviewProposal.mockRejectedValue(new Error('Proposal not found'));

            await expect(
                controller.reviewProposal('nonexistent', { action: 'approve' }),
            ).rejects.toThrow(HttpException);
            await expect(
                controller.reviewProposal('nonexistent', { action: 'approve' }),
            ).rejects.toThrow('Proposal not found');
        });
    });

    describe('getProposalGroups', () => {
        it('should delegate with sessionId', async () => {
            const groups = [{ projectId: 'proj-1', isNew: false, proposals: [mockProposal] }];
            mockProjectsService.getProposalGroups.mockResolvedValue(groups);

            const result = await controller.getProposalGroups('session-1');

            expect(result).toEqual(groups);
            expect(mockProjectsService.getProposalGroups).toHaveBeenCalledWith('session-1');
        });

        it('should throw 400 when sessionId missing', async () => {
            await expect(controller.getProposalGroups('')).rejects.toThrow(HttpException);
            await expect(controller.getProposalGroups('')).rejects.toThrow('sessionId is required');
        });
    });

    describe('batchReviewProposals', () => {
        it('should delegate for approve', async () => {
            const reviewed = [{ ...mockProposal, status: 'approved' }];
            mockProjectsService.batchReviewProposals.mockResolvedValue(reviewed);

            const result = await controller.batchReviewProposals({
                proposalIds: ['prop-1'],
                action: 'approve',
            });

            expect(result).toEqual(reviewed);
            expect(mockProjectsService.batchReviewProposals).toHaveBeenCalledWith(['prop-1'], 'approve');
        });

        it('should delegate for reject', async () => {
            const reviewed = [{ ...mockProposal, status: 'rejected' }];
            mockProjectsService.batchReviewProposals.mockResolvedValue(reviewed);

            const result = await controller.batchReviewProposals({
                proposalIds: ['prop-1'],
                action: 'reject',
            });

            expect(result).toEqual(reviewed);
            expect(mockProjectsService.batchReviewProposals).toHaveBeenCalledWith(['prop-1'], 'reject');
        });

        it('should throw 400 for invalid action', async () => {
            await expect(
                controller.batchReviewProposals({
                    proposalIds: ['prop-1'],
                    action: 'edit' as any,
                }),
            ).rejects.toThrow(HttpException);
            await expect(
                controller.batchReviewProposals({
                    proposalIds: ['prop-1'],
                    action: 'edit' as any,
                }),
            ).rejects.toThrow('Batch review only supports approve or reject');
        });
    });

    describe('applyProposals', () => {
        it('should delegate with sessionId', async () => {
            const projects = [mockProject];
            mockProjectsService.applyApprovedProposals.mockResolvedValue(projects);

            const result = await controller.applyProposals({ sessionId: 'session-1' });

            expect(result).toEqual(projects);
            expect(mockProjectsService.applyApprovedProposals).toHaveBeenCalledWith('session-1');
        });

        it('should throw 400 when sessionId missing', async () => {
            await expect(controller.applyProposals({ sessionId: '' })).rejects.toThrow(HttpException);
            await expect(controller.applyProposals({ sessionId: '' })).rejects.toThrow('sessionId is required');
        });
    });

    // --- Discovery ---

    describe('startDiscovery', () => {
        it('should delegate to discovery service', async () => {
            const expected = { sessionId: 'session-1' };
            mockDiscoveryService.startDiscovery.mockResolvedValue(expected);

            const result = await controller.startDiscovery();

            expect(result).toEqual(expected);
            expect(mockDiscoveryService.startDiscovery).toHaveBeenCalled();
        });
    });

    describe('getSession', () => {
        it('should return session when found', async () => {
            const session = {
                id: 'session-1',
                status: 'completed',
                startedAt: '2024-01-01T00:00:00Z',
                completedAt: '2024-01-01T00:01:00Z',
                proposalCount: 5,
            };
            mockProjectsService.getSession.mockResolvedValue(session);

            const result = await controller.getSession('session-1');

            expect(result).toEqual(session);
            expect(mockProjectsService.getSession).toHaveBeenCalledWith('session-1');
        });

        it('should throw 404 when not found', async () => {
            mockProjectsService.getSession.mockResolvedValue(null);

            await expect(controller.getSession('nonexistent')).rejects.toThrow(HttpException);
            await expect(controller.getSession('nonexistent')).rejects.toThrow('Session not found');
        });
    });

    describe('discoveryEvents', () => {
        it('should return observable from subject', async () => {
            const subject = new Subject<any>();
            mockDiscoveryService.getSessionEvents.mockReturnValue(subject);

            const observable = controller.discoveryEvents('session-1');

            const collected: any[] = [];
            const subscription = observable.subscribe((value) => collected.push(value));

            subject.next({ type: 'status_update', data: { message: 'Processing' } });
            subject.next({ type: 'proposal_created', data: { id: 'prop-1' } });
            subject.complete();

            expect(collected).toEqual([
                { data: JSON.stringify({ type: 'status_update', data: { message: 'Processing' } }) },
                { data: JSON.stringify({ type: 'proposal_created', data: { id: 'prop-1' } }) },
            ]);

            subscription.unsubscribe();
        });

        it('should throw 404 when no subject', () => {
            mockDiscoveryService.getSessionEvents.mockReturnValue(undefined);

            expect(() => controller.discoveryEvents('nonexistent')).toThrow(HttpException);
            expect(() => controller.discoveryEvents('nonexistent')).toThrow(
                'Session not found or already completed',
            );
        });
    });
});
