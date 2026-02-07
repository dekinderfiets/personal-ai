interface Logger {
  info: (message: string) => void;
  error: (message: string, error?: Error) => void;
}

interface GracefulShutdownOptions {
  logger: Logger;
  closers: Array<() => Promise<void> | void>;
}

export function registerGracefulShutdown(options: GracefulShutdownOptions): void {
  const { logger, closers } = options;

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      // Run all closers in parallel
      await Promise.all(closers.map(closer => closer()));
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', error as Error);
      process.exit(1);
    }
  };

  // Handle common termination signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', reason as Error);
    shutdown('unhandledRejection');
  });
}
