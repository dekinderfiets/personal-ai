import { SearchController } from './search.controller';

describe('SearchController', () => {
    let controller: SearchController;
    let mockChromaService: any;

    beforeEach(() => {
        mockChromaService = {
            search: jest.fn(),
            navigate: jest.fn(),
        };
        controller = new SearchController(mockChromaService, {} as any);
    });

    describe('search', () => {
        it('should delegate all body params to chromaService.search', async () => {
            const body = {
                query: 'test query',
                sources: ['gmail', 'slack'] as any,
                searchType: 'hybrid' as const,
                limit: 20,
                offset: 5,
                where: { type: 'email' },
                startDate: '2024-01-01',
                endDate: '2024-12-31',
            };
            const expected = { results: [], total: 0 };
            mockChromaService.search.mockResolvedValue(expected);

            const result = await controller.search(body);

            expect(result).toEqual(expected);
            expect(mockChromaService.search).toHaveBeenCalledWith('test query', {
                sources: ['gmail', 'slack'],
                searchType: 'hybrid',
                limit: 20,
                offset: 5,
                where: { type: 'email' },
                startDate: '2024-01-01',
                endDate: '2024-12-31',
            });
        });

        it('should pass undefined for optional params not provided', async () => {
            const body = { query: 'simple' } as any;
            mockChromaService.search.mockResolvedValue({ results: [], total: 0 });

            await controller.search(body);

            expect(mockChromaService.search).toHaveBeenCalledWith('simple', {
                sources: undefined,
                searchType: undefined,
                limit: undefined,
                offset: undefined,
                where: undefined,
                startDate: undefined,
                endDate: undefined,
            });
        });
    });

    describe('navigate', () => {
        it('should delegate with default values', async () => {
            const expected = { current: null, related: [], navigation: {} };
            mockChromaService.navigate.mockResolvedValue(expected);

            const result = await controller.navigate('doc-1', 'next', 'datapoint', undefined);

            expect(result).toEqual(expected);
            expect(mockChromaService.navigate).toHaveBeenCalledWith('doc-1', 'next', 'datapoint', 10);
        });

        it('should parse limit string to integer', async () => {
            mockChromaService.navigate.mockResolvedValue({ current: null, related: [], navigation: {} });

            await controller.navigate('doc-1', 'prev', 'chunk', '5');

            expect(mockChromaService.navigate).toHaveBeenCalledWith('doc-1', 'prev', 'chunk', 5);
        });

        it('should pass direction and scope parameters correctly', async () => {
            mockChromaService.navigate.mockResolvedValue({ current: null, related: [], navigation: {} });

            await controller.navigate('doc-1', 'siblings', 'context', '25');

            expect(mockChromaService.navigate).toHaveBeenCalledWith('doc-1', 'siblings', 'context', 25);
        });
    });
});
