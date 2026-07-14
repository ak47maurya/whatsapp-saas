import mongoose from 'mongoose';

const planSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Plan name is required'],
    unique: true,
    trim: true,
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
  },
  description: {
    type: String,
    default: '',
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative'],
  },
  validity: {
    type: Number,
    required: [true, 'Validity in days is required'],
    min: [1, 'Validity must be at least 1 day'],
  },
  currency: {
    type: String,
    default: 'USD',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isTrial: {
    type: Boolean,
    default: false,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  features: {
    whatsappInstances: { type: Number, default: 1 },
    dailyMessageLimit: { type: Number, default: 100 },
    monthlyMessageLimit: { type: Number, default: 3000 },
    apiAccess: { type: Boolean, default: false },
    webhookAccess: { type: Boolean, default: false },
    campaignAccess: { type: Boolean, default: false },
    teamMembers: { type: Number, default: 1 },
    contactsLimit: { type: Number, default: 500 },
    groupsLimit: { type: Number, default: 10 },
    mediaMessaging: { type: Boolean, default: true },
    bulkMessaging: { type: Boolean, default: false },
    chatbot: { type: Boolean, default: false },
    dynamicMessaging: { type: Boolean, default: false },
    scheduler: { type: Boolean, default: false },
    apiKeys: { type: Number, default: 0 },
    webhookUrls: { type: Number, default: 0 },
    exportData: { type: Boolean, default: false },
    outgoingMessages: { type: Boolean, default: true },
    incomingMessages: { type: Boolean, default: true },
    customFeatures: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  metadata: {
    popular: { type: Boolean, default: false },
    badge: { type: String, default: '' },
    highlight: { type: Boolean, default: false },
  },
}, {
  timestamps: true,
});

planSchema.pre('save', function (next) {
  this.slug = this.name.toLowerCase().replace(/\s+/g, '-');
  next();
});

planSchema.index({ isActive: 1, sortOrder: 1 });

const Plan = mongoose.model('Plan', planSchema);
export default Plan;
