import Group from '../models/Group.js';
import Instance from '../models/Instance.js';
import Message from '../models/Message.js';
import ActivityLog from '../models/ActivityLog.js';
import { whatsappService } from '../services/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';

export const index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { user: req.userId, isDeleted: false };
    if (req.query.instanceId) filter.instance = req.query.instanceId;

    const [groups, total] = await Promise.all([
      Group.find(filter)
        .populate('instance', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Group.countDocuments(filter),
    ]);

    const instances = await Instance.find({ user: req.userId, isDeleted: false, status: 'connected' });

    if (req.xhr || req.headers.accept?.includes('json')) {
      return paginatedResponse(res, groups, total, page, limit);
    }

    res.render('group/index', {
      title: 'Groups',
      groups,
      instances,
      total,
      page,
      limit,
      activePage: 'groups',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const fetchGroups = async (req, res) => {
  try {
    const { instanceId } = req.params;
    const instance = await Instance.findOne({
      _id: instanceId,
      user: req.userId,
      status: 'connected',
    });
    if (!instance) return errorResponse(res, 'Instance not found or not connected', 404);

    const sock = whatsappService.getSocket(instanceId);
    if (!sock) return errorResponse(res, 'Socket not available', 400);

    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups);

    for (const g of groupList) {
      await Group.findOneAndUpdate(
        { jid: g.id, user: req.userId },
        {
          user: req.userId,
          instance: instanceId,
          name: g.subject,
          jid: g.id,
          description: g.desc?.toString() || '',
          subjectOwner: g.subjectOwner,
          subjectTime: g.subjectTime,
          size: g.size,
          members: g.participants?.map(p => ({
            jid: p.id,
            name: p.username || p.phoneNumber || '',
            phone: p.phoneNumber || p.id?.split('@')[0] || '',
            role: p.admin ? 'admin' : 'member',
          })) || [],
        },
        { upsert: true, new: true }
      );
    }

    successResponse(res, { groups: groupList.length }, `${groupList.length} groups fetched`);
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const sendGroupMessage = async (req, res) => {
  try {
    const { instanceId, groupJid, text } = req.body;
    const instance = await Instance.findOne({ _id: instanceId, user: req.userId, status: 'connected' });
    if (!instance) return errorResponse(res, 'Instance not connected', 404);

    const result = await whatsappService.sendMessage(instanceId, groupJid, { text }, 'text');

    await Message.create({
      user: req.userId,
      instance: instanceId,
      messageType: 'text',
      direction: 'outgoing',
      from: instance.phone || '',
      to: groupJid,
      content: { text },
      status: 'sent',
      sentAt: new Date(),
      metadata: { keyId: result?.message?.key?.id },
    });

    await ActivityLog.create({
      user: req.userId,
      action: 'group.message.send',
      category: 'message',
      description: `Sent message to group ${groupJid}`,
    });

    successResponse(res, null, 'Group message sent');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const getGroupMembers = async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.id, user: req.userId });
    if (!group) return errorResponse(res, 'Group not found', 404);

    successResponse(res, { members: group.members, total: group.members?.length || 0 });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const remove = async (req, res) => {
  try {
    const group = await Group.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { isDeleted: true },
      { new: true }
    );
    if (!group) return errorResponse(res, 'Group not found', 404);
    successResponse(res, null, 'Group removed');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};
