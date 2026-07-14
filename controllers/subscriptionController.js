import Subscription from '../models/Subscription.js';
import Plan from '../models/Plan.js';
import Invoice from '../models/Invoice.js';
import User from '../models/User.js';
import ActivityLog from '../models/ActivityLog.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { generateInvoiceNumber } from '../utils/helpers.js';
import config from '../config/index.js';

export const index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.user.role === 'customer') {
      filter.user = req.userId;
    }

    const [subscriptions, total] = await Promise.all([
      Subscription.find(filter)
        .populate('user', 'name email')
        .populate('plan', 'name price')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Subscription.countDocuments(filter),
    ]);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return paginatedResponse(res, subscriptions, total, page, limit);
    }

    res.render('subscription/index', {
      title: 'Subscriptions',
      subscriptions,
      total,
      page,
      limit,
      activePage: 'subscriptions',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const subscribe = async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = await Plan.findById(planId);
    if (!plan) return errorResponse(res, 'Plan not found', 404);

    const existingSub = await Subscription.findOne({
      user: req.userId,
      status: { $in: ['active', 'trial'] },
    });

    if (existingSub) {
      if (existingSub.status === 'trial' && !plan.isTrial) {
        existingSub.status = 'cancelled';
        existingSub.cancelledAt = new Date();
        await existingSub.save();
      } else {
        return errorResponse(res, 'You already have an active subscription. Cancel it first.', 400);
      }
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + plan.validity);

    const subscription = await Subscription.create({
      user: req.userId,
      plan: plan._id,
      status: 'active',
      startDate,
      endDate,
      price: plan.price,
      currency: plan.currency,
      features: plan.features,
    });

    const invoice = await Invoice.create({
      user: req.userId,
      subscription: subscription._id,
      invoiceNumber: generateInvoiceNumber(),
      amount: plan.price,
      currency: plan.currency,
      status: 'paid',
      items: [{ description: `${plan.name} Plan`, quantity: 1, unitPrice: plan.price, total: plan.price }],
      subtotal: plan.price,
      total: plan.price,
      paidAt: new Date(),
    });

    await ActivityLog.create({
      user: req.userId,
      action: 'subscription.create',
      category: 'subscription',
      description: `Subscribed to ${plan.name} plan`,
    });

    successResponse(res, { subscription, invoice }, 'Subscription activated', 201);
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};

export const cancel = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      _id: req.params.id,
      user: req.userId,
      status: { $in: ['active', 'trial'] },
    });

    if (!subscription) return errorResponse(res, 'Active subscription not found', 404);

    subscription.status = 'cancelled';
    subscription.cancelledAt = new Date();
    await subscription.save();

    await ActivityLog.create({
      user: req.userId,
      action: 'subscription.cancel',
      category: 'subscription',
      description: 'Cancelled subscription',
      severity: 'warning',
    });

    successResponse(res, { subscription }, 'Subscription cancelled');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const getInvoices = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.user.role === 'customer') {
      filter.user = req.userId;
    }

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .populate('subscription')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Invoice.countDocuments(filter),
    ]);

    paginatedResponse(res, invoices, total, page, limit);
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const adminIndex = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const { search, status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (search) {
      const users = await User.find({ $or: [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }] }).select('_id');
      filter.user = { $in: users.map(u => u._id) };
    }

    const [subscriptions, total] = await Promise.all([
      Subscription.find(filter)
        .populate('user', 'name email')
        .populate('plan', 'name price')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Subscription.countDocuments(filter),
    ]);

    res.render('admin/subscriptions/index', {
      title: 'Subscriptions',
      subscriptions,
      total,
      page,
      limit,
      filters: { search, status },
      activePage: 'admin-subscriptions',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const adminChangePlan = async (req, res) => {
  try {
    const { userId, planId, customFeatures, customNote, validityDays } = req.body;
    const user = await User.findById(userId);
    if (!user) return errorResponse(res, 'User not found', 404);

    const plan = await Plan.findById(planId);
    if (!plan) return errorResponse(res, 'Plan not found', 404);

    // Cancel existing active subscriptions
    await Subscription.updateMany(
      { user: userId, status: { $in: ['active', 'trial'] } },
      { status: 'cancelled', cancelledAt: new Date() }
    );

    // Create new subscription
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (parseInt(validityDays) || plan.validity));

    // Merge custom features with plan defaults
    const features = { ...plan.features };
    const hasCustom = customFeatures && typeof customFeatures === 'object';
    if (hasCustom) {
      for (const [key, val] of Object.entries(customFeatures)) {
        if (val !== '' && val !== undefined && val !== null) {
          features[key] = val === 'true' ? true : val === 'false' ? false : Number(val);
        }
      }
    }

    const subscription = await Subscription.create({
      user: userId,
      plan: plan._id,
      status: 'active',
      startDate,
      endDate,
      price: plan.price,
      currency: plan.currency,
      features,
      isCustom: hasCustom,
      notes: customNote || '',
    });

    const invoice = await Invoice.create({
      user: userId,
      subscription: subscription._id,
      invoiceNumber: generateInvoiceNumber(),
      amount: plan.price,
      currency: plan.currency,
      status: 'paid',
      items: [{ description: `${plan.name} Plan (admin change)`, quantity: 1, unitPrice: plan.price, total: plan.price }],
      subtotal: plan.price,
      total: plan.price,
      paidAt: new Date(),
      paymentMethod: 'manual',
    });

    await ActivityLog.create({
      user: req.userId,
      action: 'subscription.admin_change',
      category: 'subscription',
      description: hasCustom
        ? `Admin set custom plan for ${user.email} (based on ${plan.name})`
        : `Admin changed user ${user.email} plan to ${plan.name}`,
      metadata: { targetUser: userId, targetPlan: planId, isCustom: !!hasCustom },
    });

    successResponse(res, { subscription, invoice }, hasCustom ? 'Custom plan assigned' : `Plan changed to ${plan.name}`);
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};


