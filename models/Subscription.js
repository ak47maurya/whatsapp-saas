import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plan',
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled', 'pending', 'trial'],
    default: 'active',
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  trialEndDate: {
    type: Date,
    default: null,
  },
  cancelledAt: {
    type: Date,
    default: null,
  },
  autoRenew: {
    type: Boolean,
    default: false,
  },
  price: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'USD',
  },
  paymentMethod: {
    type: String,
    enum: ['manual', 'stripe', 'paypal', 'razorpay', 'system'],
    default: 'manual',
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'paid',
  },
  invoiceNumber: {
    type: String,
    unique: true,
    sparse: true,
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
  },
  usage: {
    dailyMessages: { type: Number, default: 0 },
    monthlyMessages: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now },
  },
  isCustom: {
    type: Boolean,
    default: false,
  },
  notes: {
    type: String,
    default: '',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

subscriptionSchema.index({ user: 1 });
subscriptionSchema.index({ status: 1 });
subscriptionSchema.index({ endDate: 1 });
subscriptionSchema.index({ 'usage.dailyMessages': 1 });

const Subscription = mongoose.model('Subscription', subscriptionSchema);
export default Subscription;
