import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  instance: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Instance',
    required: true,
  },
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    default: null,
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'button', 'list', 'template'],
    default: 'text',
  },
  direction: {
    type: String,
    enum: ['incoming', 'outgoing'],
    required: true,
  },
  from: {
    type: String,
    required: true,
  },
  to: {
    type: String,
    required: true,
  },
  content: {
    text: String,
    caption: String,
    mediaUrl: String,
    mediaType: String,
    fileName: String,
    fileSize: Number,
    mimeType: String,
    latitude: Number,
    longitude: Number,
    address: String,
    contactName: String,
    contactPhone: String,
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'queued', 'cancelled', 'received'],
    default: 'pending',
  },
  errorMessage: {
    type: String,
    default: null,
  },
  sentAt: {
    type: Date,
    default: null,
  },
  deliveredAt: {
    type: Date,
    default: null,
  },
  readAt: {
    type: Date,
    default: null,
  },
  failedAt: {
    type: Date,
    default: null,
  },
  retryCount: {
    type: Number,
    default: 0,
  },
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 10,
  },
  scheduledAt: {
    type: Date,
    default: null,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

messageSchema.index({ user: 1, createdAt: -1 });
messageSchema.index({ instance: 1, status: 1 });
messageSchema.index({ campaign: 1 });
messageSchema.index({ to: 1 });
messageSchema.index({ status: 1 });
messageSchema.index({ scheduledAt: 1 });

const Message = mongoose.model('Message', messageSchema);
export default Message;
