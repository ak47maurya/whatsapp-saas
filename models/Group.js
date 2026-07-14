import mongoose from 'mongoose';

const groupSchema = new mongoose.Schema({
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
  name: {
    type: String,
    required: true,
  },
  jid: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  subjectOwner: String,
  subjectTime: Date,
  size: {
    type: Number,
    default: 0,
  },
  members: [{
    jid: String,
    name: String,
    phone: String,
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member',
    },
  }],
  profilePicture: {
    type: String,
    default: null,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

groupSchema.index({ user: 1, instance: 1 });
groupSchema.index({ jid: 1 });

const Group = mongoose.model('Group', groupSchema);
export default Group;
