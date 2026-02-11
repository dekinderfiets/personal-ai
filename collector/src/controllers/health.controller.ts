import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CursorService } from '../indexing/cursor.service';
import { TemporalClientService } from '../temporal/temporal-client.service';
import axios from 'axios';

@Controller('health')
export class HealthController {
    constructor(
        private configService: ConfigService,
        private cursorService: CursorService,
        private temporalClient: TemporalClientService,
    ) {}

    @Get()
    async health() {
        let redisStatus = 'down';
        let chromaStatus = 'down';
        let temporalStatus = 'disabled';

        try {
            const ping = await (this.cursorService as any).redis.ping();
            if (ping === 'PONG') redisStatus = 'up';
        } catch (e) {}

        try {
            const chromaUrl = this.configService.get<string>('chroma.url');
            await axios.get(`${chromaUrl}/api/v2/heartbeat`);
            chromaStatus = 'up';
        } catch (e) {}

        if (this.temporalClient.isConnected()) {
            try {
                const healthy = await this.temporalClient.checkHealth();
                temporalStatus = healthy ? 'up' : 'down';
            } catch (e) {
                temporalStatus = 'down';
            }
        }

        const coreUp = redisStatus === 'up' && chromaStatus === 'up';
        const temporalOk = temporalStatus === 'up' || temporalStatus === 'disabled';

        return {
            status: coreUp && temporalOk ? 'ok' : 'partial',
            service: 'index-service',
            timestamp: new Date().toISOString(),
            dependencies: {
                redis: redisStatus,
                chroma: chromaStatus,
                temporal: temporalStatus,
            }
        };
    }
}
