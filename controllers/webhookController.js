import Webhook from '../models/Webhook.js';
import Instance from '../models/Instance.js';
import { webhookService } from '../services/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import crypto from 'crypto';

export const index = async (req, res) => {
  try {
    const webhooks = await Webhook.find({ user: req.userId, isDeleted: false })
      .populate('instance', 'name phone')
      .sort({ createdAt: -1 });

    const instances = await Instance.find({ user: req.userId, isDeleted: false });

    res.render('webhook/index', {
      title: 'Webhooks',
      webhooks,
      instances,
      activePage: 'webhooks',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const create = async (req, res) => {
  try {
    const { name, url, events, instanceId, secret, retryCount, timeout } = req.body;

    const webhook = await Webhook.create({
      user: req.userId,
      instance: instanceId || null,
      name,
      url,
      events: Array.isArray(events) ? events : [events],
      secret: secret || null,
      retryCount: parseInt(retryCount) || 3,
      timeout: parseInt(timeout) || 5000,
    });

    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, { webhook }, 'Webhook created', 201);
    }
    res.redirect('/webhooks');
  } catch (error) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return errorResponse(res, error.message, 400);
    }
    res.redirect('/webhooks');
  }
};

export const update = async (req, res) => {
  try {
    const webhook = await Webhook.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!webhook) return errorResponse(res, 'Webhook not found', 404);
    successResponse(res, { webhook }, 'Webhook updated');
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};

export const remove = async (req, res) => {
  try {
    const webhook = await Webhook.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { isDeleted: true },
      { new: true }
    );
    if (!webhook) return errorResponse(res, 'Webhook not found', 404);
    successResponse(res, null, 'Webhook deleted');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const test = async (req, res) => {
  try {
    const { url, secret } = req.body;
    const result = await webhookService.testWebhook(url, secret);
    successResponse(res, result, 'Webhook tested');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const toggle = async (req, res) => {
  try {
    const webhook = await Webhook.findOne({ _id: req.params.id, user: req.userId });
    if (!webhook) return errorResponse(res, 'Webhook not found', 404);

    webhook.isActive = !webhook.isActive;
    await webhook.save();

    successResponse(res, { webhook }, `Webhook ${webhook.isActive ? 'activated' : 'deactivated'}`);
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};
