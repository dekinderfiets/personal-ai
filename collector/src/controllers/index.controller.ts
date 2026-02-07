import { Controller, Post, Get, Delete, Param, Query, Body, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { IndexingService } from '../indexing/indexing.service';
import { SettingsService } from '../indexing/settings.service';
import { DataSource, IndexRequest, IndexResponse, IndexStatus, SourceSettings } from '../types';
import { ApiKeyGuard } from '../auth/api-key.guard';

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
}
