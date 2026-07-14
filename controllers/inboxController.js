import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Instance from '../models/Instance.js';
import Group from '../models/Group.js';
import Contact from '../models/Contact.js';
import MediaFile from '../models/MediaFile.js';
import { successResponse, errorResponse } from '../utils/response.js';

export const index = async (req, res) => {
  try {
    const instances = await Instance.find({ user: req.userId, isDeleted: false, status: 'connected' });
    const selectedInstance = req.query.instanceId || (instances[0]?._id);

    let conversations = [];

    if (selectedInstance) {
      conversations = await Message.aggregate([
        {
          $match: {
            user: req.userId,
            instance: new mongoose.Types.ObjectId(String(selectedInstance)),
            isDeleted: false,
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: { $cond: [{ $eq: ['$direction', 'outgoing'] }, '$to', '$from'] },
            lastMessage: { $first: '$content.text' },
            lastMessageType: { $first: '$messageType' },
            lastMessageAt: { $first: '$createdAt' },
            direction: { $first: '$direction' },
            unread: {
              $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'incoming'] }, { $eq: ['$isRead', false] }] }, 1, 0] },
            },
          },
        },
        { $sort: { lastMessageAt: -1 } },
        { $limit: 50 },
      ]);

      // Include groups from Group model that have no messages yet
      const groupJidsInChat = conversations.map(c => c._id).filter(id => id?.includes('@g.us'));
      const groups = await Group.find({
        user: req.userId,
        instance: selectedInstance,
        jid: { $nin: groupJidsInChat },
        isDeleted: false,
      }).sort({ name: 1 }).limit(20);

      for (const g of groups) {
        conversations.push({
          _id: g.jid,
          lastMessage: `Group: ${g.name}`,
          lastMessageType: 'text',
          lastMessageAt: g.createdAt || g.updatedAt,
          direction: 'outgoing',
          unread: 0,
          _isGroup: true,
        });
      }

      // Attach contact names for non-group conversations
      const contactJids = conversations.filter(c => !c._id?.includes('@g.us')).map(c => c._id?.split('@')[0]);
      const contacts = await Contact.find({ user: req.userId, phone: { $in: contactJids } }).select('phone name');
      const nameMap = {};
      contacts.forEach(c => { nameMap[c.phone] = c.name; });
      conversations.forEach(c => {
        if (!c._id?.includes('@g.us')) {
          const phone = c._id?.split('@')[0];
          c._contactName = nameMap[phone] || null;
        }
      });

      conversations.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    }

    const messages = selectedInstance && req.query.contact
      ? await Message.find({
          user: req.userId,
          instance: selectedInstance,
          $or: [
            { to: req.query.contact },
            { from: req.query.contact },
          ],
        }).sort({ createdAt: 1 }).limit(100)
      : [];

    res.render('inbox/index', {
      title: 'Inbox',
      instances,
      selectedInstance,
      conversations,
      messages,
      activeContact: req.query.contact || null,
      activePage: 'inbox',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const mediaGallery = async (req, res) => {
  try {
    const instances = await Instance.find({ user: req.userId, isDeleted: false, status: 'connected' });
    const selectedInstance = req.query.instanceId || (instances[0]?._id);
    const mediaType = req.query.mediaType || '';
    const direction = req.query.direction || '';
    const page = parseInt(req.query.page) || 1;

    let files = [];
    let total = 0;
    if (selectedInstance) {
      const filter = { instance: selectedInstance, user: req.userId, isDeleted: false };
      if (mediaType) filter.mediaType = mediaType;
      if (direction) filter.direction = direction;
      [files, total] = await Promise.all([
        MediaFile.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).populate('instance', 'name').lean(),
        MediaFile.countDocuments(filter),
      ]);
    }

    res.render('inbox/media', {
      title: 'Media Gallery',
      instances,
      selectedInstance,
      files,
      total,
      page,
      mediaType,
      direction,
      activePage: 'media-gallery',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const getConversation = async (req, res) => {
  try {
    const { instanceId, contact } = req.params;

    const messages = await Message.find({
      user: req.userId,
      instance: instanceId,
      $or: [
        { to: contact },
        { from: contact },
      ],
    }).sort({ createdAt: 1 }).limit(100);

    successResponse(res, { messages });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};
