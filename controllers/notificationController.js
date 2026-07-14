import Notification from '../models/Notification.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';

export const index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { user: req.userId };

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.userId, isRead: false }),
    ]);

    if (req.xhr) {
      return paginatedResponse(res, notifications, total, page, limit);
    }

    res.render('notification/index', {
      title: 'Notifications',
      notifications,
      total,
      unreadCount,
      page,
      limit,
      activePage: 'notifications',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    if (!notification) return errorResponse(res, 'Notification not found', 404);
    successResponse(res, { notification });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    successResponse(res, null, 'All notifications marked as read');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({ user: req.userId, isRead: false });
    successResponse(res, { count });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const remove = async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, user: req.userId });
    successResponse(res, null, 'Notification deleted');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};
