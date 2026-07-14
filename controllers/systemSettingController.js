import SystemSetting from '../models/SystemSetting.js';
import ActivityLog from '../models/ActivityLog.js';
import { sendEmail } from '../services/emailService.js';
import { successResponse, errorResponse } from '../utils/response.js';
import config from '../config/index.js';

export const index = async (req, res) => {
  try {
    const settings = await SystemSetting.find().sort({ group: 1, key: 1 });
    res.render('admin/settings/index', {
      title: 'System Settings',
      settings,
      activePage: 'settings',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const update = async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return errorResponse(res, 'Key is required', 400);

    const setting = await SystemSetting.findOneAndUpdate(
      { key },
      { value, updatedBy: req.userId },
      { new: true }
    );

    if (!setting) return errorResponse(res, 'Setting not found', 404);

    await ActivityLog.create({
      user: req.userId,
      action: 'settings.update',
      category: 'system',
      description: `Updated setting: ${key} = ${JSON.stringify(value)}`,
    });

    successResponse(res, { setting }, 'Setting updated');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const testEmail = async (req, res) => {
  try {
    await sendEmail({
      to: req.user.email,
      subject: 'Test Email from ' + config.app.name,
      html: '<h2>Test Email</h2><p>If you received this, email configuration is working correctly.</p>',
    });
    await ActivityLog.create({ user: req.userId, action: 'email.test', category: 'system', description: 'Test email sent' });
    successResponse(res, null, 'Test email sent successfully');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};