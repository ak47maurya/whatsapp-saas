import mongoose from 'mongoose';

const instanceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: [true, 'Instance name is required'],
    trim: true,
  },
  phone: {
    type: String,
    default: null,
  },
  platform: {
    type: String,
    enum: ['whatsapp', 'whatsapp_business'],
    default: 'whatsapp',
  },
  status: {
    type: String,
    enum: ['connecting', 'connected', 'disconnected', 'error', 'qr_ready', 'qr_expired', 'booting'],
    default: 'disconnected',
  },
  connectionState: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  qrCode: {
    code: String,
    generatedAt: Date,
    expiresAt: Date,
    attempts: { type: Number, default: 0 },
  },
  authData: {
    creds: { type: mongoose.Schema.Types.Mixed, default: null },
    keys: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  profile: {
    name: String,
    about: String,
    picture: String,
    phone: String,
  },
  settings: {
    autoReconnect: { type: Boolean, default: true },
    markReadOnSend: { type: Boolean, default: false },
    syncFullHistory: { type: Boolean, default: false },
    webhookEnabled: { type: Boolean, default: false },
    webhookUrl: String,
    webhookEvents: [String],
    autoReplyEnabled: { type: Boolean, default: false },
    messageDelay: {
      type: { type: String, enum: ['fixed', 'random'], default: 'fixed' },
      fixedDelay: { type: Number, default: 2000 },
      minDelay: { type: Number, default: 1000 },
      maxDelay: { type: Number, default: 5000 },
    },
  },
  lastConnected: {
    type: Date,
    default: null,
  },
  lastDisconnected: {
    type: Date,
    default: null,
  },
  errorMessage: {
    type: String,
    default: null,
  },
  battery: {
    level: Number,
    plugged: Boolean,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

instanceSchema.index({ user: 1, isDeleted: 1 });
instanceSchema.index({ status: 1 });
instanceSchema.index({ phone: 1 });

const Instance = mongoose.model('Instance', instanceSchema);
export default Instance;
