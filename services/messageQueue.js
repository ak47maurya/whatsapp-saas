import Message from '../models/Message.js';
import Instance from '../models/Instance.js';
import ActivityLog from '../models/ActivityLog.js';
import { getSocket, sendMessage } from './whatsappService.js';
import { triggerWebhook } from './webhookService.js';
import logger from '../utils/logger.js';

const instanceQueues = new Map();

const getQueue = (instanceId) => {
  if (!instanceQueues.has(instanceId)) {
    instanceQueues.set(instanceId, { processing: false, queue: [], abort: null });
  }
  return instanceQueues.get(instanceId);
};

export const enqueueMessage = async ({ instanceId, userId, to, content, messageType = 'text', priority = 0 }) => {
  const inst = await Instance.findById(instanceId).select('name phone');
  if (!inst) throw new Error('Instance not found');

  const ownPhone = (() => {
    try {
      const sock = getSocket(String(instanceId));
      return sock?.authState?.creds?.me?.id?.split(':')[0]?.split('@')[0] || '';
    } catch { return ''; }
  })();

  const msg = await Message.create({
    user: userId,
    instance: instanceId,
    messageType,
    direction: 'outgoing',
    from: ownPhone || inst?.phone || '',
    to,
    content,
    status: 'queued',
  });

  const q = getQueue(String(instanceId));
  q.queue.push({ msgId: msg._id, instanceId, to, content, messageType, priority });
  q.queue.sort((a, b) => b.priority - a.priority);

  processNext(String(instanceId));

  return msg;
};

export const enqueueBulk = async ({ instanceId, userId, recipients, content, messageType = 'text', delay = 2000 }) => {
  const inst = await Instance.findById(instanceId).select('name phone');
  if (!inst) throw new Error('Instance not found');

  const ownPhone = (() => {
    try {
      const sock = getSocket(String(instanceId));
      return sock?.authState?.creds?.me?.id?.split(':')[0]?.split('@')[0] || '';
    } catch { return ''; }
  })();

  const msgIds = [];
  for (const r of recipients) {
    const msg = await Message.create({
      user: userId,
      instance: instanceId,
      messageType,
      direction: 'outgoing',
      from: ownPhone || inst?.phone || '',
      to: r.phone || r,
      content,
      status: 'queued',
    });
    msgIds.push(msg._id);
  }

  const q = getQueue(String(instanceId));
  msgIds.forEach((msgId, i) => {
    const r = recipients[i];
    q.queue.push({ msgId: String(msgId), instanceId, to: r.phone || r, content, messageType, delay });
  });

  if (!q.processing) processNext(String(instanceId));

  return msgIds;
};

async function getDelay(instanceId) {
  try {
    const inst = await Instance.findById(instanceId).select('settings').lean();
    const d = inst?.settings?.messageDelay;
    if (!d) return 2000;
    if (d.type === 'random') {
      const min = d.minDelay || 1000;
      const max = d.maxDelay || 5000;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    return d.fixedDelay || 2000;
  } catch {
    return 2000;
  }
}

async function processNext(instanceId) {
  const q = getQueue(instanceId);
  if (q.processing || q.queue.length === 0) return;

  q.processing = true;

  while (q.queue.length > 0) {
    const job = q.queue.shift();

    const delayMs = await getDelay(instanceId);
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      await sendMessage(instanceId, job.to, job.content, job.messageType);

      const sentMsg = await Message.findByIdAndUpdate(job.msgId, { status: 'sent', sentAt: new Date() }, { new: true });

      if (sentMsg) {
        triggerWebhook(sentMsg.user, instanceId, 'message.sent', sentMsg).catch(() => {});
      }
    } catch (err) {
      logger.error(`Queue send error [${instanceId} -> ${job.to}]: ${err.message}`);
      await Message.findByIdAndUpdate(job.msgId, { status: 'failed', errorMessage: err.message, failedAt: new Date() });
    }
  }

  q.processing = false;
}

export const getQueueStatus = (instanceId) => {
  const q = getQueue(instanceId);
  return { pending: q.queue.length, processing: q.processing };
};

export const cancelQueued = async (msgId) => {
  for (const [, q] of instanceQueues) {
    const idx = q.queue.findIndex(job => String(job.msgId) === String(msgId));
    if (idx !== -1) {
      q.queue.splice(idx, 1);
      await Message.findByIdAndUpdate(msgId, { status: 'cancelled' });
      return true;
    }
  }
  return false;
};

export const enqueueRetry = async (msg) => {
  const q = getQueue(String(msg.instance));
  q.queue.push({ msgId: msg._id, instanceId: msg.instance, to: msg.to, content: msg.content, messageType: msg.messageType, priority: 0 });
  if (!q.processing) processNext(String(msg.instance));
};

export default { enqueueMessage, enqueueBulk, getQueueStatus, cancelQueued, enqueueRetry };
