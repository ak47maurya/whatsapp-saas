import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { authorize } from '../middlewares/rbac.js';
import { checkFeature, checkInstanceLimit } from '../middlewares/features.js';
import Subscription from '../models/Subscription.js';
import logger from '../utils/logger.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(config.rootDir, config.upload.dir));
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxFileSize },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(csv|xlsx|xls|jpg|jpeg|png|gif|webp|mp4|mp3|ogg|wav|pdf|doc|docx|ppt|pptx|xls|xlsx|zip|rar)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  },
});

import * as dashboardController from '../controllers/dashboardController.js';
import * as userController from '../controllers/userController.js';
import * as planController from '../controllers/planController.js';
import * as subscriptionController from '../controllers/subscriptionController.js';
import * as instanceController from '../controllers/instanceController.js';
import * as messageController from '../controllers/messageController.js';
import * as campaignController from '../controllers/campaignController.js';
import * as contactController from '../controllers/contactController.js';
import * as groupController from '../controllers/groupController.js';
import * as webhookController from '../controllers/webhookController.js';
import * as apiController from '../controllers/apiController.js';
import * as notificationController from '../controllers/notificationController.js';
import * as inboxController from '../controllers/inboxController.js';
import * as systemSettingController from '../controllers/systemSettingController.js';
import * as invoiceController from '../controllers/invoiceController.js';
import * as chatbotController from '../controllers/chatbotController.js';
import * as dynamicMessagingController from '../controllers/dynamicMessagingController.js';

const router = Router();

router.use(authenticate);

router.use(async (req, res, next) => {
  res.locals.isAuthenticated = true;
  res.locals.isAdmin = ['super_admin', 'admin'].includes(req.user.role);
  res.locals.isSuperAdmin = req.user.role === 'super_admin';

  if (req.user.role !== 'super_admin') {
    try {
      const sub = await Subscription.findOne({
        user: req.userId,
        status: { $in: ['active', 'trial'] },
      }).populate('plan').lean();
      req.user._subscription = sub;
    } catch (err) {
      logger.error('Subscription attach error:', err);
    }
  } else {
    req.user._subscription = null;
  }
  res.locals.user = req.user;
  next();
});

router.get('/dashboard', dashboardController.userDashboard);
router.get('/admin/dashboard', authorize('super_admin', 'admin'), dashboardController.adminDashboard);
router.get('/admin/queue', authorize('super_admin', 'admin'), dashboardController.queuePage);
router.post('/admin/queue/:instanceId/pause', authorize('super_admin', 'admin'), dashboardController.queuePause);
router.post('/admin/queue/:instanceId/resume', authorize('super_admin', 'admin'), dashboardController.queueResume);
router.post('/admin/queue/:instanceId/clean', authorize('super_admin', 'admin'), dashboardController.queueClean);
router.delete('/admin/queue/:instanceId', authorize('super_admin', 'admin'), dashboardController.queueDelete);

router.get('/users', authorize('super_admin', 'admin'), userController.index);
router.post('/users', authorize('super_admin', 'admin'), userController.create);
router.get('/users/:id', authorize('super_admin', 'admin'), userController.show);
router.put('/users/:id', authorize('super_admin', 'admin'), userController.update);
router.put('/users/:id/suspend', authorize('super_admin', 'admin'), userController.suspend);
router.put('/users/:id/activate', authorize('super_admin', 'admin'), userController.activate);
router.post('/users/:id/clear-data', authorize('super_admin'), userController.clearUserData);
router.delete('/users/:id', authorize('super_admin', 'admin'), userController.remove);
router.get('/users/:userId/activity', authorize('super_admin', 'admin'), userController.getActivityLogs);

router.get('/plans', planController.index);
router.get('/plans/:id', authorize('super_admin', 'admin'), planController.getPlan);
router.get('/plans/:id/edit', authorize('super_admin', 'admin'), planController.editView);
router.post('/plans', authorize('super_admin', 'admin'), planController.create);
router.put('/plans/:id', authorize('super_admin', 'admin'), planController.update);
router.delete('/plans/:id', authorize('super_admin', 'admin'), planController.remove);

router.get('/subscriptions', subscriptionController.index);
router.post('/subscriptions', subscriptionController.subscribe);
router.put('/subscriptions/:id/cancel', subscriptionController.cancel);
router.get('/subscriptions/invoices', subscriptionController.getInvoices);
router.put('/subscriptions/admin-change-plan', authorize('super_admin', 'admin'), subscriptionController.adminChangePlan);

router.get('/instances', instanceController.index);
router.get('/instances/new', instanceController.createForm);
router.post('/instances', checkInstanceLimit, instanceController.create);
router.get('/instances/:id/connect', instanceController.connect);
router.get('/instances/:id/qr', instanceController.getQR);
router.post('/instances/:id/reconnect', instanceController.reconnect);
router.post('/instances/:id/disconnect', instanceController.disconnect);
router.post('/instances/:id/logout', instanceController.logout);
router.delete('/instances/:id', instanceController.remove);
router.get('/instances/:id/status', instanceController.getStatus);
router.put('/instances/:id/settings', instanceController.updateSettings);

router.get('/messages', messageController.index);
router.post('/messages/send', upload.fields([
  { name: 'media', maxCount: 1 },
]), checkFeature('mediaMessaging'), messageController.sendSingle);
router.get('/messages/bulk-page', checkFeature('bulkMessaging'), messageController.bulkPage);
router.get('/messages/bulk-list', checkFeature('bulkMessaging'), messageController.bulkList);
router.post('/messages/bulk', upload.fields([{ name: 'media', maxCount: 1 }]), checkFeature('bulkMessaging'), messageController.sendBulk);
router.get('/messages/bulk-status/:id', checkFeature('bulkMessaging'), messageController.bulkStatus);
router.post('/messages/bulk-cancel/:id', checkFeature('bulkMessaging'), messageController.bulkCancel);
router.get('/messages/history', messageController.getHistory);
router.get('/messages/export', messageController.exportCSV);
router.post('/messages/:id/cancel', messageController.cancel);
router.post('/messages/:id/retry', messageController.retry);

router.get('/campaigns', campaignController.index);
router.post('/campaigns', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'mediaFile', maxCount: 1 }]), checkFeature('campaignAccess'), campaignController.create);
router.post('/campaigns/:id/start', checkFeature('campaignAccess'), campaignController.start);
router.post('/campaigns/:id/pause', checkFeature('campaignAccess'), campaignController.pause);
router.post('/campaigns/:id/resume', checkFeature('campaignAccess'), campaignController.resume);
router.post('/campaigns/:id/stop', checkFeature('campaignAccess'), campaignController.stop);
router.delete('/campaigns/:id', campaignController.remove);
router.get('/campaigns/:id/analytics', checkFeature('campaignAccess'), campaignController.getAnalytics);

router.get('/contacts', contactController.index);
router.get('/contacts/:id', contactController.show);
router.post('/contacts', contactController.create);
router.put('/contacts/:id', contactController.update);
router.delete('/contacts/:id', contactController.remove);
router.post('/contacts/import', upload.single('file'), contactController.importContacts);
router.get('/contacts/export', checkFeature('exportData'), contactController.exportContacts);
router.post('/contacts/:id/tags', contactController.addTags);

router.get('/groups', groupController.index);
router.post('/groups/:instanceId/fetch', groupController.fetchGroups);
router.post('/groups/send', groupController.sendGroupMessage);
router.get('/groups/:id/members', groupController.getGroupMembers);
router.delete('/groups/:id', groupController.remove);

router.get('/webhooks', checkFeature('webhookAccess'), webhookController.index);
router.post('/webhooks', checkFeature('webhookAccess'), webhookController.create);
router.put('/webhooks/:id', checkFeature('webhookAccess'), webhookController.update);
router.delete('/webhooks/:id', checkFeature('webhookAccess'), webhookController.remove);
router.post('/webhooks/test', checkFeature('webhookAccess'), webhookController.test);
router.post('/webhooks/:id/toggle', checkFeature('webhookAccess'), webhookController.toggle);

router.get('/api-keys', checkFeature('apiAccess'), apiController.index);
router.post('/api-keys', checkFeature('apiAccess'), apiController.create);
router.delete('/api-keys/:id', checkFeature('apiAccess'), apiController.remove);
router.post('/api-keys/:id/regenerate', checkFeature('apiAccess'), apiController.regenerate);
router.get('/api-docs', apiController.showDocs);


router.get('/chatbot', checkFeature('chatbot'), chatbotController.index);
router.post('/chatbot', checkFeature('chatbot'), chatbotController.create);
router.post('/chatbot/test-reply', checkFeature('chatbot'), chatbotController.testReply);
router.put('/chatbot/:id', checkFeature('chatbot'), chatbotController.update);
router.delete('/chatbot/:id', checkFeature('chatbot'), chatbotController.remove);

router.get('/dynamic-messaging', checkFeature('dynamicMessaging'), dynamicMessagingController.index);
router.post('/dynamic-messaging', checkFeature('dynamicMessaging'), dynamicMessagingController.create);
router.post('/dynamic-messaging/:id/upload', upload.single('file'), checkFeature('dynamicMessaging'), dynamicMessagingController.uploadContacts);
router.get('/dynamic-messaging/:id/preview', checkFeature('dynamicMessaging'), dynamicMessagingController.preview);
router.post('/dynamic-messaging/:id/send', checkFeature('dynamicMessaging'), dynamicMessagingController.send);
router.post('/dynamic-messaging/:id/cancel', checkFeature('dynamicMessaging'), dynamicMessagingController.cancel);
router.post('/dynamic-messaging/:id/duplicate', checkFeature('dynamicMessaging'), dynamicMessagingController.duplicate);
router.delete('/dynamic-messaging/:id', checkFeature('dynamicMessaging'), dynamicMessagingController.remove);

router.get('/notifications', notificationController.index);
router.post('/notifications/:id/read', notificationController.markAsRead);
router.post('/notifications/read-all', notificationController.markAllRead);
router.get('/notifications/unread-count', notificationController.getUnreadCount);
router.delete('/notifications/:id', notificationController.remove);

router.get('/inbox', inboxController.index);
router.get('/inbox/:instanceId/:contact', inboxController.getConversation);
router.get('/media-gallery', inboxController.mediaGallery);

// Admin Subscriptions
router.get('/admin/subscriptions', authorize('super_admin', 'admin'), subscriptionController.adminIndex);

// Activity Log
router.get('/admin/activity', authorize('super_admin', 'admin'), userController.adminActivity);

// System Settings
router.get('/admin/settings', authorize('super_admin', 'admin'), systemSettingController.index);
router.put('/admin/settings', authorize('super_admin', 'admin'), systemSettingController.update);
router.post('/admin/settings/test-email', authorize('super_admin', 'admin'), systemSettingController.testEmail);

// Admin Invoices
router.get('/admin/invoices', authorize('super_admin', 'admin'), invoiceController.adminIndex);
router.post('/admin/invoices/:id/pay', authorize('super_admin', 'admin'), invoiceController.adminMarkPaid);
router.get('/admin/invoices/:id/pdf', authorize('super_admin', 'admin'), invoiceController.adminDownloadPdf);

// Customer Invoices
router.get('/invoices', invoiceController.customerIndex);
router.get('/invoices/:id/pdf', invoiceController.customerDownloadPdf);



export default router;
