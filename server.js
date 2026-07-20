process.env.TZ = 'Asia/Kolkata';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

import http from 'http';
import app from './app.js';
import config from './config/index.js';
import connectDatabase from './config/database.js';
import { createRedisClient } from './config/redis.js';
import { initializeSocket } from './sockets/index.js';
import { resetStaleConnections, startHealthCheck } from './services/whatsappService.js';
import { initializeCronJobs } from './jobs/cron.js';
import { initMediaDir } from './services/mediaStorage.js';
import logger from './utils/logger.js';

const server = http.createServer(app);

const startServer = async () => {
  try {
    await connectDatabase();
    createRedisClient();
    initializeSocket(server);

    try {
      await resetStaleConnections();
    } catch (err) {
      logger.error('resetStaleConnections failed:', err);
    }

    await initMediaDir();
    startHealthCheck();
    initializeCronJobs();

    const PORT = config.port;
    const HOST = config.host;

    server.listen(PORT, HOST, () => {
      logger.info(`Server running on http://${HOST}:${PORT}`);
      logger.info(`Environment: ${config.env}`);
      logger.info(`App URL: ${config.app.url}`);
    });
  } catch (error) {
    logger.error('Server startup failed:', error);
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  console.error('UNCAUGHT EXCEPTION:', error?.stack || error);
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

startServer();
