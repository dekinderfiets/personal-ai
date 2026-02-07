import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CursorService } from '../indexing/cursor.service';
import axios from 'axios';

@Controller('health')
export class HealthController {
    constructor(
        private configService: ConfigService,
        private cursorService: CursorService,
    ) {}

    @Get()
    async health() {
        let redisStatus = 'down';
        let chromaStatus = 'down';

        try {
            // Use the existing redis instance from cursorService
            const ping = await (this.cursorService as any).redis.ping();
            if (ping === 'PONG') redisStatus = 'up';
        } catch (e) {
            // Fallback if redis is not initialized or fails
        }

        try {
            const chromaUrl = this.configService.get<string>('chroma.url');
            const res = await axios.get(`${chromaUrl}/heartbeat`);
            chromaStatus = 'up';
        } catch (e) {}

        return {
            status: (redisStatus === 'up' && chromaStatus === 'up') ? 'ok' : 'partial',
            service: 'index-service',
            timestamp: new Date().toISOString(),
            dependencies: {
                redis: redisStatus,
                chroma: chromaStatus
            }
        };
    }
}
