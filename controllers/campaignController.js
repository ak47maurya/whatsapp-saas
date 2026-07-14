import Campaign from '../models/Campaign.js';
import Message from '../models/Message.js';
import Instance from '../models/Instance.js';
import { sendMessage } from '../services/whatsappService.js';
import ActivityLog from '../models/ActivityLog.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { parseCSV } from '../utils/helpers.js';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

export const index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { status } = req.query;

    const filter = { user: req.userId, isDeleted: false };
    if (status) filter.status = status;

    const [campaigns, total] = await Promise.all([
      Campaign.find(filter)
        .populate('instance', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Campaign.countDocuments(filter),
    ]);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return paginatedResponse(res, campaigns, total, page, limit);
    }

    const instances = await Instance.find({ user: req.userId, isDeleted: false, status: 'connected' });

    res.render('campaign/index', {
      title: 'Campaigns',
      campaigns,
      instances,
      total,
      page,
      limit,
      filters: { status },
      activePage: 'campaigns',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const create = async (req, res) => {
  try {
    const {
      name, description, instanceId, type, text, caption,
      recipientType, scheduledAt, delayType, fixedDelay, minDelay, maxDelay,
    } = req.body;

    const files = req.files || {};
    let recipients = [];
    let recipientFile = null;

    const csvFile = files.file?.[0];
    if (csvFile) {
      recipientFile = {
        fileName: csvFile.filename,
        originalName: csvFile.originalname,
        path: csvFile.path,
        mimeType: csvFile.mimetype,
      };

      const content = await fs.readFile(csvFile.path, 'utf-8');
      recipients = parseCSV(content);
    }

    if (req.body.manualRecipients && typeof req.body.manualRecipients === 'string') {
      const lines = req.body.manualRecipients.split('\n').map(s => s.trim()).filter(Boolean);
      recipients = lines.map(phone => ({ phone: phone.replace(/[^0-9]/g, ''), name: '' }));
    }

    if (req.body.recipients && typeof req.body.recipients === 'string') {
      recipients = JSON.parse(req.body.recipients);
    }

    const msgType = type || 'text';

    const mediaFile = files.mediaFile?.[0];
    let messageContent = { text, caption: caption || '' };

    if (msgType !== 'text') {
      if (mediaFile) {
        messageContent.mediaPath = mediaFile.path;
        messageContent.fileName = mediaFile.originalname;
        messageContent.mimeType = mediaFile.mimetype;
      }
      if (req.body.mediaUrl) {
        messageContent.mediaUrl = req.body.mediaUrl;
      }
    }

    const campaign = await Campaign.create({
      user: req.userId,
      instance: instanceId,
      name,
      description,
      type: msgType,
      status: scheduledAt ? 'scheduled' : 'draft',
      messageContent,
      recipientType: recipientType || 'manual',
      recipientFile,
      recipients: recipients.map(r => ({ phone: r.phone || r.number, name: r.name || '' })),
      totalContacts: recipients.length,
      schedule: { scheduledAt: scheduledAt || null },
      delay: {
        type: delayType || 'fixed',
        fixedDelay: parseInt(fixedDelay) || 2000,
        minDelay: parseInt(minDelay) || 1000,
        maxDelay: parseInt(maxDelay) || 3000,
      },
    });

    await ActivityLog.create({
      user: req.userId,
      action: 'campaign.create',
      category: 'campaign',
      description: `Created campaign: ${name}`,
    });

    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, { campaign }, 'Campaign created', 201);
    }
    req.session.success = 'Campaign created successfully';
    res.redirect('/campaigns');
  } catch (error) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return errorResponse(res, error.message, 400);
    }
    req.session.error = error.message;
    res.redirect('/campaigns');
  }
};

const runningCampaigns = new Map();

export const start = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      user: req.userId,
      status: { $in: ['draft', 'scheduled', 'paused'] },
    });

    if (!campaign) {
      const totalCampaigns = await Campaign.countDocuments({ user: req.userId, isDeleted: false });
      return errorResponse(res, `Campaign not found (id:${req.params.id}, total:${totalCampaigns})`, 404);
    }

    campaign.status = 'running';
    campaign.schedule.startAt = new Date();
    campaign.pendingCount = campaign.totalContacts - campaign.sentCount - campaign.failedCount;
    await campaign.save();

    const campaignId = String(campaign._id);
    if (runningCampaigns.has(campaignId)) return successResponse(res, { campaign }, 'Campaign already running');

    runningCampaigns.set(campaignId, { paused: false });
    const pendingRecipients = campaign.recipients.filter(r => r.status === 'pending');

    logger.info(`Campaign ${campaignId} started: ${pendingRecipients.length} pending recipients, instance=${campaign.instance}, type=${campaign.type}, content=${JSON.stringify(campaign.messageContent)}`);
    processCampaign(campaignId, pendingRecipients, campaign).catch(err => {
      logger.error(`Campaign ${campaignId} processing error: ${err.message}`);
    });

    await ActivityLog.create({
      user: req.userId,
      action: 'campaign.start',
      category: 'campaign',
      description: `Started campaign: ${campaign.name}`,
    });

    successResponse(res, { campaign }, 'Campaign started');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

async function processCampaign(campaignId, pendingRecipients, campaign) {
  for (let i = 0; i < pendingRecipients.length; i++) {
    const state = runningCampaigns.get(campaignId);
    if (!state || state.paused) {
      logger.info(`Campaign ${campaignId}: paused at recipient ${i}/${pendingRecipients.length}`);
      break;
    }
    logger.info(`Campaign ${campaignId}: sending to ${pendingRecipients[i].phone} (${i+1}/${pendingRecipients.length})`);

    const delay = campaign.delay.type === 'random'
      ? Math.floor(Math.random() * (campaign.delay.maxDelay - campaign.delay.minDelay + 1)) + campaign.delay.minDelay
      : campaign.delay.fixedDelay;

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      const result = await Promise.race([
        sendMessage(String(campaign.instance), pendingRecipients[i].phone, campaign.messageContent, campaign.type),
        new Promise((_, reject) => setTimeout(() => reject(new Error('sendMessage timeout')), 30000)),
      ]);

      await Campaign.updateOne(
        { _id: campaignId, 'recipients.phone': pendingRecipients[i].phone },
        { $set: { 'recipients.$.status': 'sent', 'recipients.$.sentAt': new Date() }, $inc: { sentCount: 1, pendingCount: -1 } }
      );

      await Message.create({
        user: campaign.user,
        instance: campaign.instance,
        campaign: campaignId,
        messageType: campaign.type || 'text',
        direction: 'outgoing',
        from: result.from || '',
        to: pendingRecipients[i].phone,
        content: campaign.messageContent,
        status: 'sent',
        sentAt: new Date(),
      });
    } catch (err) {
      logger.error(`Campaign send error [${campaignId} -> ${pendingRecipients[i].phone}]: ${err.message}`);
      await Campaign.updateOne(
        { _id: campaignId, 'recipients.phone': pendingRecipients[i].phone },
        { $set: { 'recipients.$.status': 'failed', 'recipients.$.errorMessage': err.message }, $inc: { failedCount: 1, pendingCount: -1 } }
      );
    }
  }

  runningCampaigns.delete(campaignId);

  const updated = await Campaign.findById(campaignId).select('status');
  if (updated?.status === 'running') {
    await Campaign.findByIdAndUpdate(campaignId, { status: 'completed', completedAt: new Date() });
    logger.info(`Campaign ${campaignId}: completed`);
  }
}

export const pause = async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, user: req.userId, status: 'running' },
      { status: 'paused' },
      { new: true }
    );
    if (!campaign) return errorResponse(res, 'Campaign not found or not running', 404);

    const state = runningCampaigns.get(String(campaign._id));
    if (state) state.paused = true;

    successResponse(res, { campaign }, 'Campaign paused');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const resume = async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, user: req.userId, status: 'paused' },
      { status: 'running' },
      { new: true }
    );
    if (!campaign) return errorResponse(res, 'Campaign not found or not paused', 404);

    const state = runningCampaigns.get(String(campaign._id));
    if (state) state.paused = false;

    successResponse(res, { campaign }, 'Campaign resumed');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const stop = async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, user: req.userId, status: { $in: ['running', 'paused'] } },
      { status: 'cancelled', cancelledAt: new Date() },
      { new: true }
    );
    if (!campaign) return errorResponse(res, 'Campaign not found', 404);

    const state = runningCampaigns.get(String(campaign._id));
    if (state) state.paused = true;
    successResponse(res, { campaign }, 'Campaign stopped');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const remove = async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { isDeleted: true },
      { new: true }
    );
    if (!campaign) return errorResponse(res, 'Campaign not found', 404);
    successResponse(res, null, 'Campaign deleted');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const getAnalytics = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      user: req.userId,
    }).populate('instance', 'name phone');
    if (!campaign) return errorResponse(res, 'Campaign not found', 404);

    const analytics = {
      total: campaign.totalContacts,
      sent: campaign.sentCount,
      delivered: campaign.deliveredCount,
      read: campaign.readCount,
      failed: campaign.failedCount,
      pending: campaign.pendingCount,
      successRate: campaign.totalContacts > 0
        ? Math.round((campaign.sentCount / campaign.totalContacts) * 100)
        : 0,
    };

    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, { campaign, analytics });
    }

    res.render('campaign/analytics', { title: `Campaign: ${campaign.name}`, campaign, analytics, activePage: 'campaigns' });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};
