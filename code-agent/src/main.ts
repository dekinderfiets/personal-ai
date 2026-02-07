import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { type INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { registerGracefulShutdown } from './shared';
import { AppModule } from './app.module';

let app: INestApplication | null = null;

async function bootstrap() {
  const logger = console;
  const port = parseInt(process.env.PORT || '8085', 10);

  app = await NestFactory.create(AppModule);

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Enable CORS
  app.enableCors();

  // No global prefix for OpenAI compatibility

  await app.listen(port);

  // Disable HTTP server timeouts to allow long-running requests
  const server = app.getHttpServer();
  server.timeout = 0; // Disable socket timeout
  server.keepAliveTimeout = 0; // Disable keep-alive timeout
  server.headersTimeout = 0; // Disable headers timeout
  server.requestTimeout = 0; // Disable request timeout (Node.js 18+)

  logger.log('Code Agent started', {
    port,
    workspaceRoot: process.env.WORKSPACE_ROOT,
  });
}

bootstrap();

registerGracefulShutdown({
  logger: {
    info: (message) => console.log(message),
    error: (message, error) => console.error(message, error),
  },
  closers: [
    async () => {
      if (app) {
        await app.close();
      }
    },
  ],
});