import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { HealthController } from './controllers/health.controller';
import { IndexController } from './controllers/index.controller';
import { CursorService } from './indexing/cursor.service';
import { IndexingService } from './indexing/indexing.service';
import { JiraConnector } from './connectors/jira.connector';
import { SlackConnector } from './connectors/slack.connector';
import { GmailConnector } from './connectors/gmail.connector';
import { DriveConnector } from './connectors/drive.connector';
import { ConfluenceConnector } from './connectors/confluence.connector';
import { CalendarConnector } from './connectors/calendar.connector';
import { GoogleAuthService } from './connectors/google-auth.service';
import { SettingsService } from './indexing/settings.service';
import {
    appConfig,
    redisConfig,
    jiraConfig,
    slackConfig,
    googleConfig,
    confluenceConfig,
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
            ],
        }),
        ServeStaticModule.forRoot({
            rootPath: join(__dirname, '..', 'public'), // Path to the built UI files
            exclude: ['/api/:splat(.*)'], // Exclude API routes from static serving (Express 5 safe)
        }),
    ],
    controllers: [HealthController, IndexController],
    providers: [
        CursorService,
        SettingsService,
        FileSaverService,
        IndexingService,
        JiraConnector,
        SlackConnector,
        GmailConnector,
        DriveConnector,
        ConfluenceConnector,
        CalendarConnector,
        GoogleAuthService,
    ],
})
export class AppModule { }