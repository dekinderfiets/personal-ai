import { HealthController } from './health.controller';

jest.mock('axios', () => ({
    default: { get: jest.fn() },
    get: jest.fn(),
}));
import axios from 'axios';

describe('HealthController', () => {
    let controller: HealthController;
    let mockConfigService: any;
    let mockCursorService: any;
    let mockTemporalClient: any;

    beforeEach(() => {
        mockConfigService = {
            get: jest.fn().mockReturnValue('http://localhost:9200'),
        };
        mockCursorService = {
            redis: { ping: jest.fn() },
        };
        mockTemporalClient = {
            checkHealth: jest.fn(),
        };
        controller = new HealthController(mockConfigService, mockCursorService, mockTemporalClient);
    });

    it('should return ok when all dependencies are up', async () => {
        mockCursorService.redis.ping.mockResolvedValue('PONG');
        (axios.get as jest.Mock).mockResolvedValue({});
        mockTemporalClient.checkHealth.mockResolvedValue(true);

        const result = await controller.health();

        expect(result.status).toBe('ok');
        expect(result.service).toBe('index-service');
        expect(result.dependencies).toEqual({
            redis: 'up',
            elasticsearch: 'up',
            temporal: 'up',
        });
        expect(result.timestamp).toBeDefined();
    });

    it('should return partial when Redis is down', async () => {
        mockCursorService.redis.ping.mockRejectedValue(new Error('connection refused'));
        (axios.get as jest.Mock).mockResolvedValue({});
        mockTemporalClient.checkHealth.mockResolvedValue(true);

        const result = await controller.health();

        expect(result.status).toBe('partial');
        expect(result.dependencies.redis).toBe('down');
        expect(result.dependencies.elasticsearch).toBe('up');
        expect(result.dependencies.temporal).toBe('up');
    });

    it('should return partial when Elasticsearch is down', async () => {
        mockCursorService.redis.ping.mockResolvedValue('PONG');
        (axios.get as jest.Mock).mockRejectedValue(new Error('connection refused'));
        mockTemporalClient.checkHealth.mockResolvedValue(true);

        const result = await controller.health();

        expect(result.status).toBe('partial');
        expect(result.dependencies.redis).toBe('up');
        expect(result.dependencies.elasticsearch).toBe('down');
    });

    it('should return partial when Temporal is down', async () => {
        mockCursorService.redis.ping.mockResolvedValue('PONG');
        (axios.get as jest.Mock).mockResolvedValue({});
        mockTemporalClient.checkHealth.mockResolvedValue(false);

        const result = await controller.health();

        expect(result.status).toBe('partial');
        expect(result.dependencies.temporal).toBe('down');
    });

    it('should return partial when all dependencies are down', async () => {
        mockCursorService.redis.ping.mockRejectedValue(new Error());
        (axios.get as jest.Mock).mockRejectedValue(new Error());
        mockTemporalClient.checkHealth.mockRejectedValue(new Error());

        const result = await controller.health();

        expect(result.status).toBe('partial');
        expect(result.dependencies).toEqual({
            redis: 'down',
            elasticsearch: 'down',
            temporal: 'down',
        });
    });

    it('should handle Redis returning non-PONG response', async () => {
        mockCursorService.redis.ping.mockResolvedValue('NOT_PONG');
        (axios.get as jest.Mock).mockResolvedValue({});
        mockTemporalClient.checkHealth.mockResolvedValue(true);

        const result = await controller.health();

        expect(result.status).toBe('partial');
        expect(result.dependencies.redis).toBe('down');
    });
});
