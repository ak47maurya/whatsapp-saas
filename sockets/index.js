import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';

let io = null;

export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: config.env === 'production' ? config.app.url : '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
        || socket.handshake.query?.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await User.findById(decoded.id);

      if (!user || user.status !== 'active') {
        return next(new Error('Invalid user'));
      }

      socket.userId = String(user._id);
      socket.userRole = user.role;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    logger.info(`Socket connected: ${userId}`);

    socket.join(`user:${userId}`);

    if (['super_admin', 'admin'].includes(socket.userRole)) {
      socket.join('admin');
    }

    socket.on('subscribe:instance', (instanceId) => {
      socket.join(`instance:${instanceId}`);
    });

    socket.on('unsubscribe:instance', (instanceId) => {
      socket.leave(`instance:${instanceId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${userId}`);
    });
  });

  logger.info('Socket.IO initialized');
  return io;
};

export const getIO = () => io;

export default { initializeSocket, getIO };
