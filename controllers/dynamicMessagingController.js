import DynamicMessaging from '../models/DynamicMessaging.js';
import Instance from '../models/Instance.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { startDynamicSend, cancelDynamicSend, isDynamicActive } from '../services/dynamicMessagingSender.js';
import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';

export const index = async (req, res) => {
  try {
    const messages = await DynamicMessaging.find({ user: req.userId }).populate('instance', 'name phone').sort('-createdAt');
    const instances = await Instance.find({ user: req.userId, status: 'connected' }).select('name phone').lean();
    res.render('dynamic/index', { title: 'Dynamic Messaging', activePage: 'dynamic-messaging', messages, instances });
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const create = async (req, res) => {
  try {
    const { name, template, instance, delayType, fixedDelay, minDelay, maxDelay } = req.body;
    if (!name || !template) return errorResponse(res, 'Name and template are required');
    const delay = {
      type: delayType === 'random' ? 'random' : 'fixed',
      value: parseInt(fixedDelay) || 2000,
      min: parseInt(minDelay) || 1000,
      max: parseInt(maxDelay) || 5000,
    };
    const msg = await DynamicMessaging.create({ user: req.userId, name, template, instance, delay, status: 'draft' });
    successResponse(res, { dynamicMessaging: msg }, 'Template created');
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const duplicate = async (req, res) => {
  try {
    const dm = await DynamicMessaging.findOne({ _id: req.params.id, user: req.userId });
    if (!dm) return errorResponse(res, 'Template not found', 404);
    const copy = await DynamicMessaging.create({
      user: req.userId,
      name: dm.name + ' (copy)',
      template: dm.template,
      instance: dm.instance,
      delay: { ...dm.delay },
      status: 'draft',
    });
    successResponse(res, { dynamicMessaging: copy }, 'Template duplicated');
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const remove = async (req, res) => {
  try {
    const msg = await DynamicMessaging.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!msg) return errorResponse(res, 'Template not found', 404);
    if (msg.filePath && fs.existsSync(msg.filePath)) fs.unlinkSync(msg.filePath);
    successResponse(res, null, 'Deleted');
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const uploadContacts = async (req, res) => {
  try {
    const dm = await DynamicMessaging.findOne({ _id: req.params.id, user: req.userId });
    if (!dm) return errorResponse(res, 'Template not found', 404);
    if (dm.status !== 'draft') return errorResponse(res, 'Cannot modify contacts after sending', 400);
    if (!req.file) return errorResponse(res, 'Excel file required', 400);

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) return errorResponse(res, 'Excel file is empty', 400);

    // Extract variable names from template {{varName}}
    const varRegex = /\{\{(\w+)\}\}/g;
    const templateVars = new Set();
    let m;
    while ((m = varRegex.exec(dm.template)) !== null) templateVars.add(m[1]);

    // Map rows to contacts: first column header containing 'phone'/'mobile'/'contact' = phone, rest = variables
    const headers = Object.keys(rows[0]);
    const phoneKey = headers.find(h => /phone|mobile|contact|number/i.test(h)) || headers[0];

    const contacts = rows.map((row, i) => {
      const phone = String(row[phoneKey] || '').replace(/[^0-9]/g, '');
      const variables = {};
      for (const key of headers) {
        if (key === phoneKey) continue;
        variables[key] = String(row[key]);
      }
      return { phone, variables, status: 'pending' };
    }).filter(c => c.phone.length >= 8);

    if (!contacts.length) return errorResponse(res, 'No valid phone numbers found', 400);

    dm.contacts = contacts;
    dm.totalContacts = contacts.length;
    dm.sentCount = 0;
    dm.failedCount = 0;
    dm.filePath = req.file.path;
    await dm.save();

    successResponse(res, { total: contacts.length, templateVars: [...templateVars] }, `${contacts.length} contacts loaded`);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const preview = async (req, res) => {
  try {
    const dm = await DynamicMessaging.findOne({ _id: req.params.id, user: req.userId }).populate('instance', 'name phone');
    if (!dm) return errorResponse(res, 'Template not found', 404);

    const varRegex = /\{\{(\w+)\}\}/g;
    const templateVars = new Set();
    let m;
    while ((m = varRegex.exec(dm.template)) !== null) templateVars.add(m[1]);

    const previews = dm.contacts.slice(0, 50).map(c => {
      let text = dm.template;
      for (const key of templateVars) {
        text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), c.variables?.[key] || '');
      }
      return { phone: c.phone, preview: text };
    });

    successResponse(res, {
      dm,
      templateVars: [...templateVars],
      totalContacts: dm.contacts.length,
      previews,
      active: isDynamicActive(dm._id),
    });
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const send = async (req, res) => {
  try {
    const dm = await DynamicMessaging.findOne({ _id: req.params.id, user: req.userId });
    if (!dm) return errorResponse(res, 'Template not found', 404);
    if (dm.status !== 'draft') return errorResponse(res, 'Already sent or processing', 400);
    if (!dm.contacts || dm.contacts.length === 0) return errorResponse(res, 'Upload contacts first', 400);
    if (!dm.instance) return errorResponse(res, 'No instance assigned', 400);

    dm.status = 'pending';
    await dm.save();

    startDynamicSend(dm._id);
    successResponse(res, { dmId: dm._id }, `Sending to ${dm.contacts.length} contacts`);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const cancel = async (req, res) => {
  try {
    const dm = await DynamicMessaging.findOne({ _id: req.params.id, user: req.userId });
    if (!dm) return errorResponse(res, 'Template not found', 404);
    if (dm.status === 'completed' || dm.status === 'draft') return errorResponse(res, 'Nothing to cancel', 400);

    cancelDynamicSend(dm._id);
    dm.status = 'cancelled';
    await dm.save();

    successResponse(res, null, 'Sending cancelled');
  } catch (err) {
    errorResponse(res, err.message);
  }
};
