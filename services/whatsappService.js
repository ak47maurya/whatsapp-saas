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
  const instDoc = await Instance.findById(instanceId);
  if (instDoc && instDoc.status === 'connected') {
    const mgr = getManagedInstance(instanceId);
    if (mgr && mgr.sock && mgr.sock.ws?.readyState === 1) return instDoc;
  }
  const authPath = getAuthPath(instanceId);
  try { await fs.rm(authPath, { recursive: true, force: true }); } catch {}
  removeInstance(instanceId);
  const instance = createInstance(instanceId);
  await instance.init(true);
  return Instance.findById(instanceId);
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

export const ensureSocket = async (instanceId) => {
  const instance = getManagedInstance(instanceId);
  if (instance?.sock) return instance.sock;

  const instDoc = await Instance.findById(instanceId).select('status');
  if (!instDoc || instDoc.status !== 'connected') return null;

  const inst = createInstance(instanceId);
  try {
    await inst.init(false);
    return inst.sock;
  } catch (err) {
    logger.error(`ensureSocket failed for ${instanceId}: ${err.message}`);
    return null;
  }
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

  if (!instance) {
    throw new Error('Instance not connected. Reconnect manually from the web app.');
  }
  if (!instance.sock) {
    if (instance._reconnectTimer) {
      throw new Error('Instance is reconnecting. Please wait a moment and try again.');
    }
    throw new Error('Instance not connected. Reconnect manually from the web app.');
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
