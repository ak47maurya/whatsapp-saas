import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import { errorResponse } from '../utils/response.js';

export const authenticate = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.session && req.session.token) {
      token = req.session.token;
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return errorResponse(res, 'Authentication required', 401);
      }
      return res.redirect('/auth/login');
    }

    const decoded = jwt.verify(token, config.jwt.secret);
    const user = await User.findById(decoded.id);

    if (!user) {
      return errorResponse(res, 'User not found', 401);
    }

    if (user.status !== 'active') {
      return errorResponse(res, 'Account is suspended or inactive', 403);
    }

    req.user = user;
    req.userId = user._id;
    req.token = token;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return errorResponse(res, 'Token expired, please login again', 401);
      }
      return res.redirect('/auth/login');
    }
    return errorResponse(res, 'Invalid token', 401);
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.session && req.session.token) {
      token = req.session.token;
    }

    if (token) {
      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await User.findById(decoded.id);
      if (user && user.status === 'active') {
        req.user = user;
        req.userId = user._id;
      }
    }
    } catch (err) {
      logger.error('Optional auth error:', err);
    } finally {
    next();
  }
};
