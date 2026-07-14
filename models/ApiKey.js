import mongoose from 'mongoose';
import crypto from 'crypto';

const apiKeySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: [true, 'API key name is required'],
    trim: true,
  },
  key: {
    type: String,
    unique: true,
    default: () => `wa_${crypto.randomBytes(32).toString('hex')}`,
  },
  prefix: {
    type: String,
    default: () => crypto.randomBytes(4).toString('hex'),
  },
  permissions: [{
    type: String,
    enum: [
      'send_message',
      'send_media',
      'send_bulk',
      'create_campaign',
      'read_instances',
      'read_messages',
      'read_contacts',
      'manage_webhooks',
    ],
  }],
  lastUsed: {
    type: Date,
    default: null,
  },
  expiresAt: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  ipWhitelist: [String],
  rateLimit: {
    perMinute: { type: Number, default: 60 },
    perHour: { type: Number, default: 1000 },
  },
  usage: {
    count: { type: Number, default: 0 },
    lastResetAt: { type: Date, default: Date.now },
  },
}, {
  timestamps: true,
});

apiKeySchema.index({ user: 1 });

const ApiKey = mongoose.model('ApiKey', apiKeySchema);
export default ApiKey;
