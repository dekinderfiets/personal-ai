import { Controller, Get } from '@nestjs/common';

@Controller()
export class RootController {
    @Get()
    getApiInfo() {
        return {
            service: 'collector',
            version: '1.0.0',
            endpoints: {
                health: '/api/v1/health',
                index: '/api/v1/index',
                search: '/api/v1/search',
                analytics: '/api/v1/analytics',
                events: '/api/v1/events',
                workflows: '/api/v1/workflows',
            },
        };
    }
}
