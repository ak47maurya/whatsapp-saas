import mongoose from 'mongoose';

const webhookSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  instance: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Instance',
    default: null,
  },
  name: {
    type: String,
    required: [true, 'Webhook name is required'],
    trim: true,
  },
  url: {
    type: String,
    required: [true, 'Webhook URL is required'],
    trim: true,
  },
  events: [{
    type: String,
    enum: [
      'message.received',
      'message.sent',
      'message.delivered',
      'message.read',
      'instance.connected',
      'instance.disconnected',
      'instance.qr',
      'group.join',
      'group.leave',
      'group.update',
    ],
  }],
  headers: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  secret: {
    type: String,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  retryCount: {
    type: Number,
    default: 3,
  },
  timeout: {
    type: Number,
    default: 5000,
  },
  lastTriggered: {
    type: Date,
    default: null,
  },
  lastResponse: {
    statusCode: Number,
    body: String,
    triggeredAt: Date,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

webhookSchema.index({ user: 1 });
webhookSchema.index({ instance: 1 });
webhookSchema.index({ isActive: 1 });

const Webhook = mongoose.model('Webhook', webhookSchema);
export default Webhook;
