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
        let elasticsearchStatus = 'down';
        let temporalStatus = 'down';

        try {
            const ping = await (this.cursorService as any).redis.ping();
            if (ping === 'PONG') redisStatus = 'up';
        } catch (e) {}

        try {
            const esUrl = this.configService.get<string>('elasticsearch.node');
            await axios.get(`${esUrl}/_cluster/health`);
            elasticsearchStatus = 'up';
        } catch (e) {}

        try {
            const healthy = await this.temporalClient.checkHealth();
            temporalStatus = healthy ? 'up' : 'down';
        } catch (e) {}

        const allUp = redisStatus === 'up' && elasticsearchStatus === 'up' && temporalStatus === 'up';

        return {
            status: allUp ? 'ok' : 'partial',
            service: 'index-service',
            timestamp: new Date().toISOString(),
            dependencies: {
                redis: redisStatus,
                elasticsearch: elasticsearchStatus,
                temporal: temporalStatus,
            }
        };
    }
}
