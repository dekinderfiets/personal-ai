import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const configService = app.get(ConfigService);
    const port = configService.get<number>('app.port') || 8087;
    const logger = new Logger('Bootstrap');

    // Enable CORS for all origins
    app.enableCors();

    // Set a global prefix for all routes
    app.setGlobalPrefix('api/v1');

    await app.listen(port);
    logger.log(`🚀 Indexing service is running on: http://localhost:${port}/api/v1`);
}

bootstrap();
