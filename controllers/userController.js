import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import ActivityLog from '../models/ActivityLog.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';

export const index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { search, role, status } = req.query;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    if (role) filter.role = role;
    if (status) filter.status = status;

    const [users, total] = await Promise.all([
      User.find(filter)
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    // Manually fetch active subscription for each user (handles multiple subs)
    const userIds = users.map(u => u._id);
    const [allSubs, instanceCounts] = await Promise.all([
      Subscription.find({ user: { $in: userIds } })
        .populate('plan', 'name price')
        .sort({ createdAt: -1 })
        .lean(),
      (async () => {
        const Instance = (await import('../models/Instance.js')).default;
        return Instance.aggregate([
          { $match: { user: { $in: userIds }, isDeleted: false } },
          { $group: { _id: '$user', count: { $sum: 1 }, connected: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } } } },
        ]);
      })(),
    ]);

    // Attach latest active subscription to each user
    const subMap = {};
    allSubs.forEach(s => {
      const uid = String(s.user);
      if (!subMap[uid] || (s.status === 'active' && subMap[uid].status !== 'active')) {
        subMap[uid] = s;
      }
    });
    users.forEach(u => { u._doc.subscription = subMap[String(u._id)] || null; });

    const countMap = {};
    instanceCounts.forEach(c => { countMap[String(c._id)] = c; });

    if (req.xhr || req.headers.accept?.includes('json')) {
      return paginatedResponse(res, users, total, page, limit);
    }

    const roles = ['customer', 'admin', 'super_admin'];
    const statuses = ['active', 'inactive', 'suspended', 'pending'];

    res.render('admin/users/index', {
      title: 'User Management',
      users,
      total,
      page,
      limit,
      roles,
      statuses,
      filters: { search, role, status },
      countMap,
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const show = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate('createdBy', 'name email');
    if (!user) return errorResponse(res, 'User not found', 404);

    const [sub, instanceCounts] = await Promise.all([
      Subscription.findOne({ user: user._id }).sort({ createdAt: -1 }).populate('plan', 'name price').lean(),
      (async () => {
        const Instance = (await import('../models/Instance.js')).default;
        return Instance.aggregate([
          { $match: { user: user._id, isDeleted: false } },
          { $group: { _id: null, total: { $sum: 1 }, connected: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } } } },
        ]);
      })(),
    ]);

    const counts = instanceCounts[0] || { total: 0, connected: 0 };
    const userObj = user.toJSON();
    userObj.subscription = sub || null;

    successResponse(res, { user: userObj, instanceCounts: counts });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const create = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const user = await User.create({ name, email, password, role, createdBy: req.userId });

    await ActivityLog.create({
      user: req.userId,
      action: 'user.create',
      category: 'user',
      description: `Created user: ${email}`,
      metadata: { targetUser: user._id },
    });

    successResponse(res, { user }, 'User created', 201);
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};

export const update = async (req, res) => {
  try {
    const { name, email, role, status } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;
    if (role) updates.role = role;
    if (status) updates.status = status;

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!user) return errorResponse(res, 'User not found', 404);

    await ActivityLog.create({
      user: req.userId,
      action: 'user.update',
      category: 'user',
      description: `Updated user: ${user.email}`,
      metadata: { targetUser: user._id, changes: updates },
    });

    successResponse(res, { user }, 'User updated');
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};

export const suspend = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return errorResponse(res, 'User not found', 404);

    if (target.role === 'super_admin') {
      return errorResponse(res, 'Cannot suspend a Super Admin', 403);
    }

    if (req.user.role === 'admin' && target.role === 'admin') {
      return errorResponse(res, 'Admins cannot suspend other admins', 403);
    }

    target.status = 'suspended';
    await target.save();

    await ActivityLog.create({
      user: req.userId,
      action: 'user.suspend',
      category: 'user',
      description: `Suspended user: ${target.email}`,
      severity: 'warning',
    });

    successResponse(res, { user: target }, 'User suspended');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const activate = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: 'active' },
      { new: true }
    );
    if (!user) return errorResponse(res, 'User not found', 404);

    await ActivityLog.create({
      user: req.userId,
      action: 'user.activate',
      category: 'user',
      description: `Activated user: ${user.email}`,
    });

    successResponse(res, { user }, 'User activated');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const remove = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    if (user.role === 'super_admin') {
      return errorResponse(res, 'Cannot delete a Super Admin', 403);
    }

    if (req.user.role === 'admin' && user.role === 'admin') {
      return errorResponse(res, 'Admins cannot delete other admins', 403);
    }

    await User.findByIdAndDelete(req.params.id);

    await ActivityLog.create({
      user: req.userId,
      action: 'user.delete',
      category: 'user',
      description: `Deleted user: ${user.email}`,
      severity: 'warning',
    });

    successResponse(res, null, 'User deleted');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const adminActivity = async (req, res) => {
  try {
    const logs = await ActivityLog.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .limit(200);
    res.render('admin/activity/index', {
      title: 'Activity Log',
      logs,
      activePage: 'admin-activity',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const getActivityLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.params.userId) filter.user = req.params.userId;
    if (req.query.category) filter.category = req.query.category;

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ActivityLog.countDocuments(filter),
    ]);

    paginatedResponse(res, logs, total, page, limit);
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};
