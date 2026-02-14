import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, Res,UseGuards } from '@nestjs/common';
import { Response } from 'express';

import { ApiKeyGuard } from '../auth/api-key.guard';
import { AnalyticsService, IndexingRun,SourceStats, SystemStats } from '../indexing/analytics.service';
import { ConnectorHealth,ConnectorHealthService } from '../indexing/health.service';
import { SettingsService } from '../indexing/settings.service';
import { DataSource, SourceSettings } from '../types';

const VALID_SOURCES: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'];

@Controller('analytics')
@UseGuards(ApiKeyGuard)
export class AnalyticsController {
    constructor(
        private analyticsService: AnalyticsService,
        private healthService: ConnectorHealthService,
        private settingsService: SettingsService,
    ) {}

    // --- Analytics Endpoints ---

    @Get('stats')
    async getSystemStats(): Promise<SystemStats> {
        const enabledSources = await this.settingsService.getEnabledSources();
        return this.analyticsService.getSystemStats(enabledSources);
    }

    @Get('stats/:source')
    async getSourceStats(@Param('source') source: string): Promise<SourceStats> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        return this.analyticsService.getSourceStats(source as DataSource);
    }

    @Get('runs')
    async getAllRecentRuns(@Query('limit') limit?: string): Promise<IndexingRun[]> {
        const enabledSources = await this.settingsService.getEnabledSources();
        return this.analyticsService.getAllRecentRuns(enabledSources, parseInt(limit || '20', 10));
    }

    @Get('runs/:source')
    async getRecentRuns(
        @Param('source') source: string,
        @Query('limit') limit?: string,
    ): Promise<IndexingRun[]> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        return this.analyticsService.getRecentRuns(source as DataSource, parseInt(limit || '20', 10));
    }

    @Get('daily/:source')
    async getDailyStats(
        @Param('source') source: string,
        @Query('days') days?: string,
    ): Promise<{ date: string; runs: number; documents: number; errors: number }[]> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        return this.analyticsService.getDailyStats(source as DataSource, parseInt(days || '30', 10));
    }

    // --- Health Endpoints ---

    @Get('health')
    async getAllHealth(): Promise<ConnectorHealth[]> {
        const enabledSources = await this.settingsService.getEnabledSources();
        return this.healthService.checkAllHealth(enabledSources);
    }

    @Get('health/:source')
    async getSourceHealth(@Param('source') source: string): Promise<ConnectorHealth> {
        if (!VALID_SOURCES.includes(source as DataSource)) {
            throw new HttpException(`Invalid source: ${source}`, HttpStatus.BAD_REQUEST);
        }
        return this.healthService.checkHealth(source as DataSource);
    }

    // --- Config Export/Import Endpoints ---

    @Get('config/export')
    async exportConfig(@Res() res: Response): Promise<void> {
        const config: Record<string, SourceSettings | null> = {};
        for (const source of VALID_SOURCES) {
            config[source] = await this.settingsService.getSettings(source);
        }
        const disabledSources = await this.settingsService.getDisabledSources();

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=collector-config-${new Date().toISOString().split('T')[0]}.json`);
        res.send(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings: config, disabledSources }, null, 2));
    }

    @Post('config/import')
    async importConfig(@Body() body: { settings: Record<string, any>; disabledSources?: string[] }): Promise<{ imported: string[]; skipped: string[] }> {
        const imported: string[] = [];
        const skipped: string[] = [];

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard for untyped input
        if (!body.settings || typeof body.settings !== 'object') {
            throw new HttpException('Invalid config format. Expected { settings: { ... } }', HttpStatus.BAD_REQUEST);
        }

        for (const [source, settings] of Object.entries(body.settings)) {
            if (!VALID_SOURCES.includes(source as DataSource)) {
                skipped.push(source);
                continue;
            }
            if (settings && typeof settings === 'object') {
                await this.settingsService.saveSettings(source as DataSource, settings as SourceSettings);
                imported.push(source);
            } else {
                skipped.push(source);
            }
        }

        if (body.disabledSources && Array.isArray(body.disabledSources)) {
            const validDisabled = body.disabledSources.filter(s => VALID_SOURCES.includes(s as DataSource)) as DataSource[];
            await this.settingsService.setDisabledSources(validDisabled);
        }

        return { imported, skipped };
    }
}
