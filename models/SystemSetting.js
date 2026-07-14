import mongoose from 'mongoose';

const systemSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  group: {
    type: String,
    enum: ['general', 'email', 'payment', 'limits', 'security', 'features', 'maintenance'],
    default: 'general',
  },
  type: {
    type: String,
    enum: ['string', 'number', 'boolean', 'json', 'array'],
    default: 'string',
  },
  isPublic: {
    type: Boolean,
    default: false,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true,
});

systemSettingSchema.index({ group: 1 });

const SystemSetting = mongoose.model('SystemSetting', systemSettingSchema);
export default SystemSetting;
