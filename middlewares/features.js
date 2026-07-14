import Subscription from '../models/Subscription.js';
import Plan from '../models/Plan.js';
import { errorResponse } from '../utils/response.js';

export const checkFeature = (feature) => {
  return async (req, res, next) => {
    try {
      if (req.user.role === 'super_admin') return next();

      const sub = await Subscription.findOne({
        user: req.userId,
        status: { $in: ['active', 'trial'] },
      }).populate('plan').lean();

      if (!sub) {
        if (req.xhr || req.headers.accept?.includes('json')) {
          return errorResponse(res, 'No active subscription. Please purchase a plan.', 403);
        }
        return res.redirect('/plans');
      }

      const featureValue = sub.features?.[feature] ?? sub.plan?.features?.[feature];
      if (featureValue === -1) return next();
      if (!featureValue || featureValue === 0 || featureValue === false) {
        return errorResponse(res, `Feature "${feature}" not available in your plan. Upgrade required.`, 403);
      }

      req.subscription = sub;
      next();
    } catch (error) {
      errorResponse(res, 'Feature check failed', 500);
    }
  };
};

export const checkInstanceLimit = async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') return next();

    const sub = await Subscription.findOne({
      user: req.userId,
      status: { $in: ['active', 'trial'] },
    }).lean();

    if (!sub) return errorResponse(res, 'No active subscription', 403);

    const limit = sub.features?.whatsappInstances;
    if (limit === -1) return next();

    const { default: Instance } = await import('../models/Instance.js');
    const count = await Instance.countDocuments({ user: req.userId, isDeleted: false });

    if (count >= limit) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return errorResponse(res, `Instance limit reached (${limit}). Upgrade your plan.`, 403);
      }
      req.session.error = `Instance limit reached (${limit}). Please delete an instance or upgrade your plan.`;
      return res.redirect('/instances');
    }

    next();
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const checkDailyMessageLimit = async (userId) => {
  const sub = await Subscription.findOne({ user: userId, status: { $in: ['active', 'trial'] } }).lean();
  if (!sub) return { allowed: false, reason: 'No active subscription' };

  const limit = sub.features?.dailyMessageLimit;
  if (limit === -1) return { allowed: true };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { default: Message } = await import('../models/Message.js');
  const sentToday = await Message.countDocuments({
    user: userId,
    direction: 'outgoing',
    createdAt: { $gte: today },
  });

  if (sentToday >= limit) {
    return { allowed: false, reason: `Daily message limit reached (${limit})` };
  }

  return { allowed: true, remaining: limit - sentToday };
};

export const checkMonthlyMessageLimit = async (userId) => {
  const sub = await Subscription.findOne({ user: userId, status: { $in: ['active', 'trial'] } }).lean();
  if (!sub) return { allowed: false, reason: 'No active subscription' };

  const limit = sub.features?.monthlyMessageLimit;
  if (limit === -1) return { allowed: true };

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { default: Message } = await import('../models/Message.js');
  const sentThisMonth = await Message.countDocuments({
    user: userId,
    direction: 'outgoing',
    createdAt: { $gte: startOfMonth },
  });

  if (sentThisMonth >= limit) {
    return { allowed: false, reason: `Monthly message limit reached (${limit})` };
  }

  return { allowed: true, remaining: limit - sentThisMonth };
};
