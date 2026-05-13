import { app } from './app';
import { config } from './config';
import { pool } from './config/database';
import { redis } from './config/redis';
import { logger } from './utils/logger';
import { startScheduler } from './jobs/scheduler';

const PORT = config.port;

async function bootstrap() {
  // Test DB connection
  try {
    await pool.query('SELECT 1');
    logger.info('✅ PostgreSQL connected');
  } catch (err) {
    logger.fatal({ err }, '❌ Failed to connect to PostgreSQL');
    process.exit(1);
  }

  // Connect Redis
  try {
    await redis.connect();
    logger.info('✅ Redis connected');
  } catch (err) {
    logger.fatal({ err }, '❌ Failed to connect to Redis');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    logger.info(`🚀 Staxz API running on port ${PORT} [${config.env}]`);
    logger.info(`   Base URL: http://localhost:${PORT}/api/${config.apiVersion}`);
  });

  // Start background jobs
  startScheduler();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await pool.end();
      await redis.quit();
      logger.info('Server closed');
      process.exit(0);
    });

    // Force exit after 10s if shutdown stalls
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled Promise Rejection');
  });
}

bootstrap();
