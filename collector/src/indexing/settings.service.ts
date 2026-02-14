import { Injectable, Logger,OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { DataSource, SourceSettings } from '../types';

const ALL_SOURCES: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'];

@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(SettingsService.name);
    private redis: Redis;
    private readonly SETTINGS_PREFIX = 'index:settings:';
    private readonly DISABLED_SOURCES_KEY = 'index:disabled-sources';

    constructor(private configService: ConfigService) { }

    onModuleInit() {
        this.redis = new Redis(this.configService.get<string>('redis.url')!);
    }

    async onModuleDestroy() {
        await this.redis.quit();
    }

    private getSettingsKey(source: DataSource): string {
        return `${this.SETTINGS_PREFIX}${source}`;
    }

    async getSettings(source: DataSource): Promise<SourceSettings | null> {
        const data = await this.redis.get(this.getSettingsKey(source));
        if (!data) return null;
        try {
            return JSON.parse(data);
        } catch (error) {
            this.logger.error(`Failed to parse settings for ${source}: ${error.message}`);
            return null;
        }
    }

    async saveSettings(source: DataSource, settings: SourceSettings): Promise<void> {
        await this.redis.set(
            this.getSettingsKey(source),
            JSON.stringify(settings)
        );
        this.logger.log(`Settings saved for ${source}`);
    }

    async deleteSettings(source: DataSource): Promise<void> {
        await this.redis.del(this.getSettingsKey(source));
        this.logger.log(`Settings deleted for ${source}`);
    }

    // --- Disabled Sources Management ---

    async getDisabledSources(): Promise<DataSource[]> {
        const data = await this.redis.get(this.DISABLED_SOURCES_KEY);
        if (!data) return [];
        try {
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    async getEnabledSources(): Promise<DataSource[]> {
        const disabled = await this.getDisabledSources();
        return ALL_SOURCES.filter(s => !disabled.includes(s));
    }

    async isSourceEnabled(source: DataSource): Promise<boolean> {
        const disabled = await this.getDisabledSources();
        return !disabled.includes(source);
    }

    async setSourceEnabled(source: DataSource, enabled: boolean): Promise<void> {
        const disabled = await this.getDisabledSources();
        let updated: DataSource[];
        if (enabled) {
            updated = disabled.filter(s => s !== source);
        } else {
            updated = disabled.includes(source) ? disabled : [...disabled, source];
        }
        await this.redis.set(this.DISABLED_SOURCES_KEY, JSON.stringify(updated));
        this.logger.log(`Source ${source} ${enabled ? 'enabled' : 'disabled'}`);
    }

    async setDisabledSources(sources: DataSource[]): Promise<void> {
        await this.redis.set(this.DISABLED_SOURCES_KEY, JSON.stringify(sources));
    }
}