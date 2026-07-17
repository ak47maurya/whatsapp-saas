import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from '../config/index.js';

export const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

export const globalRateLimiter = rateLimit({
  windowMs: config.rateLimit.window,
  max: config.rateLimit.max,
  message: {
    success: false,
    message: 'Too many requests, please try again later',
  },
  skip: (req) => req.user?.role === 'super_admin' || req.user?.role === 'admin',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: 'Too many login attempts, please try again after 15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: {
    success: false,
    message: 'API rate limit exceeded',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

export const xssProtection = (req, res, next) => {
  const sanitize = (value) => {
    if (typeof value === 'string') {
      return value.replace(/[<>"']/g, '');
    }
    return value;
  };

  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitize(req.body[key]);
      }
    });
  }

  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = sanitize(req.query[key]);
      }
    });
  }

  next();
};
