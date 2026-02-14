import { Controller, Query,Sse, UseGuards } from '@nestjs/common';
import { from, interval, map,Observable, startWith, switchMap } from 'rxjs';

import { ApiKeyGuard } from '../auth/api-key.guard';
import { IndexingService } from '../indexing/indexing.service';

interface MessageEvent {
    data: string | object;
    id?: string;
    type?: string;
    retry?: number;
}

@Controller('events')
@UseGuards(ApiKeyGuard)
export class EventsController {
    constructor(private indexingService: IndexingService) {}

    @Sse('indexing')
    indexingEvents(@Query('interval') pollInterval?: string): Observable<MessageEvent> {
        const ms = Math.max(parseInt(pollInterval || '2000', 10), 1000);

        return interval(ms).pipe(
            startWith(0),
            switchMap(() => from(this.indexingService.getAllStatus())),
            map((statuses) => ({
                data: JSON.stringify({
                    type: 'status_update',
                    statuses,
                    timestamp: new Date().toISOString(),
                }),
            })),
        );
    }
}
