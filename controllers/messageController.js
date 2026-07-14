import Message from '../models/Message.js';
import BulkMessage from '../models/BulkMessage.js';
import Instance from '../models/Instance.js';
import Contact from '../models/Contact.js';
import Subscription from '../models/Subscription.js';
import logger from '../utils/logger.js';
import { whatsappService, mediaStorage } from '../services/index.js';
import { startBulkSend, cancelBulkSend, isBulkActive } from '../services/bulkMessageSender.js';
import { cancelQueued, enqueueRetry, enqueueMessage } from '../services/messageQueue.js';
import ActivityLog from '../models/ActivityLog.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { checkDailyMessageLimit, checkMonthlyMessageLimit } from '../middlewares/features.js';
import config from '../config/index.js';

export const index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const { instanceId, status, search, direction } = req.query;

    const filter = { user: req.userId };
    if (instanceId) filter.instance = instanceId;
    if (status) filter.status = status;
    if (direction) filter.direction = direction;
    if (search) {
      filter.$or = [
        { to: { $regex: search, $options: 'i' } },
        { from: { $regex: search, $options: 'i' } },
        { 'content.text': { $regex: search, $options: 'i' } },
      ];
    }

    const [messages, total] = await Promise.all([
      Message.find(filter)
        .populate('instance', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Message.countDocuments(filter),
    ]);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return paginatedResponse(res, messages, total, page, limit);
    }

    const instances = await Instance.find({ user: req.userId, isDeleted: false });

    res.render('message/index', {
      title: 'Messages',
      messages,
      instances,
      total,
      page,
      limit,
      filters: { instanceId, status, search, direction },
      activePage: 'messages',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const sendSingle = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      const daily = await checkDailyMessageLimit(req.userId);
      if (!daily.allowed) return errorResponse(res, daily.reason, 429);
      const monthly = await checkMonthlyMessageLimit(req.userId);
      if (!monthly.allowed) return errorResponse(res, monthly.reason, 429);
    }

    const { instanceId, to, type, text, latitude, longitude, contactName, contactPhone } = req.body;
    let { mediaUrl, fileName, mimeType } = req.body;
    // FormData sends hidden fields too, causing arrays. Take first non-empty value.
    let caption = req.body.caption;
    if (Array.isArray(caption)) caption = caption.find(v => v) || caption[0];

    if (!instanceId) return errorResponse(res, 'Instance ID is required', 400);
    if (!to) return errorResponse(res, 'Recipient phone is required', 400);

    // Handle file upload — pass file path for direct buffer read
    let mediaPath = null;
    if (req.files?.media) {
      const file = req.files.media[0];
      mediaPath = file.path;
      mediaUrl = config.app.url + '/uploads/' + file.filename;
      fileName = fileName || file.originalname;
      mimeType = mimeType || file.mimetype;
    }

    // Ensure absolute URL for Baileys (only if mediaPath not set)
    if (!mediaPath && mediaUrl && mediaUrl.startsWith('/')) {
      mediaUrl = config.app.url + mediaUrl;
    }

    const instance = await Instance.findOne({
      _id: instanceId,
      user: req.userId,
      isDeleted: false,
      status: 'connected',
    });

    if (!instance) return errorResponse(res, 'Instance not found or not connected', 404);

    const content = { text, caption, mediaUrl, mediaPath, fileName, mimeType, latitude, longitude, contactName, contactPhone };

    const result = await whatsappService.sendMessage(instanceId, to, content, type || 'text');

    const message = await Message.create({
      user: req.userId,
      instance: instanceId,
      messageType: type || 'text',
      direction: 'outgoing',
      from: instance.phone || '',
      to,
      content,
      status: 'sent',
      sentAt: new Date(),
      metadata: { keyId: result?.message?.key?.id },
    });

    // Save outgoing media to file system
    if (type !== 'text' && mediaPath) {
      try {
        const fs = await import('fs/promises');
        const buf = await fs.readFile(mediaPath);
        await mediaStorage.saveMedia({
          userId: req.userId,
          instanceId,
          messageId: message._id,
          direction: 'outgoing',
          mediaType: type,
          mimeType: mimeType || '',
          buffer: buf,
          fileName: fileName || '',
          caption: caption || '',
          from: instance.phone || '',
          to,
        });
      } catch (err) {
        logger.error('Media save error:', err);
      }
    }

    if (!to.includes('@g.us')) {
      await Contact.findOneAndUpdate(
        { user: req.userId, phone: to },
        { $set: { lastMessageAt: new Date() }, $inc: { messageCount: 1 } },
        { upsert: true }
      );
    }

    await ActivityLog.create({
      user: req.userId,
      action: 'message.send',
      category: 'message',
      description: `Sent ${type || 'text'} message to ${to}`,
    });

    successResponse(res, { message }, 'Message sent');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const bulkPage = async (req, res) => {
  try {
    const instances = await Instance.find({ user: req.userId, isDeleted: false, status: 'connected' });
    res.render('message/bulk', { title: 'Bulk Messages', instances, activePage: 'bulk' });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const sendBulk = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      const daily = await checkDailyMessageLimit(req.userId);
      if (!daily.allowed) return errorResponse(res, daily.reason, 429);
      const monthly = await checkMonthlyMessageLimit(req.userId);
      if (!monthly.allowed) return errorResponse(res, monthly.reason, 429);
    }

    const { instanceId, recipients, type, text, caption, delayType, fixedDelay, minDelay, maxDelay } = req.body;
    let { mediaUrl } = req.body;
    let mediaPath = null;
    if (req.files?.media) {
      const file = req.files.media[0];
      mediaPath = file.path;
      mediaUrl = config.app.url + '/uploads/' + file.filename;
    }

    const instance = await Instance.findOne({
      _id: instanceId,
      user: req.userId,
      isDeleted: false,
    });

    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const sock = whatsappService.getSocket(instanceId);
    if (!sock) return errorResponse(res, 'Instance not connected. Please reconnect via QR scan.', 400);

    // Normalize recipients
    const normalizedRecipients = recipients.map(r => typeof r === 'string' ? { phone: r } : r);

    const delay = delayType === 'random'
      ? Math.floor(Math.random() * ((parseInt(maxDelay) || 5000) - (parseInt(minDelay) || 1000) + 1)) + (parseInt(minDelay) || 1000)
      : parseInt(fixedDelay) || 2000;

    const content = { text, caption, mediaUrl, mediaPath };

    // Create bulk doc with all recipients
    const bulk = await BulkMessage.create({
      user: req.userId,
      instance: instanceId,
      messageType: type || 'text',
      content,
      delay,
      totalRecipients: normalizedRecipients.length,
      pendingCount: normalizedRecipients.length,
      recipients: normalizedRecipients.map(r => ({ phone: r.phone, status: 'pending' })),
    });

    // Start async processing
    startBulkSend(bulk._id);

    successResponse(res, { bulkId: bulk._id }, `Bulk queued — ${normalizedRecipients.length} recipients`);
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const getHistory = async (req, res) => {
  try {
    const { contact } = req.query;
    const filter = { user: req.userId };

    if (contact) {
      filter.$or = [{ to: contact }, { from: contact }];
    }

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('instance', 'name');

    successResponse(res, { messages });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const bulkList = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { user: req.userId };
    const [bulks, total] = await Promise.all([
      BulkMessage.find(filter)
        .populate('instance', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      BulkMessage.countDocuments(filter),
    ]);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return paginatedResponse(res, bulks, total, page, limit);
    }

    const instances = await Instance.find({ user: req.userId, isDeleted: false, status: 'connected' });

    res.render('message/bulk-list', {
      title: 'Bulk History',
      bulks,
      instances,
      total,
      page,
      limit,
      activePage: 'bulk',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const bulkStatus = async (req, res) => {
  try {
    const bulk = await BulkMessage.findOne({ _id: req.params.id, user: req.userId }).populate('instance', 'name phone');
    if (!bulk) return errorResponse(res, 'Bulk not found', 404);

    successResponse(res, {
      bulk,
      active: isBulkActive(bulk._id),
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const bulkCancel = async (req, res) => {
  try {
    const bulk = await BulkMessage.findOne({ _id: req.params.id, user: req.userId });
    if (!bulk) return errorResponse(res, 'Bulk not found', 404);
    if (bulk.status === 'completed') return errorResponse(res, 'Bulk already completed', 400);

    cancelBulkSend(bulk._id);
    bulk.status = 'cancelled';
    bulk.pendingCount = bulk.recipients.filter(r => r.status === 'pending').length;
    await bulk.save();

    successResponse(res, null, 'Bulk cancelled');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const cancel = async (req, res) => {
  try {
    const msg = await Message.findOne({ _id: req.params.id, user: req.userId });
    if (!msg) return errorResponse(res, 'Message not found', 404);
    if (msg.status !== 'queued') return errorResponse(res, 'Only queued messages can be cancelled', 400);

    const removed = await cancelQueued(msg._id);
    if (!removed) {
      msg.status = 'cancelled';
      await msg.save();
    }

    await ActivityLog.create({ user: req.userId, action: 'message.cancel', category: 'message', description: `Cancelled queued message to ${msg.to}` });
    successResponse(res, null, 'Message cancelled');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const exportCSV = async (req, res) => {
  try {
    const { instanceId, status, search, direction } = req.query;
    const filter = { user: req.userId };
    if (instanceId) filter.instance = instanceId;
    if (status) filter.status = status;
    if (direction) filter.direction = direction;
    if (search) {
      filter.$or = [
        { to: { $regex: search, $options: 'i' } },
        { from: { $regex: search, $options: 'i' } },
        { 'content.text': { $regex: search, $options: 'i' } },
      ];
    }

    const messages = await Message.find(filter)
      .populate('instance', 'name phone')
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();

    const esc = v => (v || '').replace(/"/g, '""');
    const rows = [
      ['Date','Direction','From','To','Type','Message','Status'],
      ...messages.map(m => [
        new Date(m.createdAt).toISOString(),
        m.direction,
        esc(m.from?.split('@')[0] || m.from || ''),
        esc(m.to),
        m.messageType,
        esc(m.content?.text || m.content?.caption || ''),
        m.status,
      ]),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=messages.csv');
    res.send(rows.map(r => r.join(',')).join('\n'));
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const retry = async (req, res) => {
  try {
    const msg = await Message.findOne({ _id: req.params.id, user: req.userId });
    if (!msg) return errorResponse(res, 'Message not found', 404);
    if (!['failed', 'cancelled'].includes(msg.status)) return errorResponse(res, 'Only failed or cancelled messages can be retried', 400);

    msg.status = 'queued';
    msg.retryCount = (msg.retryCount || 0) + 1;
    msg.errorMessage = null;
    msg.failedAt = null;
    await msg.save();

    await enqueueRetry(msg);

    await ActivityLog.create({ user: req.userId, action: 'message.retry', category: 'message', description: `Retrying message to ${msg.to}` });
    successResponse(res, null, 'Message queued for retry');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};
