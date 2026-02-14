import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { map,Observable } from 'rxjs';

import { ApiKeyGuard } from '../auth/api-key.guard';
import { DiscoveryEvent,DiscoveryService } from '../projects/discovery.service';
import { ProjectsService } from '../projects/projects.service';
import {
    BatchReviewRequest,
    CreateProjectRequest,
    CreateProposalRequest,
    Project,
    Proposal,
    ProposalGroup,
    ReviewProposalRequest,
    UpdateProjectRequest,
} from '../types/projects';

@Controller('projects')
@UseGuards(ApiKeyGuard)
export class ProjectsController {
    constructor(
        private projectsService: ProjectsService,
        private discoveryService: DiscoveryService,
    ) {}

    // --- Projects CRUD ---

    @Get()
    async listProjects(
        @Query('status') status?: string,
        @Query('myRole') myRole?: string,
    ): Promise<Project[]> {
        return this.projectsService.listProjects({ status, myRole });
    }

    @Post()
    async createProject(@Body() body: CreateProjectRequest): Promise<Project> {
        return this.projectsService.createProject(body);
    }

    @Get(':id')
    async getProject(@Param('id') id: string): Promise<Project> {
        const project = await this.projectsService.getProject(id);
        if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
        return project;
    }

    @Patch(':id')
    async updateProject(@Param('id') id: string, @Body() body: UpdateProjectRequest): Promise<Project> {
        try {
            return await this.projectsService.updateProject(id, body);
        } catch (e) {
            throw new HttpException((e as Error).message, HttpStatus.NOT_FOUND);
        }
    }

    @Delete(':id')
    async deleteProject(@Param('id') id: string): Promise<{ deleted: true }> {
        await this.projectsService.deleteProject(id);
        return { deleted: true };
    }

    // --- Proposals ---

    @Get('proposals/groups')
    async getProposalGroups(@Query('sessionId') sessionId: string): Promise<ProposalGroup[]> {
        if (!sessionId) throw new HttpException('sessionId is required', HttpStatus.BAD_REQUEST);
        return this.projectsService.getProposalGroups(sessionId);
    }

    @Get('proposals')
    async listProposals(
        @Query('sessionId') sessionId?: string,
        @Query('status') status?: string,
    ): Promise<Proposal[]> {
        return this.projectsService.listProposals({ sessionId, status });
    }

    @Post('proposals')
    async createProposal(@Body() body: CreateProposalRequest): Promise<Proposal> {
        const proposal = await this.projectsService.createProposal(body);
        this.discoveryService.notifyProposalCreated(proposal);
        return proposal;
    }

    @Post('proposals/batch-review')
    async batchReviewProposals(@Body() body: BatchReviewRequest): Promise<Proposal[]> {
        if (body.action !== 'approve' && body.action !== 'reject') {
            throw new HttpException('Batch review only supports approve or reject', HttpStatus.BAD_REQUEST);
        }
        return this.projectsService.batchReviewProposals(body.proposalIds, body.action);
    }

    @Post('proposals/apply')
    async applyProposals(@Body() body: { sessionId: string }): Promise<Project[]> {
        if (!body.sessionId) throw new HttpException('sessionId is required', HttpStatus.BAD_REQUEST);
        return this.projectsService.applyApprovedProposals(body.sessionId);
    }

    @Get('proposals/:id')
    async getProposal(@Param('id') id: string): Promise<Proposal> {
        const proposal = await this.projectsService.getProposal(id);
        if (!proposal) throw new HttpException('Proposal not found', HttpStatus.NOT_FOUND);
        return proposal;
    }

    @Post('proposals/:id/review')
    async reviewProposal(@Param('id') id: string, @Body() body: ReviewProposalRequest): Promise<Proposal> {
        try {
            return await this.projectsService.reviewProposal(id, body);
        } catch (e) {
            throw new HttpException((e as Error).message, HttpStatus.NOT_FOUND);
        }
    }

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
}
