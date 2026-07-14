import DynamicMessaging from '../models/DynamicMessaging.js';
import Message from '../models/Message.js';
import ActivityLog from '../models/ActivityLog.js';
import { getSocket, sendMessage } from './whatsappService.js';
import logger from '../utils/logger.js';

const activeSenders = new Map();

export const startDynamicSend = async (dmId) => {
  if (activeSenders.has(dmId)) return;
  const controller = new AbortController();
  activeSenders.set(dmId, controller);
  processSend(dmId, controller.signal).finally(() => {
    if (activeSenders.get(dmId) === controller) activeSenders.delete(dmId);
  });
};

export const cancelDynamicSend = (dmId) => {
  const controller = activeSenders.get(dmId);
  if (controller) { controller.abort(); activeSenders.delete(dmId); }
};

export const isDynamicActive = (dmId) => activeSenders.has(dmId);

function fillTemplate(template, variables) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] !== undefined ? variables[key] : `{{${key}}}`);
}

async function processSend(dmId, signal) {
  try {
    const dm = await DynamicMessaging.findById(dmId);
    if (!dm || dm.status === 'cancelled' || dm.status === 'completed') return;

    dm.status = 'processing';
    await dm.save();

    const sock = getSocket(String(dm.instance));
    if (!sock) {
      dm.status = 'cancelled';
      for (const c of dm.contacts) {
        if (c.status === 'pending') { c.status = 'failed'; c.error = 'Instance not connected'; }
      }
      dm.failedCount = dm.contacts.filter(c => c.status === 'failed').length;
      await dm.save();
      return;
    }

    const ownPhone = sock.authState?.creds?.me?.id?.split(':')[0]?.split('@')[0] || '';

    for (let i = 0; i < dm.contacts.length; i++) {
      const c = dm.contacts[i];
      if (c.status !== 'pending') continue;
      if (signal.aborted) break;

      try {
        const personalized = fillTemplate(dm.template, c.variables);
        const content = { text: personalized };

        const result = await sendMessage(String(dm.instance), c.phone, content, 'text');

        c.status = 'sent';
        c.sentAt = new Date();
        dm.sentCount = (dm.sentCount || 0) + 1;

        await Message.create({
          user: dm.user,
          instance: dm.instance,
          messageType: 'text',
          direction: 'outgoing',
          from: ownPhone,
          to: c.phone,
          content: { text: personalized },
          status: 'sent',
          sentAt: new Date(),
          metadata: { keyId: result?.message?.key?.id, dynamicMessaging: dmId },
        });
      } catch (err) {
        c.status = 'failed';
        c.error = err.message;
        dm.failedCount = (dm.failedCount || 0) + 1;
      }

      await dm.save();

      if (i < dm.contacts.length - 1) {
        let ms = (dm.delay && dm.delay.value) || 2000;
        if (dm.delay && dm.delay.type === 'random') {
          const min = dm.delay.min || 1000;
          const max = dm.delay.max || 5000;
          ms = Math.floor(Math.random() * (max - min + 1)) + min;
        }
        await new Promise(resolve => setTimeout(resolve, ms));
      }
    }

    const pending = dm.contacts.filter(c => c.status === 'pending').length;
    dm.status = pending === 0 ? 'completed' : 'cancelled';
    await dm.save();

    await ActivityLog.create({
      user: dm.user,
      action: 'dynamic_messaging.send',
      category: 'message',
      description: `Dynamic "${dm.name}": ${dm.sentCount} sent, ${dm.failedCount} failed`,
    });
  } catch (err) {
    logger.error(`Dynamic send error ${dmId}: ${err.message}`);
    try { await DynamicMessaging.findByIdAndUpdate(dmId, { status: 'cancelled' }); } catch {}
  }
}
