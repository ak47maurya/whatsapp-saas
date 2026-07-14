import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema({
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
  name: {
    type: String,
    required: [true, 'Campaign name is required'],
    trim: true,
  },
  description: {
    type: String,
    default: '',
  },
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'template'],
    default: 'text',
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed'],
    default: 'draft',
  },
  messageContent: {
    text: String,
    caption: String,
    mediaUrl: String,
    mediaType: String,
    fileName: String,
  },
  schedule: {
    scheduledAt: Date,
    startAt: Date,
    endAt: Date,
    timezone: { type: String, default: 'UTC' },
  },
  recipients: [{
    phone: String,
    name: String,
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
      default: 'pending',
    },
    sentAt: Date,
    deliveredAt: Date,
    errorMessage: String,
  }],
  recipientType: {
    type: String,
    enum: ['manual', 'csv', 'excel', 'group', 'contact_list', 'tag'],
    default: 'manual',
  },
  recipientFile: {
    fileName: String,
    originalName: String,
    path: String,
    mimeType: String,
  },
  groups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
  }],
  contactLists: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
  }],
  tags: [String],
  totalContacts: {
    type: Number,
    default: 0,
  },
  sentCount: {
    type: Number,
    default: 0,
  },
  deliveredCount: {
    type: Number,
    default: 0,
  },
  readCount: {
    type: Number,
    default: 0,
  },
  failedCount: {
    type: Number,
    default: 0,
  },
  pendingCount: {
    type: Number,
    default: 0,
  },
  delay: {
    type: {
      type: String,
      enum: ['fixed', 'random'],
      default: 'fixed',
    },
    minDelay: { type: Number, default: 1000 },
    maxDelay: { type: Number, default: 3000 },
    fixedDelay: { type: Number, default: 2000 },
  },
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 10,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  cancelledAt: {
    type: Date,
    default: null,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

campaignSchema.index({ user: 1, status: 1 });
campaignSchema.index({ instance: 1 });
campaignSchema.index({ 'schedule.scheduledAt': 1 });

const Campaign = mongoose.model('Campaign', campaignSchema);
export default Campaign;
