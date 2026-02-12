import { Controller, Post, Get, Delete, Param, Query, Body, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { IndexingService } from '../indexing/indexing.service';
import { SettingsService } from '../indexing/settings.service';
import { DataSource, IndexRequest, IndexResponse, IndexStatus, SourceSettings } from '../types';
import { ApiKeyGuard } from '../auth/api-key.guard';

const VALID_SOURCES: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar', 'github'];

@Controller('index')
@UseGuards(ApiKeyGuard)
export class IndexController {
    constructor(
        private indexingService: IndexingService,
        private settingsService: SettingsService,
    ) { }

    @Post('migrate-timestamps')
    async migrateTimestamps(): Promise<{ message: string; migrated: Record<string, number> }> {
        const migrated = await this.indexingService.migrateTimestamps();
        return { message: 'Timestamp migration complete', migrated };
    }

    @Post('all')
    async triggerAllIndexing(@Body() request: IndexRequest = {}): Promise<{
        started: DataSource[];
        skipped: DataSource[];
    }> {
        return this.indexingService.indexAll(request);
    }

    @Post(':source')
    async triggerIndexing(
        @Param('source') source: string,
        @Body() request: IndexRequest = {},
    ): Promise<IndexResponse> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}. Valid sources: ${VALID_SOURCES.join(', ')}`, HttpStatus.BAD_REQUEST);
        }

        const result = await this.indexingService.startIndexing(source as DataSource, request);

        return {
            status: result.started ? 'started' : 'already_running',
            source: source as DataSource,
            message: result.message,
        };
    }

    @Get(':source/status')
    async getSourceStatus(@Param('source') source: string): Promise<IndexStatus> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        return this.indexingService.getStatus(source as DataSource);
    }

    @Get('status')
    async getAllStatus(): Promise<IndexStatus[]> {
        return this.indexingService.getAllStatus();
    }

    @Delete(':source/status')
    async resetStatus(@Param('source') source: string): Promise<{ message: string }> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        await this.indexingService.resetStatusOnly(source as DataSource);
        return { message: `Status reset for ${source}` };
    }

    @Delete(':source')
    async deleteCollection(@Param('source') source: string): Promise<{ message: string }> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        await this.indexingService.resetCursor(source as DataSource);
        // TODO: Implement file deletion for entire source directory if needed
        return { message: `Collection reset for ${source}` };
    }

    @Delete('all/reset')
    async resetAll(): Promise<{ message: string }> {
        await this.indexingService.resetAll();
        return { message: 'Cursor and status reset for all sources' };
    }

    @Delete(':source/:id')
    async deleteDocument(
        @Param('source') source: string,
        @Param('id') id: string
    ): Promise<{ message: string }> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        await this.indexingService.deleteDocument(source as DataSource, id);
        return { message: `Document ${id} deleted from ${source}` };
    }

    // --- Settings Endpoints ---

    @Get('settings/:source')
    async getSettings(@Param('source') source: string): Promise<SourceSettings | null> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        return this.settingsService.getSettings(source as DataSource);
    }

    @Post('settings/:source')
    async saveSettings(
        @Param('source') source: string,
        @Body() settings: SourceSettings,
    ): Promise<{ message: string }> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        await this.settingsService.saveSettings(source as DataSource, settings);
        return { message: `Settings saved for ${source}` };
    }

    // --- Discovery Endpoints ---

    @Get('discovery/jira/projects')
    async discoverJiraProjects(): Promise<any[]> {
        return this.indexingService.getJiraProjects();
    }

    @Get('discovery/slack/channels')
    async discoverSlackChannels(): Promise<any[]> {
        return this.indexingService.getSlackChannels();
    }

    @Get('discovery/drive/folders')
    async discoverDriveFolders(@Query('parentId') parentId?: string): Promise<any[]> {
        return this.indexingService.getDriveFolders(parentId);
    }

    @Get('discovery/confluence/spaces')
    async discoverConfluenceSpaces(): Promise<any[]> {
        return this.indexingService.getConfluenceSpaces();
    }

    @Get('discovery/calendar')
    async discoverCalendars(): Promise<any[]> {
        return this.indexingService.getCalendars();
    }

    @Get('discovery/gmail/labels')
    async discoverGmailLabels(): Promise<any[]> {
        return this.indexingService.getGmailLabels();
    }

    @Get('discovery/github/repos')
    async discoverGitHubRepos(): Promise<any[]> {
        return this.indexingService.getGitHubRepositories();
    }
}
