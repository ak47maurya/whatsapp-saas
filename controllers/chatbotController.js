import Chatbot from '../models/Chatbot.js';
import Instance from '../models/Instance.js';
import { sendMessage } from '../services/whatsappService.js';
import { successResponse, errorResponse } from '../utils/response.js';

export const index = async (req, res) => {
  try {
    const bots = await Chatbot.find({ user: req.userId }).populate('instance', 'name phone').sort('-createdAt');
    const instances = await Instance.find({ user: req.userId, status: 'connected' }).select('name phone').lean();
    res.render('chatbot/index', { title: 'Chatbot', activePage: 'chatbot', bots, instances });
  } catch (err) {
    req.session.error = err.message;
    res.redirect('/dashboard');
  }
};

export const create = async (req, res) => {
  try {
    const { instance, name, keywords, matchType, response } = req.body;
    if (!instance || !name || !response) return errorResponse(res, 'Instance, name and response are required');
    const keywordArr = typeof keywords === 'string' ? keywords.split(',').map(k => k.trim()).filter(Boolean) : (keywords || []);
    const bot = await Chatbot.create({ user: req.userId, instance, name, keywords: keywordArr, matchType, response });
    successResponse(res, { chatbot: bot }, 'Chatbot created');
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const update = async (req, res) => {
  try {
    const { instance, name, keywords, matchType, response, isActive } = req.body;
    const keywordArr = typeof keywords === 'string' ? keywords.split(',').map(k => k.trim()).filter(Boolean) : (keywords || []);
    const bot = await Chatbot.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: { instance, name, keywords: keywordArr, matchType, response, isActive } },
      { new: true }
    );
    if (!bot) return errorResponse(res, 'Chatbot not found', 404);
    successResponse(res, { chatbot: bot }, 'Updated');
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const testReply = async (req, res) => {
  try {
    const { botId, testMessage } = req.body;
    if (!botId || !testMessage) return errorResponse(res, 'Bot ID and test message required');

    const bot = await Chatbot.findOne({ _id: botId, user: req.userId });
    if (!bot) return errorResponse(res, 'Chatbot not found', 404);
    if (!bot.isActive) return errorResponse(res, 'Chatbot rule is inactive');

    const instance = await Instance.findOne({ _id: bot.instance, user: req.userId });
    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const lowerText = testMessage.toLowerCase().trim();
    const matched = (bot.keywords || []).some(kw => {
      const kwLower = kw.toLowerCase().trim();
      if (bot.matchType === 'exact') return lowerText === kwLower;
      if (bot.matchType === 'regex') { try { return new RegExp(kw, 'i').test(lowerText); } catch { return false; } }
      return lowerText.includes(kwLower);
    });

    if (!matched) return successResponse(res, { matched: false }, 'No keyword matched. Try a different message.');

    // Send the reply
    const replyText = bot.response;
    await sendMessage(instance._id, instance.phone, { text: replyText }, 'text');
    successResponse(res, { matched: true }, `Reply sent! Check your WhatsApp (${instance.phone}) for: "${replyText}"`);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const remove = async (req, res) => {
  try {
    const bot = await Chatbot.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!bot) return errorResponse(res, 'Chatbot not found', 404);
    successResponse(res, 'Deleted');
  } catch (err) {
    errorResponse(res, err.message);
  }
};