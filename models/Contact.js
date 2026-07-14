import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    trim: true,
    default: '',
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
  }],
  groups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
  }],
  notes: {
    type: String,
    default: '',
  },
  countryCode: {
    type: String,
    default: '',
  },
  profilePicture: {
    type: String,
    default: null,
  },
  isBlocked: {
    type: Boolean,
    default: false,
  },
  isWhatsAppContact: {
    type: Boolean,
    default: true,
  },
  lastMessageAt: {
    type: Date,
    default: null,
  },
  messageCount: {
    type: Number,
    default: 0,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

contactSchema.index({ user: 1, phone: 1 }, { unique: true });
contactSchema.index({ user: 1, tags: 1 });
contactSchema.index({ user: 1, isDeleted: 1 });

const Contact = mongoose.model('Contact', contactSchema);
export default Contact;
