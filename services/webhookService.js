import crypto from 'crypto';
import Webhook from '../models/Webhook.js';
import logger from '../utils/logger.js';

export const triggerWebhook = async (userId, instanceId, event, payload) => {
  try {
    const webhooks = await Webhook.find({
      user: userId,
      instance: { $in: [instanceId, null] },
      events: event,
      isActive: true,
      isDeleted: false,
    });

    for (const webhook of webhooks) {
      const body = JSON.stringify({
        event,
        instanceId: String(instanceId),
        userId: String(userId),
        data: payload,
        timestamp: new Date().toISOString(),
      });

      const signature = webhook.secret
        ? crypto.createHmac('sha256', webhook.secret).update(body).digest('hex')
        : '';

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), webhook.timeout || 5000);

      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': event,
            'User-Agent': 'WhatsApp-SaaS-Webhook/1.0',
            ...webhook.headers,
          },
          body,
          signal: controller.signal,
        });

        webhook.lastTriggered = new Date();
        webhook.lastResponse = {
          statusCode: response.status,
          body: await response.text().catch(() => ''),
          triggeredAt: new Date(),
        };
        await webhook.save();

        logger.debug(`Webhook ${webhook.name} triggered for event ${event}: ${response.status}`);
      } catch (err) {
        logger.warn(`Webhook ${webhook.name} failed for event ${event}: ${err.message}`);

        webhook.lastTriggered = new Date();
        webhook.lastResponse = {
          statusCode: 0,
          body: err.message,
          triggeredAt: new Date(),
        };
        await webhook.save();
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch (error) {
    logger.error('Webhook trigger error:', error);
  }
};

export const testWebhook = async (url, secret = null) => {
  const body = JSON.stringify({
    event: 'webhook.test',
    data: { message: 'This is a test webhook from WhatsApp SaaS Platform' },
    timestamp: new Date().toISOString(),
  });

  const signature = secret
    ? crypto.createHmac('sha256', secret).update(body).digest('hex')
    : '';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Event': 'webhook.test',
      'User-Agent': 'WhatsApp-SaaS-Webhook/1.0',
    },
    body,
    signal: AbortSignal.timeout(10000),
  });

  return {
    statusCode: response.status,
    body: await response.text().catch(() => ''),
  };
};
