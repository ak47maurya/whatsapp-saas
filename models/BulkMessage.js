import mongoose from 'mongoose';

const bulkMessageSchema = new mongoose.Schema({
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
  messageType: { type: String, default: 'text' },
  content: {
    text: String,
    caption: String,
    mediaUrl: String,
    mediaPath: String,
  },
  delay: { type: Number, default: 2000 },
  totalRecipients: { type: Number, required: true },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  pendingCount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'cancelled'],
    default: 'pending',
  },
  recipients: [{
    phone: String,
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
    error: String,
    sentAt: Date,
  }],
}, { timestamps: true });

bulkMessageSchema.index({ user: 1, createdAt: -1 });

const BulkMessage = mongoose.model('BulkMessage', bulkMessageSchema);
export default BulkMessage;
