import Instance from '../models/Instance.js';
import { whatsappService } from '../services/index.js';
import ActivityLog from '../models/ActivityLog.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';

export const index = async (req, res) => {
  try {
    const filter = { user: req.userId, isDeleted: false };
    const instances = await Instance.find(filter).sort({ createdAt: -1 });

    const { getInstance } = await import('../services/whatsapp/Manager.js');
    for (const inst of instances) {
      if (inst.status === 'connected') {
        const mgr = getInstance(inst._id);
        if (!mgr || !mgr.sock || mgr.sock.ws?.readyState !== 1) {
          inst._realStatus = (mgr && mgr._reconnectTimer) ? 'reconnecting' : 'disconnected';
        } else {
          inst._realStatus = 'connected';
        }
      } else {
        inst._realStatus = inst.status;
      }
    }

    res.render('instance/index', {
      title: 'My Instances',
      instances,
      activePage: 'instances',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const createForm = (req, res) => {
  res.render('instance/create', { title: 'New Instance' });
};

export const create = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return errorResponse(res, 'Instance name is required', 400);
      }
      req.session.error = 'Instance name is required';
      return res.redirect('/instances');
    }

    const instance = await Instance.create({
      user: req.userId,
      name: name.trim(),
    });

    await ActivityLog.create({
      user: req.userId,
      action: 'instance.create',
      category: 'instance',
      description: `Created instance: ${name}`,
    });

    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, { instance }, 'Instance created', 201);
    }

    req.session.success = 'Instance created successfully. Click "Connect QR" to link WhatsApp.';
    res.redirect('/instances');
  } catch (error) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return errorResponse(res, error.message, 400);
    }
    req.session.error = error.message;
    res.redirect('/instances');
  }
};

export const connect = async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      user: req.userId,
      isDeleted: false,
    });

    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const updatedInstance = await whatsappService.generateQR(instance._id);
    res.render('instance/connect', {
      title: 'Connect - ' + instance.name,
      instance: updatedInstance,
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const getQR = async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      user: req.userId,
      isDeleted: false,
    });
    if (!instance) return errorResponse(res, 'Instance not found', 404);
    successResponse(res, { instance });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const reconnect = async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      user: req.userId,
      isDeleted: false,
    });
    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const updatedInstance = await whatsappService.generateQR(instance._id);
    successResponse(res, {
      instance: {
        _id: updatedInstance._id,
        status: updatedInstance.status,
        qrCode: updatedInstance.qrCode,
        phone: updatedInstance.phone,
      },
    }, 'Reconnection initiated');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const disconnect = async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      user: req.userId,
      isDeleted: false,
    });
    if (!instance) return errorResponse(res, 'Instance not found', 404);

    await whatsappService.disconnectInstance(instance._id);

    await ActivityLog.create({
      user: req.userId,
      action: 'instance.disconnect',
      category: 'instance',
      description: `Disconnected instance: ${instance.name}`,
    });

    successResponse(res, null, 'Instance disconnected');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const logout = async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      user: req.userId,
      isDeleted: false,
    });
    if (!instance) return errorResponse(res, 'Instance not found', 404);

    await whatsappService.logoutInstance(instance._id);

    await ActivityLog.create({
      user: req.userId,
      action: 'instance.logout',
      category: 'instance',
      description: `Logged out instance: ${instance.name}`,
      severity: 'warning',
    });

    successResponse(res, null, 'Instance logged out');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const remove = async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      user: req.userId,
      isDeleted: false,
    });
    if (!instance) return errorResponse(res, 'Instance not found', 404);

    await whatsappService.logoutInstance(instance._id);

    instance.isDeleted = true;
    instance.deletedAt = new Date();
    await instance.save();

    await ActivityLog.create({
      user: req.userId,
      action: 'instance.delete',
      category: 'instance',
      description: `Deleted instance: ${instance.name}`,
      severity: 'warning',
    });

    successResponse(res, null, 'Instance deleted');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const getStatus = async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      user: req.userId,
      isDeleted: false,
    });
    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const status = await whatsappService.getConnectionStatus(instance._id);
    successResponse(res, { instance, status });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const updateSettings = async (req, res) => {
  try {
    const instance = await Instance.findOne(
      { _id: req.params.id, user: req.userId, isDeleted: false }
    );
    if (!instance) return errorResponse(res, 'Instance not found', 404);

    const allowedSettings = ['autoReconnect', 'syncFullHistory', 'markReadOnSend', 'webhookUrl', 'messageDelay', 'groupIgnore', 'readReceipts'];
    for (const key of Object.keys(req.body)) {
      if (allowedSettings.includes(key)) {
        instance.settings[key] = req.body[key];
      }
    }
    await instance.save();

    successResponse(res, { instance }, 'Settings updated');
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};
