import { Controller, Post, Get, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ChromaService } from '../indexing/chroma.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DataSource, SearchRequest, SearchResult, NavigationResult } from '../types';

@Controller('search')
@UseGuards(ApiKeyGuard)
export class SearchController {
    constructor(private chromaService: ChromaService) {}

    @Post()
    async search(@Body() body: SearchRequest): Promise<{ results: SearchResult[]; total: number }> {
        return this.chromaService.search(body.query, {
            sources: body.sources,
            searchType: body.searchType,
            limit: body.limit,
            offset: body.offset,
            where: body.where,
            startDate: body.startDate,
            endDate: body.endDate,
        });
    }

    @Get('navigate/:documentId')
    async navigate(
        @Param('documentId') documentId: string,
        @Query('direction') direction: 'prev' | 'next' | 'siblings' | 'parent' | 'children' = 'next',
        @Query('scope') scope: 'chunk' | 'datapoint' | 'context' = 'datapoint',
        @Query('limit') limit?: string,
    ): Promise<NavigationResult> {
        return this.chromaService.navigate(
            documentId,
            direction,
            scope,
            limit ? parseInt(limit, 10) : 10,
        );
    }
}
