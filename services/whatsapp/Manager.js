import WhatsAppInstance from './Instance.js';
import logger from '../../utils/logger.js';

const instances = new Map();

export const getInstance = (instanceId) => {
  return instances.get(String(instanceId)) || null;
};

export const createInstance = (instanceId) => {
  const strId = String(instanceId);
  if (instances.has(strId)) return instances.get(strId);
  const inst = new WhatsAppInstance(instanceId);
  instances.set(strId, inst);
  return inst;
};

export const removeInstance = (instanceId) => {
  const strId = String(instanceId);
  instances.delete(strId);
};

export const getAllInstances = () => {
  return Array.from(instances.values());
};

export const getConnectionCount = () => instances.size;

export const startHealthCheck = () => {
  setInterval(() => {
    for (const [strId, inst] of instances.entries()) {
      try {
        if (inst._initLock || inst._reconnectTimer) continue;
        if (inst.sock && inst.sock.ws?.readyState !== 1) {
          logger.warn(`Health check: instance ${strId} socket dead, removing`);
          instances.delete(strId);
        }
      } catch {}
    }
  }, 60000);
};
