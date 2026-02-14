import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'fs';
import { join } from 'path';

import {
    appConfig,
    cohereConfig,
    confluenceConfig,
    elasticsearchConfig,
    googleConfig,
    jiraConfig,
    openaiConfig,
    redisConfig,
    slackConfig,
    temporalConfig,
} from './config/config';
import { validate } from './config/validation';
import { CalendarConnector } from './connectors/calendar.connector';
import { ConfluenceConnector } from './connectors/confluence.connector';
import { DriveConnector } from './connectors/drive.connector';
import { GmailConnector } from './connectors/gmail.connector';
import { GoogleAuthService } from './connectors/google-auth.service';
import { JiraConnector } from './connectors/jira.connector';
import { SlackConnector } from './connectors/slack.connector';
import { AnalyticsController } from './controllers/analytics.controller';
import { EventsController } from './controllers/events.controller';
import { HealthController } from './controllers/health.controller';
import { IndexController } from './controllers/index.controller';
import { RootController } from './controllers/root.controller';
import { SearchController } from './controllers/search.controller';
import { WorkflowsController } from './controllers/workflows.controller';
import { AnalyticsService } from './indexing/analytics.service';
import { ChunkingService } from './indexing/chunking.service';
import { CursorService } from './indexing/cursor.service';
import { ElasticsearchService } from './indexing/elasticsearch.service';
import { FileProcessorService } from './indexing/file-processor.service';
import { FileSaverService } from './indexing/file-saver.service';
import { ConnectorHealthService } from './indexing/health.service';
import { IndexingService } from './indexing/indexing.service';
import { SettingsService } from './indexing/settings.service';
import { TemporalModule } from './temporal/temporal.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate,
            load: [
                appConfig,
                redisConfig,
                jiraConfig,
                slackConfig,
                googleConfig,
                confluenceConfig,
                elasticsearchConfig,
                temporalConfig,
                openaiConfig,
                cohereConfig,
            ],
        }),
        ...(existsSync(join(__dirname, '..', 'public'))
            ? [ServeStaticModule.forRoot({
                rootPath: join(__dirname, '..', 'public'),
                exclude: ['/api/:splat(.*)'],
            })]
            : []),
        TemporalModule,
    ],
    controllers: [RootController, HealthController, IndexController, SearchController, EventsController, AnalyticsController, WorkflowsController],
    providers: [
        CursorService,
        SettingsService,
        FileSaverService,
        ElasticsearchService,
        ChunkingService,
        FileProcessorService,
        IndexingService,
        JiraConnector,
        SlackConnector,
        GmailConnector,
        DriveConnector,
        ConfluenceConnector,
        CalendarConnector,
        GoogleAuthService,
        AnalyticsService,
        ConnectorHealthService,
    ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS requires a module class
export class AppModule { }
