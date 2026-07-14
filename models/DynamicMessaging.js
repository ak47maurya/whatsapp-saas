import mongoose from 'mongoose';

const dynamicMessagingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  template: { type: String, required: true },
  filePath: { type: String },
  instance: { type: mongoose.Schema.Types.ObjectId, ref: 'Instance' },
  delay: {
    type: { type: String, enum: ['fixed', 'random'], default: 'fixed' },
    value: { type: Number, default: 2000 },
    min: { type: Number, default: 1000 },
    max: { type: Number, default: 5000 },
  },
  totalContacts: { type: Number, default: 0 },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['draft', 'pending', 'processing', 'completed', 'cancelled'],
    default: 'draft',
  },
  contacts: [{
    phone: String,
    variables: { type: mongoose.Schema.Types.Mixed },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
    error: String,
    sentAt: Date,
  }],
}, { timestamps: true });

export default mongoose.model('DynamicMessaging', dynamicMessagingSchema);
