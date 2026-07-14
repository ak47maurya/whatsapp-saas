import fs from 'fs/promises';
import path from 'path';
import config from '../config/index.js';
import MediaFile from '../models/MediaFile.js';
import logger from '../utils/logger.js';

const RETENTION_DAYS = 15;

const mediaDir = path.join(config.rootDir, 'public', 'media');

export const initMediaDir = async () => {
  const dirs = ['image', 'video', 'audio', 'document', 'sticker', 'thumb'];
  for (const d of dirs) {
    await fs.mkdir(path.join(mediaDir, d), { recursive: true });
  }
};

const getExtension = (mimeType) => {
  const map = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
    'video/mp4': '.mp4', 'video/3gpp': '.3gp',
    'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
    'application/pdf': '.pdf', 'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/plain': '.txt', 'application/zip': '.zip',
  };
  return map[mimeType] || '';
};

export const saveMedia = async ({ userId, instanceId, messageId, direction, mediaType, mimeType, buffer, fileName, caption, from, to }) => {
  try {
    const ext = getExtension(mimeType) || path.extname(fileName || '') || '.bin';
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const subDir = ['image', 'video', 'audio', 'document', 'sticker'].includes(mediaType) ? mediaType : 'document';
    const filePath = path.join(subDir, safeName);
    const fullPath = path.join(mediaDir, filePath);
    const urlPath = filePath.replace(/\\/g, '/');

    await fs.writeFile(fullPath, buffer);

    const fileSize = buffer.length;
    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const doc = await MediaFile.create({
      user: userId,
      instance: instanceId,
      message: messageId,
      direction,
      mediaType,
      mimeType,
      fileName: fileName || safeName,
      fileSize,
      filePath,
      url: `/media/${urlPath}`,
      caption: caption || '',
      from: from || '',
      to: to || '',
      expiresAt,
    });

    return doc;
  } catch (err) {
    logger.error('Failed to save media:', err);
    return null;
  }
};


