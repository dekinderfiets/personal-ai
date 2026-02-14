import { SearchController } from './search.controller';

const ALL_SOURCES = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'];

describe('SearchController', () => {
    let controller: SearchController;
    let mockElasticsearchService: any;
    let mockSettingsService: any;

    beforeEach(() => {
        mockElasticsearchService = {
            search: jest.fn(),
            navigate: jest.fn(),
            countDocuments: jest.fn().mockResolvedValue(10),
            listDocuments: jest.fn().mockResolvedValue({ results: [], total: 0 }),
            getDocument: jest.fn().mockResolvedValue(null),
        };
        mockSettingsService = {
            getEnabledSources: jest.fn().mockResolvedValue(ALL_SOURCES),
        };
        controller = new SearchController(mockElasticsearchService, {} as any, mockSettingsService);
    });

    describe('search', () => {
        it('should delegate all body params to elasticsearchService.search', async () => {
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
            mockElasticsearchService.search.mockResolvedValue(expected);

            const result = await controller.search(body);

            expect(result).toEqual(expected);
            expect(mockElasticsearchService.search).toHaveBeenCalledWith('test query', {
                sources: ['gmail', 'slack'],
                searchType: 'hybrid',
                limit: 20,
                offset: 5,
                where: { type: 'email' },
                startDate: '2024-01-01',
                endDate: '2024-12-31',
            });
        });

        it('should use enabled sources when no sources specified', async () => {
            mockSettingsService.getEnabledSources.mockResolvedValue(['gmail', 'slack']);
            mockElasticsearchService.search.mockResolvedValue({ results: [], total: 0 });

            await controller.search({ query: 'test' });

            expect(mockElasticsearchService.search).toHaveBeenCalledWith('test', expect.objectContaining({
                sources: ['gmail', 'slack'],
            }));
        });

        it('should filter requested sources to only enabled ones', async () => {
            mockSettingsService.getEnabledSources.mockResolvedValue(['gmail', 'slack']);
            mockElasticsearchService.search.mockResolvedValue({ results: [], total: 0 });

            await controller.search({
                query: 'test',
                sources: ['gmail', 'jira', 'calendar'] as any,
            });

            expect(mockElasticsearchService.search).toHaveBeenCalledWith('test', expect.objectContaining({
                sources: ['gmail'],
            }));
        });
    });

    describe('documentStats', () => {
        it('should only count enabled sources', async () => {
            mockSettingsService.getEnabledSources.mockResolvedValue(['gmail', 'slack']);
            mockElasticsearchService.countDocuments.mockResolvedValue(50);

            const result = await controller.documentStats();

            expect(mockElasticsearchService.countDocuments).toHaveBeenCalledTimes(2);
            expect(mockElasticsearchService.countDocuments).toHaveBeenCalledWith('gmail');
            expect(mockElasticsearchService.countDocuments).toHaveBeenCalledWith('slack');
            expect(result.sources).toHaveLength(2);
            expect(result.total).toBe(100);
        });
    });

    describe('listDocuments', () => {
        it('should filter sources to enabled only when no sources specified', async () => {
            mockSettingsService.getEnabledSources.mockResolvedValue(['gmail']);
            mockElasticsearchService.listDocuments.mockResolvedValue({ results: [], total: 0 });

            await controller.listDocuments();

            expect(mockElasticsearchService.listDocuments).toHaveBeenCalledTimes(1);
            expect(mockElasticsearchService.listDocuments).toHaveBeenCalledWith('gmail', expect.any(Object));
        });

        it('should filter requested sources to enabled only', async () => {
            mockSettingsService.getEnabledSources.mockResolvedValue(['gmail', 'slack']);
            mockElasticsearchService.listDocuments.mockResolvedValue({ results: [], total: 0 });

            await controller.listDocuments('gmail,jira,calendar');

            expect(mockElasticsearchService.listDocuments).toHaveBeenCalledTimes(1);
            expect(mockElasticsearchService.listDocuments).toHaveBeenCalledWith('gmail', expect.any(Object));
        });
    });
});
