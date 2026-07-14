import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logDir = path.join(config.rootDir, config.logging.dir);

const transport = pino.transport({
  targets: [
    {
      target: 'pino/file',
      options: { destination: path.join(logDir, 'app.log'), mkdir: true },
      level: config.logging.level,
    },
    {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
      },
      level: config.logging.level,
    },
  ],
});

const logger = pino(
  {
    level: config.logging.level,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password'],
  },
  transport
);

export default logger;
