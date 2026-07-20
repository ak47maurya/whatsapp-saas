process.env.TZ = 'Asia/Kolkata';

import dns from 'dns';

const origLookup = dns.lookup;
dns.lookup = (hostname, opts, cb) => {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  else if (typeof opts === 'number') { opts = { family: opts }; }
  if (hostname.endsWith('.cloudflare-dns.com')) return origLookup(hostname, opts, cb);
  const family = opts?.family || 0;
  const doh = async () => {
    if (family !== 6) {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      const a = d?.Answer?.find(x => x.type === 1);
      if (a) return cb(null, a.data, 4);
    }
    if (family !== 4) {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=AAAA`, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      const a = d?.Answer?.find(x => x.type === 28);
      if (a) return cb(null, a.data, 6);
    }
    origLookup(hostname, opts, cb);
  };
  doh().catch(e => origLookup(hostname, opts, cb));
};

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
