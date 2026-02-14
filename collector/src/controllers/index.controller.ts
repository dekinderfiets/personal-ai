import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { ApiKeyGuard } from '../auth/api-key.guard';
import { IndexingService } from '../indexing/indexing.service';
import { SettingsService } from '../indexing/settings.service';
import { DataSource, IndexRequest, IndexResponse, IndexStatus, SourceInfo, SourceSettings } from '../types';

const VALID_SOURCES: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'];

@Controller('index')
@UseGuards(ApiKeyGuard)
export class IndexController {
    constructor(
        private indexingService: IndexingService,
        private settingsService: SettingsService,
    ) { }

    @Post('all')
    async triggerAllIndexing(@Body() request: IndexRequest = {}): Promise<{
        started: DataSource[];
        skipped: DataSource[];
    }> {
        return this.indexingService.indexAll(request);
    }

    @Get('enabled-sources')
    async getEnabledSources(): Promise<DataSource[]> {
        return this.settingsService.getEnabledSources();
    }

    @Put('sources/:source/enabled')
    async setSourceEnabled(
        @Param('source') source: string,
        @Body() body: { enabled: boolean },
    ): Promise<{ message: string }> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        await this.settingsService.setSourceEnabled(source as DataSource, body.enabled);
        return { message: `Source ${source} ${body.enabled ? 'enabled' : 'disabled'}` };
    }

    @Post(':source')
    async triggerIndexing(
        @Param('source') source: string,
        @Body() request: IndexRequest = {},
    ): Promise<IndexResponse> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}. Valid sources: ${VALID_SOURCES.join(', ')}`, HttpStatus.BAD_REQUEST);
        }

        const enabled = await this.settingsService.isSourceEnabled(source as DataSource);
        if (!enabled) {
            throw new HttpException(`Source ${source} is disabled`, HttpStatus.FORBIDDEN);
        }

        const result = await this.indexingService.startIndexing(source as DataSource, request);

        return {
            status: result.started ? 'started' : 'already_running',
            source: source as DataSource,
            message: result.message,
        };
    }

    @Get('sources')
    async getAllSourceInfo(): Promise<SourceInfo[]> {
        return this.indexingService.getAllSourceInfo();
    }

    @Get(':source/status')
    async getSourceStatus(@Param('source') source: string): Promise<IndexStatus> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy endpoint kept for backwards compat
        return this.indexingService.getStatus(source as DataSource);
    }

    @Get('status')
    async getAllStatus(): Promise<IndexStatus[]> {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy endpoint kept for backwards compat
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

    private async ensureSourceEnabled(source: DataSource): Promise<void> {
        const enabled = await this.settingsService.isSourceEnabled(source);
        if (!enabled) {
            throw new HttpException(`Source ${source} is disabled`, HttpStatus.FORBIDDEN);
        }
    }

    @Get('discovery/jira/projects')
    async discoverJiraProjects(): Promise<any[]> {
        await this.ensureSourceEnabled('jira');
        return this.indexingService.getJiraProjects();
    }

    @Get('discovery/slack/channels')
    async discoverSlackChannels(): Promise<any[]> {
        await this.ensureSourceEnabled('slack');
        return this.indexingService.getSlackChannels();
    }

    @Get('discovery/drive/shared-drives')
    async discoverDriveSharedDrives(): Promise<any[]> {
        await this.ensureSourceEnabled('drive');
        return this.indexingService.getDriveSharedDrives();
    }

    @Get('discovery/drive/folders')
    async discoverDriveFolders(
        @Query('parentId') parentId?: string,
        @Query('driveId') driveId?: string,
    ): Promise<any[]> {
        await this.ensureSourceEnabled('drive');
        return this.indexingService.getDriveFolders(parentId, driveId);
    }

    @Get('discovery/confluence/spaces')
    async discoverConfluenceSpaces(): Promise<any[]> {
        await this.ensureSourceEnabled('confluence');
        return this.indexingService.getConfluenceSpaces();
    }

    @Get('discovery/calendar')
    async discoverCalendars(): Promise<any[]> {
        await this.ensureSourceEnabled('calendar');
        return this.indexingService.getCalendars();
    }

    @Get('discovery/gmail/labels')
    async discoverGmailLabels(): Promise<any[]> {
        await this.ensureSourceEnabled('gmail');
        return this.indexingService.getGmailLabels();
    }

}
