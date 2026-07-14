import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ENV = process.env.NODE_ENV || 'development';

const WEAK_SECRETS = ['session-secret', 'jwt-secret', 'your-super-secret-session-key-change-this', 'your-super-secret-jwt-key-change-this'];
const sessionSecret = process.env.SESSION_SECRET || 'session-secret';
const jwtSecret = process.env.JWT_SECRET || 'jwt-secret';

if (ENV === 'production') {
  const missing = [];
  if (WEAK_SECRETS.includes(sessionSecret)) missing.push('SESSION_SECRET');
  if (WEAK_SECRETS.includes(jwtSecret)) missing.push('JWT_SECRET');
  if (missing.length > 0) {
    console.error(`FATAL: ${missing.join(' and ')} must be set to a strong random value in production`);
    process.exit(1);
  }
}

const config = {
  env: ENV,
  port: parseInt(process.env.PORT, 10) || 3002,
  host: process.env.HOST || '0.0.0.0',

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-saas',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB, 10) || 0,
  },

  session: {
    secret: sessionSecret,
    maxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 86400000,
  },

  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'noreply@whatsappsaas.com',
  },

  app: {
    name: process.env.APP_NAME || 'WhatsApp SaaS',
    url: process.env.APP_URL || 'http://localhost:3002',
    logo: process.env.APP_LOGO || '/images/logo.png',
  },

  upload: {
    dir: process.env.UPLOAD_DIR || 'public/uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 52428800,
  },

  queue: {
    prefix: process.env.QUEUE_PREFIX || 'wa-saas',
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY, 10) || 5,
  },

  rateLimit: {
    window: parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 500,
  },

  baileys: {
    authDir: process.env.BAILEYS_AUTH_DIR || 'auth_info',
    syncFullHistory: process.env.BAILEYS_SYNC_FULL_HISTORY === 'true',
    markReadOnSend: process.env.BAILEYS_MARK_READ_ON_SEND === 'true',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
  },

  trial: {
    days: parseInt(process.env.TRIAL_DAYS, 10) || 7,
    messageLimit: parseInt(process.env.TRIAL_MESSAGE_LIMIT, 10) || 50,
  },

  admin: {
    email: process.env.ADMIN_EMAIL || 'anoopdiploma@gmail.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@123456',
    name: process.env.ADMIN_NAME || 'Super Admin',
  },

  get rootDir() {
    return path.join(__dirname, '..');
  },
};

export default config;
