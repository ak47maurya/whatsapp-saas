import ApiKey from '../models/ApiKey.js';
import { successResponse, errorResponse } from '../utils/response.js';
import crypto from 'crypto';

export const index = async (req, res) => {
  try {
    const apiKeys = await ApiKey.find({ user: req.userId }).sort({ createdAt: -1 });

    res.render('api/index', {
      title: 'API Keys',
      apiKeys,
      activePage: 'api',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const create = async (req, res) => {
  try {
    const { name, permissions } = req.body;

    const apiKey = await ApiKey.create({
      user: req.userId,
      name,
      permissions: permissions || ['send_message', 'read_instances'],
    });

    successResponse(res, { apiKey }, 'API key created', 201);
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};

export const remove = async (req, res) => {
  try {
    const apiKey = await ApiKey.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!apiKey) return errorResponse(res, 'API key not found', 404);
    successResponse(res, null, 'API key deleted');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const regenerate = async (req, res) => {
  try {
    const apiKey = await ApiKey.findOne({ _id: req.params.id, user: req.userId });
    if (!apiKey) return errorResponse(res, 'API key not found', 404);

    apiKey.key = `wa_${crypto.randomBytes(32).toString('hex')}`;
    await apiKey.save();

    successResponse(res, { apiKey }, 'API key regenerated');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const showDocs = (req, res) => {
  res.render('api/docs', {
    title: 'API Documentation',
    activePage: 'api-docs',
  });
};
