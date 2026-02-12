import { RootController } from './root.controller';

describe('RootController', () => {
    let controller: RootController;

    beforeEach(() => {
        controller = new RootController();
    });

    describe('getApiInfo', () => {
        it('should return service info with correct service name and version', () => {
            const result = controller.getApiInfo();

            expect(result.service).toBe('collector');
            expect(result.version).toBe('1.0.0');
        });

        it('should return all expected endpoint paths', () => {
            const result = controller.getApiInfo();

            expect(result.endpoints).toEqual({
                health: '/api/v1/health',
                index: '/api/v1/index',
                search: '/api/v1/search',
                analytics: '/api/v1/analytics',
                events: '/api/v1/events',
                workflows: '/api/v1/workflows',
            });
        });
    });
});
