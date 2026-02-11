import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { existsSync } from 'fs';

import { RootController } from './controllers/root.controller';
import { HealthController } from './controllers/health.controller';
import { IndexController } from './controllers/index.controller';
import { SearchController } from './controllers/search.controller';
import { EventsController } from './controllers/events.controller';
import { AnalyticsController } from './controllers/analytics.controller';
import { WorkflowsController } from './controllers/workflows.controller';
import { CursorService } from './indexing/cursor.service';
import { IndexingService } from './indexing/indexing.service';
import { ChromaService } from './indexing/chroma.service';
import { JiraConnector } from './connectors/jira.connector';
import { SlackConnector } from './connectors/slack.connector';
import { GmailConnector } from './connectors/gmail.connector';
import { DriveConnector } from './connectors/drive.connector';
import { ConfluenceConnector } from './connectors/confluence.connector';
import { CalendarConnector } from './connectors/calendar.connector';
import { GitHubConnector } from './connectors/github.connector';
import { GoogleAuthService } from './connectors/google-auth.service';
import { SettingsService } from './indexing/settings.service';
import { AnalyticsService } from './indexing/analytics.service';
import { ConnectorHealthService } from './indexing/health.service';
import { TemporalModule } from './temporal/temporal.module';
import {
    appConfig,
    redisConfig,
    jiraConfig,
    slackConfig,
    googleConfig,
    confluenceConfig,
    githubConfig,
    chromaConfig,
    temporalConfig,
    openaiConfig,
} from './config/config';
import { validate } from './config/validation';

import { FileSaverService } from './indexing/file-saver.service';

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
                githubConfig,
                chromaConfig,
                temporalConfig,
                openaiConfig,
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
        ChromaService,
        IndexingService,
        JiraConnector,
        SlackConnector,
        GmailConnector,
        DriveConnector,
        ConfluenceConnector,
        CalendarConnector,
        GitHubConnector,
        GoogleAuthService,
        AnalyticsService,
        ConnectorHealthService,
    ],
})
export class AppModule { }
