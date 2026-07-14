import BulkMessage from '../models/BulkMessage.js';
import Message from '../models/Message.js';
import Instance from '../models/Instance.js';
import ActivityLog from '../models/ActivityLog.js';
import { getSocket, sendMessage } from './whatsappService.js';
import logger from '../utils/logger.js';

const activeSenders = new Map();

export const startBulkSend = async (bulkId) => {
  if (activeSenders.has(bulkId)) return;

  const controller = new AbortController();
  activeSenders.set(bulkId, controller);

  processBulk(bulkId, controller.signal).finally(() => {
    if (activeSenders.get(bulkId) === controller) {
      activeSenders.delete(bulkId);
    }
  });
};

export const cancelBulkSend = (bulkId) => {
  const controller = activeSenders.get(bulkId);
  if (controller) {
    controller.abort();
    activeSenders.delete(bulkId);
  }
};

export const isBulkActive = (bulkId) => {
  return activeSenders.has(bulkId);
};

async function processBulk(bulkId, signal) {
  try {
    const bulk = await BulkMessage.findById(bulkId);
    if (!bulk || bulk.status === 'cancelled') return;

    bulk.status = 'processing';
    await bulk.save();

    const sock = getSocket(String(bulk.instance));
    if (!sock) {
      bulk.status = 'cancelled';
      bulk.failedCount = bulk.pendingCount;
      bulk.pendingCount = 0;
      for (const r of bulk.recipients) {
        if (r.status === 'pending') {
          r.status = 'failed';
          r.error = 'Instance not connected';
        }
      }
      await bulk.save();
      return;
    }

    for (let i = 0; i < bulk.recipients.length; i++) {
      const r = bulk.recipients[i];
      if (r.status !== 'pending') continue;
      if (signal.aborted) {
        bulk.pendingCount = bulk.recipients.filter(x => x.status === 'pending').length;
        bulk.status = bulk.pendingCount === 0 ? 'completed' : 'cancelled';
        await bulk.save();
        return;
      }

      try {
        const result = await sendMessage(String(bulk.instance), r.phone, bulk.content, bulk.messageType);

        r.status = 'sent';
        r.sentAt = new Date();
        bulk.sentCount = (bulk.sentCount || 0) + 1;
        bulk.pendingCount = Math.max(0, (bulk.pendingCount || 0) - 1);

        const ownPhone = sock.authState?.creds?.me?.id?.split(':')[0]?.split('@')[0] || '';

        await Message.create({
          user: bulk.user,
          instance: bulk.instance,
          messageType: bulk.messageType || 'text',
          direction: 'outgoing',
          from: ownPhone,
          to: r.phone,
          content: bulk.content,
          status: 'sent',
          sentAt: new Date(),
          metadata: { keyId: result?.message?.key?.id, bulkId },
        });
      } catch (err) {
        r.status = 'failed';
        r.error = err.message;
        bulk.failedCount = (bulk.failedCount || 0) + 1;
        bulk.pendingCount = Math.max(0, (bulk.pendingCount || 0) - 1);
      }

      await bulk.save();

      if (i < bulk.recipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, bulk.delay || 2000));
      }
    }

    const remaining = bulk.recipients.filter(x => x.status === 'pending').length;
    bulk.pendingCount = remaining;
    bulk.status = remaining === 0 ? 'completed' : 'cancelled';
    await bulk.save();

    await ActivityLog.create({
      user: bulk.user,
      action: 'message.bulk',
      category: 'message',
      description: `Bulk send ${bulk._id}: ${bulk.sentCount} sent, ${bulk.failedCount} failed`,
    });
  } catch (err) {
    logger.error(`Bulk send error ${bulkId}: ${err.message}`);
    try {
      await BulkMessage.findByIdAndUpdate(bulkId, { status: 'cancelled' });
    } catch {}
  }
}
