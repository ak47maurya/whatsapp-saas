import { Router } from 'express';
import ApiKey from '../models/ApiKey.js';
import Instance from '../models/Instance.js';
import Message from '../models/Message.js';
import { whatsappService } from '../services/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { apiRateLimiter } from '../middlewares/security.js';
import { enqueueMessage, enqueueBulk } from '../services/messageQueue.js';

const router = Router();

router.use(apiRateLimiter);

const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;

    if (!apiKey) {
      return errorResponse(res, 'API key is required', 401);
    }

    const key = await ApiKey.findOne({ key: apiKey, isActive: true });

    if (!key) {
      return errorResponse(res, 'Invalid API key', 401);
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      return errorResponse(res, 'API key has expired', 401);
    }

    key.lastUsed = new Date();
    key.usage.count += 1;
    await key.save();

    req.apiKey = key;
    req.userId = key.user;
    next();
  } catch (error) {
    errorResponse(res, 'Authentication failed', 401);
  }
};

const checkPermission = (permission) => {
  return (req, res, next) => {
    if (req.apiKey.permissions.includes(permission)) {
      return next();
    }
    return errorResponse(res, 'Insufficient permissions', 403);
  };
};

router.use(authenticateApiKey);

router.post('/send-message', checkPermission('send_message'), async (req, res) => {
  try {
    const { instanceId, to, type, text, caption, mediaUrl } = req.body;

    const instance = await Instance.findOne({
      _id: instanceId,
      user: req.userId,
      isDeleted: false,
    });

    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const message = await enqueueMessage({
      instanceId,
      userId: req.userId,
      to,
      content: { text, caption, mediaUrl },
      messageType: type || 'text',
    });

    successResponse(res, { message }, 'Message queued');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
});

router.post('/send-media', checkPermission('send_media'), async (req, res) => {
  try {
    const { instanceId, to, type, mediaUrl, caption, fileName, mimeType } = req.body;

    const instance = await Instance.findOne({
      _id: instanceId,
      user: req.userId,
      isDeleted: false,
    });

    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const message = await enqueueMessage({
      instanceId,
      userId: req.userId,
      to,
      content: { mediaUrl, caption, fileName, mimeType },
      messageType: type || 'image',
    });

    successResponse(res, { message }, 'Media queued');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
});

router.post('/send-group', checkPermission('send_message'), async (req, res) => {
  try {
    const { instanceId, groupJid, text, type, caption, mediaUrl } = req.body;

    const instance = await Instance.findOne({
      _id: instanceId,
      user: req.userId,
      isDeleted: false,
    });

    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const { enqueueMessage } = await import('../services/messageQueue.js');
    const message = await enqueueMessage({
      instanceId,
      userId: req.userId,
      to: groupJid,
      content: { text, caption, mediaUrl },
      messageType: type || 'text',
    });

    successResponse(res, { message }, 'Group message queued');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
});

router.post('/send-bulk', checkPermission('send_bulk'), async (req, res) => {
  try {
    const { instanceId, recipients, type, text, caption, mediaUrl, delay } = req.body;

    const instance = await Instance.findOne({
      _id: instanceId,
      user: req.userId,
      isDeleted: false,
    });

    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const msgIds = await enqueueBulk({
      instanceId,
      userId: req.userId,
      recipients,
      content: { text, caption, mediaUrl },
      messageType: type || 'text',
      delay: delay || 2000,
    });

    successResponse(res, { messageIds: msgIds }, `${msgIds.length} messages queued`);
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
});

router.get('/instance-status', checkPermission('read_instances'), async (req, res) => {
  try {
    const instances = await Instance.find({
      user: req.userId,
      isDeleted: false,
    }).select('name phone status lastConnected profile');

    const enriched = await Promise.all(instances.map(async (inst) => {
      const status = await whatsappService.getConnectionStatus(inst._id);
      return { ...inst.toJSON(), connection: status };
    }));

    successResponse(res, { instances: enriched });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
});

router.get('/message-history', checkPermission('read_messages'), async (req, res) => {
  try {
    const { instanceId, limit = 50, skip = 0 } = req.query;

    const filter = { user: req.userId };
    if (instanceId) filter.instance = instanceId;

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await Message.countDocuments(filter);

    successResponse(res, { messages, total, limit, skip });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
});

router.post('/create-campaign', checkPermission('create_campaign'), async (req, res) => {
  try {
    const { instanceId, name, type, text, recipients, scheduledAt } = req.body;

    const instance = await Instance.findOne({
      _id: instanceId,
      user: req.userId,
      isDeleted: false,
    });

    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const Campaign = (await import('../models/Campaign.js')).default;

    const campaign = await Campaign.create({
      user: req.userId,
      instance: instanceId,
      name,
      type: type || 'text',
      status: scheduledAt ? 'scheduled' : 'draft',
      messageContent: { text },
      recipients: recipients.map(r => ({ phone: r.phone || r, name: r.name || '' })),
      totalContacts: recipients.length,
      schedule: { scheduledAt: scheduledAt || null },
    });

    successResponse(res, { campaign }, 'Campaign created', 201);
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
});

router.get('/contacts', checkPermission('read_contacts'), async (req, res) => {
  try {
    const Contact = (await import('../models/Contact.js')).default;
    const { page = 1, limit = 20, search } = req.query;

    const filter = { user: req.userId, isDeleted: false };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const contacts = await Contact.find(filter)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Contact.countDocuments(filter);

    successResponse(res, { contacts, total, page, limit });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
});

router.get('/groups', checkPermission('read_contacts'), async (req, res) => {
  try {
    const Group = (await import('../models/Group.js')).default;
    const { instanceId, page = 1, limit = 20 } = req.query;

    const filter = { user: req.userId, isDeleted: false };
    if (instanceId) filter.instance = instanceId;

    const groups = await Group.find(filter)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ name: 1 });

    const total = await Group.countDocuments(filter);

    successResponse(res, { groups, total, page, limit });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
});

export default router;
