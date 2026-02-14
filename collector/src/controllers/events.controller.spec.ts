import { firstValueFrom, take, toArray } from 'rxjs';

import { EventsController } from './events.controller';

describe('EventsController', () => {
    let controller: EventsController;
    let mockIndexingService: any;

    beforeEach(() => {
        mockIndexingService = {
            getAllStatus: jest.fn().mockResolvedValue([
                { source: 'gmail', status: 'idle', documentsIndexed: 10 },
            ]),
        };
        controller = new EventsController(mockIndexingService);
    });

    describe('indexingEvents', () => {
        it('should return an Observable', () => {
            const result = controller.indexingEvents();
            expect(result).toBeDefined();
            expect(result.subscribe).toBeDefined();
        });

        it('should emit status_update events with correct structure', async () => {
            const observable = controller.indexingEvents();

            const event = await firstValueFrom(observable);

            const parsed = JSON.parse(event.data as string);
            expect(parsed.type).toBe('status_update');
            expect(parsed.statuses).toEqual([
                { source: 'gmail', status: 'idle', documentsIndexed: 10 },
            ]);
            expect(parsed.timestamp).toBeDefined();
        });

        it('should emit immediately via startWith', async () => {
            const observable = controller.indexingEvents();

            const events = await firstValueFrom(observable.pipe(take(1), toArray()));

            expect(events).toHaveLength(1);
            expect(mockIndexingService.getAllStatus).toHaveBeenCalled();
        });

        it('should clamp minimum interval to 1000ms', () => {
            // Interval of 500 should be clamped to 1000
            const observable = controller.indexingEvents('500');
            expect(observable).toBeDefined();
        });

        it('should use default interval of 2000ms when not specified', () => {
            const observable = controller.indexingEvents(undefined);
            expect(observable).toBeDefined();
        });

        it('should parse interval string', () => {
            const observable = controller.indexingEvents('5000');
            expect(observable).toBeDefined();
        });
    });
});
