import mongoose from 'mongoose';

const mediaFileSchema = new mongoose.Schema({
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
  message: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null,
  },
  direction: {
    type: String,
    enum: ['incoming', 'outgoing'],
    required: true,
  },
  mediaType: {
    type: String,
    enum: ['image', 'video', 'audio', 'document', 'sticker'],
    required: true,
  },
  mimeType: {
    type: String,
    default: '',
  },
  fileName: {
    type: String,
    default: '',
  },
  fileSize: {
    type: Number,
    default: 0,
  },
  filePath: {
    type: String,
    required: true,
  },
  url: {
    type: String,
    default: '',
  },
  thumbPath: {
    type: String,
    default: '',
  },
  caption: {
    type: String,
    default: '',
  },
  from: {
    type: String,
    default: '',
  },
  to: {
    type: String,
    default: '',
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

mediaFileSchema.index({ user: 1, mediaType: 1, createdAt: -1 });
mediaFileSchema.index({ instance: 1, mediaType: 1 });
mediaFileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
mediaFileSchema.index({ direction: 1 });

const MediaFile = mongoose.model('MediaFile', mediaFileSchema);
export default MediaFile;
