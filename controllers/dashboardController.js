import User from '../models/User.js';
import Instance from '../models/Instance.js';
import Message from '../models/Message.js';
import Campaign from '../models/Campaign.js';
import Subscription from '../models/Subscription.js';
import { getActiveConnectionCount } from '../services/whatsappService.js';
import { getQueueMetrics, getQueueStatus, pauseQueue, resumeQueue, cleanQueue, removeQueue } from '../services/queueService.js';

export const userDashboard = async (req, res) => {
  try {
    const userId = req.userId;

    const [
      instances,
      totalInstances,
      connectedInstances,
      todayMessages,
      monthlyMessages,
      activeCampaigns,
      subscription,
    ] = await Promise.all([
      Instance.find({ user: userId, isDeleted: false }).sort({ createdAt: -1 }),
      Instance.countDocuments({ user: userId, isDeleted: false }),
      Instance.countDocuments({ user: userId, isDeleted: false, status: 'connected' }),
      Message.countDocuments({
        user: userId,
        createdAt: { $gte: new Date().setHours(0, 0, 0, 0) },
        direction: 'outgoing',
      }),
      Message.countDocuments({
        user: userId,
        createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        direction: 'outgoing',
      }),
      Campaign.countDocuments({ user: userId, status: 'running', isDeleted: false }),
      Subscription.findOne({ user: userId, status: { $in: ['active', 'trial'] } }).populate('plan'),
    ]);

    res.render('user/dashboard', {
      title: 'Dashboard',
      instances,
      stats: {
        totalInstances,
        connectedInstances,
        todayMessages,
        monthlyMessages,
        activeCampaigns,
      },
      subscription,
      dailyLimit: subscription?.features?.dailyMessageLimit || 50,
      monthlyLimit: subscription?.features?.monthlyMessageLimit || 1000,
      activePage: 'dashboard',
    });
  } catch (error) {
    res.status(500).render('errors/500', { title: 'Error', message: error.message });
  }
};

export const adminDashboard = async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      expiredUsers,
      totalInstances,
      connectedInstances,
      totalMessages,
      totalRevenue,
      totalCampaigns,
      recentUsers,
      instanceStats,
      messageStats,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: 'active' }),
      User.countDocuments({ status: { $in: ['inactive', 'suspended'] } }),
      Instance.countDocuments({ isDeleted: false }),
      Instance.countDocuments({ isDeleted: false, status: 'connected' }),
      Message.countDocuments(),
      Subscription.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, total: { $sum: '$price' } } },
      ]),
      Campaign.countDocuments({ isDeleted: false }),
      User.find().sort({ createdAt: -1 }).limit(5).select('name email status createdAt'),
      Instance.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Message.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const revenue = totalRevenue[0]?.total || 0;
    const queueMetrics = await getQueueMetrics();

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: {
        totalUsers,
        activeUsers,
        expiredUsers,
        totalInstances,
        connectedInstances,
        totalMessages,
        totalRevenue: revenue,
        totalCampaigns,
      },
      recentUsers,
      instanceStats,
      messageStats,
      queueMetrics,
      activeConnections: getActiveConnectionCount(),
      activePage: 'admin-dashboard',
    });
  } catch (error) {
    res.status(500).render('errors/500', { title: 'Error', message: error.message });
  }
};

export const queuePage = async (req, res) => {
  try {
    const queues = await getQueueMetrics();
    const instances = await Instance.find({ isDeleted: false }).select('name phone status');
    res.render('admin/queue', { title: 'Queue Management', queues, instances, activePage: 'queue' });
  } catch (error) {
    res.status(500).render('errors/500', { title: 'Error', message: error.message });
  }
};

export const queuePause = async (req, res) => {
  try {
    await pauseQueue(req.params.instanceId);
    res.json({ success: true, message: 'Queue paused' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const queueResume = async (req, res) => {
  try {
    await resumeQueue(req.params.instanceId);
    res.json({ success: true, message: 'Queue resumed' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const queueClean = async (req, res) => {
  try {
    await cleanQueue(req.params.instanceId, 0);
    res.json({ success: true, message: 'Queue cleaned' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const queueDelete = async (req, res) => {
  try {
    await removeQueue(req.params.instanceId);
    res.json({ success: true, message: 'Queue removed' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
