import path from 'path';
import fs from 'fs/promises';
import config from '../config/index.js';
import Instance from '../models/Instance.js';
import logger from '../utils/logger.js';
import { getRedisClient } from '../config/redis.js';
import {
  createInstance, getInstance as getManagedInstance,
  removeInstance, getConnectionCount, startHealthCheck as managerHealthCheck,
} from './whatsapp/Manager.js';

export const getAuthPath = (instanceId) => {
  return path.join(config.rootDir, config.baileys.authDir, String(instanceId));
};

export const getConnectionKey = (instanceId) => {
  return `wa:connection:${instanceId}`;
};

export const generateQR = async (instanceId) => {
  const instance = createInstance(instanceId);
  return instance.init(true);
};

export const disconnectInstance = async (instanceId) => {
  const instance = getManagedInstance(instanceId);
  if (instance) {
    await instance.disconnect();
    removeInstance(instanceId);
  } else {
    const redis = getRedisClient();
    await redis.del(getConnectionKey(instanceId));
    await Instance.findByIdAndUpdate(instanceId, { status: 'disconnected', lastDisconnected: new Date() });
  }
};

export const logoutInstance = async (instanceId) => {
  const instance = getManagedInstance(instanceId);
  if (instance) {
    await instance.logout();
    removeInstance(instanceId);
  } else {
    const authPath = getAuthPath(instanceId);
    try { await fs.rm(authPath, { recursive: true, force: true }); } catch {}
    const redis = getRedisClient();
    await redis.del(getConnectionKey(instanceId));
    await Instance.findByIdAndUpdate(instanceId, {
      status: 'disconnected', authData: { creds: null, keys: null }, lastDisconnected: new Date(),
    });
  }
};

export const getSocket = (instanceId) => {
  const instance = getManagedInstance(instanceId);
  return instance?.sock || null;
};

export const resetStaleConnections = async () => {
  try {
    const staleInstances = await Instance.find({ status: 'connected', isDeleted: false });
    for (const inst of staleInstances) {
      const authPath = getAuthPath(String(inst._id));
      try {
        await fs.access(authPath);
        logger.info(`Auto-reconnecting instance ${inst._id}...`);
        generateQR(inst._id).catch(err => {
          logger.error(`Auto-reconnect failed for ${inst._id}: ${err.message}`);
          Instance.findByIdAndUpdate(inst._id, { status: 'disconnected', lastDisconnected: new Date() }).catch(() => {});
        });
        await new Promise(r => setTimeout(r, 3000));
      } catch {
        await Instance.findByIdAndUpdate(inst._id, { status: 'disconnected', lastDisconnected: new Date() });
        logger.info(`Marked stale instance ${inst._id} as disconnected (no auth data)`);
      }
    }
    if (staleInstances.length > 0) {
      logger.info(`Processed ${staleInstances.length} stale connection(s)`);
    }
  } catch (err) {
    logger.error('Failed to reset stale connections:', err);
  }
};

export const sendMessage = async (instanceId, to, content, type = 'text') => {
  let instance = getManagedInstance(instanceId);

  if (!instance || !instance.sock) {
    logger.info(`sendMessage: instance ${instanceId} socket dead, attempting reconnect...`);
    instance = createInstance(instanceId);
    try {
      await instance.init(false);
    } catch (err) {
      await Instance.findByIdAndUpdate(instanceId, { status: 'disconnected', lastDisconnected: new Date() });
      throw new Error(`Instance not connected. Reconnect failed: ${err.message}`);
    }
  }

  return instance.sendMessage(to, content, type);
};

export const getConnectionStatus = async (instanceId) => {
  const instance = getManagedInstance(instanceId);
  return instance ? instance.getConnectionStatus() : { connected: false, status: 'disconnected' };
};

export const getActiveConnectionCount = () => getConnectionCount();

export const startHealthCheck = () => {
  managerHealthCheck();
};
