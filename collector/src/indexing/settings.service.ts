import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DataSource, SourceSettings } from '../types';

@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(SettingsService.name);
    private redis: Redis;
    private readonly SETTINGS_PREFIX = 'index:settings:';

    constructor(private configService: ConfigService) { }

    async onModuleInit() {
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
}