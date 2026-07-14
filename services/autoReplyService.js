import Chatbot from '../models/Chatbot.js';
import logger from '../utils/logger.js';

export const processAutoReply = async (instance, remoteJid, msgText, sock) => {
  if (!msgText || !sock) return;
  try {
    const lowerText = msgText.trim().toLowerCase();

    // Check chatbot rules
    const botRules = await Chatbot.find({ instance: instance._id, isActive: true }).lean();
    for (const bot of botRules) {
      const matched = (bot.keywords || []).some(kw => {
        const kwLower = kw.toLowerCase().trim();
        if (bot.matchType === 'exact') return lowerText === kwLower;
        if (bot.matchType === 'regex') try { return new RegExp(kw, 'i').test(lowerText); } catch { return false; }
        return lowerText.includes(kwLower);
      });
      if (matched) {
        await sock.sendMessage(remoteJid, { text: bot.response });
        logger.info(`Chatbot reply sent to ${remoteJid} for "${bot.name}"`);
        return;
      }
    }
  } catch (err) {
    logger.error(`Chatbot error for instance ${instance._id}: ${err.message}`);
  }
};
