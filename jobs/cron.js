import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import connectDatabase from '../config/database.js';
import { createRedisClient } from '../config/redis.js';
import Subscription from '../models/Subscription.js';
import Instance from '../models/Instance.js';
import Notification from '../models/Notification.js';
import SystemSetting from '../models/SystemSetting.js';
import { getQueueMetrics, cleanQueue } from '../services/queueService.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';

export const initializeCronJobs = async () => {
  if (mongoose.connection.readyState !== 1) {
    await connectDatabase();
  }
  createRedisClient();

  cron.schedule('0 0 * * *', async () => {
    logger.info('Running daily subscription expiry check...');
    try {
      const expired = await Subscription.updateMany(
        {
          status: { $in: ['active', 'trial'] },
          endDate: { $lt: new Date() },
        },
        { status: 'expired' }
      );
      logger.info(`Expired ${expired.modifiedCount} subscriptions`);
    } catch (error) {
      logger.error('Subscription expiry check failed:', error);
    }
  });

  cron.schedule('0 0 * * *', async () => {
    logger.info('Running daily message usage reset...');
    try {
      const result = await Subscription.updateMany(
        {},
        {
          $set: {
            'usage.dailyMessages': 0,
            'usage.lastResetDate': new Date(),
          },
        }
      );
      logger.info(`Reset daily usage for ${result.modifiedCount} subscriptions`);
    } catch (error) {
      logger.error('Daily usage reset failed:', error);
    }
  });

  cron.schedule('0 0 1 * *', async () => {
    logger.info('Running monthly message usage reset...');
    try {
      const result = await Subscription.updateMany(
        {},
        { $set: { 'usage.monthlyMessages': 0 } }
      );
      logger.info(`Reset monthly usage for ${result.modifiedCount} subscriptions`);
    } catch (error) {
      logger.error('Monthly usage reset failed:', error);
    }
  });

  cron.schedule('*/30 * * * *', async () => {
    try {
      const metrics = await getQueueMetrics();
      logger.debug('Queue metrics:', metrics.length, 'queues');
    } catch (err) {
      logger.error('Queue metrics error:', err);
    }
  });

  cron.schedule('0 */6 * * *', async () => {
    logger.info('Running queue cleanup...');
    try {
      const instances = await Instance.find({ isDeleted: false }).select('_id');
      for (const inst of instances) {
        await cleanQueue(inst._id, 7200);
      }
    } catch (error) {
      logger.error('Queue cleanup failed:', error);
    }
  });

  cron.schedule('0 2 * * *', async () => {
    logger.info('Running old uploads cleanup...');
    try {
      const setting = await SystemSetting.findOne({ key: 'file_retention_days' });
      const retentionDays = parseInt(setting?.value) || 30;
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      const uploadDir = path.resolve(config.upload.dir);
      if (!fs.existsSync(uploadDir)) return;

      let deleted = 0;
      const files = fs.readdirSync(uploadDir);
      for (const file of files) {
        const filePath = path.join(uploadDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      }
      logger.info(`Cleaned ${deleted} old uploaded files (retention: ${retentionDays}d)`);
    } catch (error) {
      logger.error('Upload cleanup failed:', error);
    }
  });

  // Auto-reconnect tracking (actual reconnect handled by whatsappService disconnect handler)
  cron.schedule('*/5 * * * *', async () => {
    try {
      const disconnected = await Instance.find({
        status: { $in: ['disconnected', 'error'] },
        isDeleted: false,
        'settings.autoReconnect': true,
        lastDisconnected: {
          $lt: new Date(Date.now() - 5 * 60 * 1000),
          $ne: null,
        },
      }).countDocuments();

      if (disconnected > 0) {
        logger.debug(`Auto-reconnect: ${disconnected} instance(s) pending reconnect`);
      }
    } catch (err) {
      logger.error('Auto-reconnect check error:', err);
    }
  });

  cron.schedule('0 * * * *', async () => {
    try {
      const { default: MediaFile } = await import('../models/MediaFile.js');
      const expired = await MediaFile.find({ expiresAt: { $lte: new Date() }, isDeleted: false });
      let deleted = 0;
      for (const m of expired) {
        try {
          const filePath = path.join(config.rootDir, 'public', 'media', m.filePath);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          if (m.thumbPath) {
            const thumbPath = path.join(config.rootDir, 'public', 'media', m.thumbPath);
            if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
          }
        } catch (mediaErr) {
          logger.error('Media file deletion error:', mediaErr);
        }
        m.isDeleted = true;
        await m.save();
        deleted++;
      }
      if (deleted > 0) logger.info(`Cleaned ${deleted} expired media files from disk`);
    } catch (err) {
      logger.error('Media file cleanup error:', err);
    }
  });

  cron.schedule('*/10 * * * *', async () => {
    try {
      const campaigns = (await import('../models/Campaign.js')).default;
      const now = new Date();
      const due = await campaigns.find({
        status: 'scheduled',
        'schedule.scheduledAt': { $lte: now },
        isDeleted: false,
      });

      for (const campaign of due) {
        campaign.status = 'running';
        campaign.schedule.startAt = now;
        await campaign.save();
        logger.info(`Campaign ${campaign._id} auto-started from schedule`);
      }
    } catch (err) {
      logger.error('Campaign auto-start error:', err);
    }
  });

  logger.info('Cron jobs initialized');
};

if (process.argv[1]?.includes('cron')) {
  initializeCronJobs().then(() => {
    logger.info('Cron service running');
  });
}

export default initializeCronJobs;
