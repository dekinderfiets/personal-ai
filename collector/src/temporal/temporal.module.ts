import { Logger,Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigModule,ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';

import { createActivities } from './activities';
import { TemporalClientService } from './temporal-client.service';

@Module({
    imports: [ConfigModule],
    providers: [TemporalClientService],
    exports: [TemporalClientService],
})
export class TemporalModule implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(TemporalModule.name);
    private worker: any = null;
    private nativeConnection: any = null;

    constructor(
        private configService: ConfigService,
        private temporalClient: TemporalClientService,
        private moduleRef: ModuleRef,
    ) {}

    async onModuleInit() {
        const address = this.configService.get<string>('temporal.address');
        if (!address) {
            throw new Error('TEMPORAL_ADDRESS is required. Set it in your .env file.');
        }

        const taskQueue = this.configService.get<string>('temporal.taskQueue', 'collector-indexing');
        const namespace = this.configService.get<string>('temporal.namespace', 'default');

        const { Connection } = await import('@temporalio/client');
        const { NativeConnection, Worker } = await import('@temporalio/worker');

        // Lazily resolve services from the root module via ModuleRef
        const { IndexingService } = await import('../indexing/indexing.service');
        const { SettingsService } = await import('../indexing/settings.service');
        const { CursorService } = await import('../indexing/cursor.service');
        const { AnalyticsService } = await import('../indexing/analytics.service');

        const indexingService = this.moduleRef.get(IndexingService, { strict: false });
        const settingsService = this.moduleRef.get(SettingsService, { strict: false });
        const cursorService = this.moduleRef.get(CursorService, { strict: false });
        const analyticsService = this.moduleRef.get(AnalyticsService, { strict: false });

        // Connect the client
        const clientConnection = await Connection.connect({ address });
        await this.temporalClient.connect(clientConnection);

        // Connect the worker
        this.nativeConnection = await NativeConnection.connect({ address });

        const activities = createActivities({
            indexingService,
            settingsService,
            cursorService,
            analyticsService,
        });

        this.worker = await Worker.create({
            connection: this.nativeConnection,
            namespace,
            taskQueue,
            workflowsPath: require.resolve('./workflows'),
            activities,
        });

        // Run the worker in the background (non-blocking)
        this.worker.run().catch((err: Error) => {
            this.logger.error(`Temporal worker stopped unexpectedly: ${err.message}`, err.stack);
        });

        this.logger.log(`Temporal worker started on task queue "${taskQueue}" (namespace: ${namespace})`);
    }

    async onModuleDestroy() {
        if (this.worker) {
            this.logger.log('Shutting down Temporal worker...');
            this.worker.shutdown();
            this.worker = null;
        }
        if (this.nativeConnection) {
            await this.nativeConnection.close();
            this.nativeConnection = null;
        }
    }
}
