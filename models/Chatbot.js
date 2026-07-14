import mongoose from 'mongoose';

const chatbotSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  instance: { type: mongoose.Schema.Types.ObjectId, ref: 'Instance', required: true },
  name: { type: String, required: true },
  keywords: [{ type: String }],
  matchType: { type: String, enum: ['exact', 'contains', 'regex'], default: 'contains' },
  response: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

chatbotSchema.index({ user: 1, instance: 1 });

export default mongoose.model('Chatbot', chatbotSchema);