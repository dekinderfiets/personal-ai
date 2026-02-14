import { Body, Controller, Get, HttpException, HttpStatus,Param, Post, Query, UseGuards } from '@nestjs/common';

import { ApiKeyGuard } from '../auth/api-key.guard';
import { ElasticsearchService } from '../indexing/elasticsearch.service';
import { IndexingService } from '../indexing/indexing.service';
import { BulkDeleteRequest, BulkDeleteResponse, DataSource, DocumentStats,SearchRequest, SearchResult } from '../types';

const ALL_SOURCES: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'];

@Controller('search')
@UseGuards(ApiKeyGuard)
export class SearchController {
    constructor(
        private elasticsearchService: ElasticsearchService,
        private indexingService: IndexingService,
    ) {}

    @Post()
    async search(@Body() body: SearchRequest): Promise<{ results: SearchResult[]; total: number }> {
        return this.elasticsearchService.search(body.query, {
            sources: body.sources,
            searchType: body.searchType,
            limit: body.limit,
            offset: body.offset,
            where: body.where,
            startDate: body.startDate,
            endDate: body.endDate,
        });
    }


    // --- Documents endpoints (must be before documents/:id) ---

    @Get('documents/stats')
    async documentStats(): Promise<DocumentStats> {
        const counts = await Promise.all(
            ALL_SOURCES.map(async (source) => ({
                source,
                count: await this.elasticsearchService.countDocuments(source),
            })),
        );
        return {
            sources: counts,
            total: counts.reduce((sum, c) => sum + c.count, 0),
        };
    }

    @Post('documents/delete')
    async bulkDelete(@Body() body: BulkDeleteRequest): Promise<BulkDeleteResponse> {
        let deleted = 0;
        const errors: Array<{ id: string; error: string }> = [];

        for (const item of body.ids) {
            try {
                if (!ALL_SOURCES.includes(item.source)) {
                    errors.push({ id: item.id, error: `Invalid source: ${item.source}` });
                    continue;
                }
                await this.indexingService.deleteDocument(item.source, item.id);
                deleted++;
            } catch (error) {
                errors.push({ id: item.id, error: (error as Error).message });
            }
        }

        return { deleted, errors };
    }

    @Get('documents')
    async listDocuments(
        @Query('sources') sourcesParam?: string,
        @Query('limit') limitParam?: string,
        @Query('offset') offsetParam?: string,
        @Query('where') whereParam?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ): Promise<{ results: SearchResult[]; total: number }> {
        const limit = limitParam ? parseInt(limitParam, 10) : 20;
        const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
        const sources: DataSource[] = sourcesParam
            ? (sourcesParam.split(',').filter(s => ALL_SOURCES.includes(s as DataSource)) as DataSource[])
            : ALL_SOURCES;

        let where: Record<string, unknown> | undefined;
        if (whereParam) {
            try {
                where = JSON.parse(whereParam);
            } catch {
                // Ignore invalid JSON
            }
        }

        // Query each source in parallel
        const sourceResults = await Promise.all(
            sources.map((source) =>
                this.elasticsearchService.listDocuments(source, { limit: limit + offset, offset: 0, where, startDate, endDate }),
            ),
        );

        // Merge and sort all results by updatedAtTs descending
        const allResults: SearchResult[] = sourceResults.flatMap((r) => r.results);
        allResults.sort((a, b) => {
            const aTs = (a.metadata.updatedAtTs as number) || (a.metadata.createdAtTs as number) || 0;
            const bTs = (b.metadata.updatedAtTs as number) || (b.metadata.createdAtTs as number) || 0;
            return bTs - aTs;
        });

        const total = sourceResults.reduce((sum, r) => sum + r.total, 0);

        return {
            results: allResults.slice(offset, offset + limit),
            total,
        };
    }

    @Get('documents/:id')
    async getDocument(@Param('id') id: string): Promise<SearchResult> {
        for (const source of ALL_SOURCES) {
            const doc = await this.elasticsearchService.getDocument(source, id);
            if (doc) return doc;
        }
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    }
}
