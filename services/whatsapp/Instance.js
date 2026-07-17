import baileysLogger from '@whiskeysockets/baileys/lib/Utils/logger.js';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs/promises';
import qrcode from 'qrcode';
import config from '../../config/index.js';
import Instance from '../../models/Instance.js';
import Message from '../../models/Message.js';
import logger from '../../utils/logger.js';
import { getRedisClient } from '../../config/redis.js';
import { getIO } from '../../sockets/index.js';
import { triggerWebhook } from '../webhookService.js';
import { processAutoReply } from '../autoReplyService.js';
import { getMessageType } from './messageTypes.js';
import { saveMedia } from '../mediaStorage.js';
import { isLidUser } from '@whiskeysockets/baileys';

baileysLogger.level = 'silent';

class WhatsAppInstance {
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.strId = String(instanceId);
    this.sock = null;
    this.authState = null;
    this.saveCreds = null;
    this.connectedSince = null;
    this._initLock = false;
    this._disconnectTimestamps = [];
    this._reconnectTimer = null;
  }

  get authPath() {
    return path.join(config.rootDir, config.baileys.authDir, this.strId);
  }

  get redisKey() {
    return `wa:connection:${this.strId}`;
  }

  async init(forQR = false) {
    if (this._initLock) {
      throw new Error('Connection already in progress');
    }
    this._initLock = true;

    return new Promise(async (resolve, reject) => {
      try {
        const instance = await Instance.findById(this.instanceId);
        if (!instance) throw new Error('Instance not found');

        await fs.mkdir(this.authPath, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
        this.authState = state;
        this.saveCreds = saveCreds;

        const { version } = await fetchLatestBaileysVersion();

        if (this.sock) {
          try { this.sock.end(undefined); } catch {}
          try { this.sock.ws?.close(); } catch {}
        }

        this.sock = makeWASocket({
          version,
          browser: Browsers.windows('Chrome'),
          auth: this.authState,
          printQRInTerminal: false,
          syncFullHistory: config.baileys.syncFullHistory,
          markOnlineOnConnect: true,
          logger: baileysLogger,
          generateHighQualityLink: true,
          shouldReconnect: () => false,
        });

        instance.status = 'connecting';
        instance.qrCode = forQR ? { attempts: (instance.qrCode?.attempts || 0) + 1 } : undefined;
        await instance.save();

        this.sock.ev.on('creds.update', saveCreds);

        const timeout = setTimeout(() => {
          this._initLock = false;
          reject(new Error('Connection timed out after 30s'));
        }, 30000);

        this.sock.ev.on('connection.update', async (update) => {
          const { connection, lastDisconnect, qr } = update;

          if (qr && forQR) {
            clearTimeout(timeout);
            const qrBase64 = await qrcode.toDataURL(qr);
            instance.qrCode = {
              code: qrBase64,
              generatedAt: new Date(),
              expiresAt: new Date(Date.now() + 60000),
              attempts: instance.qrCode?.attempts || 0,
            };
            instance.status = 'qr_ready';
            await instance.save();

            const io = getIO();
            if (io) {
              io.to(`user:${instance.user}`).emit('instance:qr', {
                instanceId: this.strId, qr: qrBase64, attempts: instance.qrCode.attempts,
              });
            }

            await triggerWebhook(instance.user, instance._id, 'instance.qr', { instanceId: this.strId });
            this._initLock = false;
            resolve({ status: 'qr_ready', qr: qrBase64 });
          }

          if (connection === 'open') {
            clearTimeout(timeout);
            this.connectedSince = Date.now();
            await this._onConnected(instance);
            this._initLock = false;
            resolve({ status: 'connected' });
          }

          if (connection === 'close') {
            clearTimeout(timeout);
            this._initLock = false;

            const reasonCode = lastDisconnect?.error instanceof Boom
              ? (lastDisconnect.error?.output?.statusCode || 'unknown') : 'unknown';
            const reasonMsg = lastDisconnect?.error instanceof Boom
              ? (DisconnectReason[reasonCode] || `Code ${reasonCode}`)
              : (lastDisconnect?.error?.message || 'Unknown');

            logger.info(`Instance ${this.strId} disconnected — reason: ${reasonMsg}`);

            const isLoggedOut = lastDisconnect?.error instanceof Boom
              && lastDisconnect.error?.output?.statusCode === DisconnectReason.loggedOut;

            if (isLoggedOut) {
              instance.status = 'disconnected';
              instance.lastDisconnected = new Date();
              await instance.save();
              this.sock = null;
              const io = getIO();
              if (io) {
                io.to(`user:${instance.user}`).emit('instance:disconnected', {
                  instanceId: this.strId, reason: 'logged_out',
                });
              }
              reject(new Error('Logged out'));
              return;
            }

            instance.status = 'disconnected';
            instance.lastDisconnected = new Date();
            await instance.save();
            this.sock = null;

            const io = getIO();
            if (io) {
              io.to(`user:${instance.user}`).emit('instance:disconnected', {
                instanceId: this.strId, reason: reasonMsg,
              });
            }

            await triggerWebhook(instance.user, instance._id, 'instance.disconnected', {
              instanceId: this.strId, reason: reasonMsg,
            });

            const redis = getRedisClient();
            await redis.del(this.redisKey);

            const now = Date.now();
            this._disconnectTimestamps.push(now);
            this._disconnectTimestamps = this._disconnectTimestamps.filter(t => now - t < 60000);

            if (this._disconnectTimestamps.length > 5) {
              instance.status = 'error';
              instance.lastDisconnected = new Date();
              await instance.save();
              logger.info(`Instance ${this.strId} flapping — stopped after ${this._disconnectTimestamps.length} disconnects in 60s`);
              this._disconnectTimestamps = [];
              reject(new Error(`Connection unstable (${reasonMsg}). Retry manually.`));
              return;
            }

            if (instance.settings?.autoReconnect !== false) {
              const delay = 2000;
              logger.info(`Instance ${this.strId} reconnecting in ${delay}ms...`);
              this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this.init(false).catch(err => {
                  logger.error(`Reconnect failed for ${this.strId}: ${err.message}`);
                });
              }, delay);
            }
            reject(new Error(`Connection closed: ${reasonMsg}`));
          }
        });

        this.sock.ev.on('messages.upsert', async (msgEvent) => {
          await this._handleMessages(msgEvent);
        });

        this.sock.ev.on('messages.update', async (updates) => {
          await this._handleMessageUpdates(updates);
        });
      } catch (err) {
        this._initLock = false;
        reject(err);
      }
    });
  }

  async _onConnected(instance) {
    let picture = '';
    try {
      const ppUrl = await this.sock?.profilePictureUrl(this.sock?.user?.id, 'image');
      picture = ppUrl || '';
    } catch {}

    const profile = {
      name: this.sock?.user?.name || '',
      about: '',
      picture,
      phone: this.sock?.user?.id?.split(':')[0] || '',
    };

    instance.status = 'connected';
    instance.phone = profile.phone;
    instance.profile = profile;
    instance.lastConnected = new Date();
    instance.qrCode = undefined;
    await instance.save();

    const redis = getRedisClient();
    await redis.set(this.redisKey, 'connected', 'EX', 86400);

    const io = getIO();
    if (io) {
      io.to(`user:${instance.user}`).emit('instance:connected', {
        instanceId: this.strId, phone: profile.phone, profile,
      });
    }

    await triggerWebhook(instance.user, instance._id, 'instance.connected', {
      instanceId: this.strId, phone: profile.phone,
    });

    logger.info(`Instance ${this.strId} connected`);
  }

  async _handleMessages(msgEvent) {
    const { messages, type } = msgEvent;
    if (type !== 'notify') return;

    const instance = await Instance.findById(this.instanceId);
    if (!instance) return;

    for (const msg of messages) {
      try {
        const isFromMe = msg.key?.fromMe;
        const remoteJid = msg.key?.remoteJid;

        if (!remoteJid || !msg.message) continue;
        if (remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter') || remoteJid === 'status' || remoteJid.startsWith('status@')) continue;

        const msgType = getMessageType(msg.message);
        if (msgType === 'protocol' || msgType === 'unknown') continue;

        let displayFrom = remoteJid;
        if (isLidUser(remoteJid)) {
          try {
            const pnUser = await this.sock?.signalRepository?.lidMapping?.getPNForLID(remoteJid);
            if (pnUser) displayFrom = pnUser + '@s.whatsapp.net';
          } catch {}
        }
        const ownPhone = this.sock?.authState?.creds?.me?.id?.split(':')[0]?.split('@')[0] || instance.phone || this.sock?.user?.id?.split(':')[0] || '';

        const messageData = {
          user: instance.user,
          instance: instance._id,
          messageType: msgType,
          direction: isFromMe ? 'outgoing' : 'incoming',
          from: isFromMe ? ownPhone : displayFrom,
          to: isFromMe ? remoteJid : ownPhone,
          content: this._extractContent(msg.message),
          status: isFromMe ? 'sent' : 'received',
          sentAt: isFromMe ? new Date() : undefined,
        };

        const savedMsg = await Message.create(messageData);

        try {
          if (['image', 'video', 'audio', 'document', 'sticker'].includes(msgType)) {
            await this._saveMediaForMessage(msg, savedMsg);
            const updated = await Message.findById(savedMsg._id).lean();
            if (updated?.content?.mediaUrl) {
              savedMsg.content.mediaUrl = updated.content.mediaUrl;
              savedMsg.content.fileName = updated.content.fileName;
              savedMsg.content.mimeType = updated.content.mimeType;
            }
          }
        } catch (err) {
          logger.error('Media save error:', err);
        }

        if (!isFromMe) {
          const msgText = this._extractContent(msg.message)?.text || this._extractContent(msg.message)?.caption || '';
          processAutoReply(instance, remoteJid, msgText, this.sock).catch(err => {
            logger.error(`Chatbot error for ${this.strId}: ${err.message}`);
          });
        }

        const io = getIO();
        if (io) {
          io.to(`user:${instance.user}`).emit('message:new', savedMsg);
        }

        await triggerWebhook(instance.user, instance._id, 'message.received', savedMsg);
      } catch (err) {
        logger.error(`Message handling error for ${this.strId}:`, err.message);
      }
    }
  }

  async _handleMessageUpdates(updates) {
    const instance = await Instance.findById(this.instanceId);
    if (!instance) return;

    for (const update of updates) {
      try {
        const statusMap = { 'read': 'read', 'delivered': 'delivered', 'sent': 'sent' };
        const newStatus = statusMap[update.status];
        if (newStatus) {
          const msgKey = update.key?.id;
          if (msgKey) {
            const updatedMsg = await Message.findOneAndUpdate(
              { 'metadata.keyId': msgKey },
              {
                status: newStatus,
                ...(newStatus === 'delivered' ? { deliveredAt: new Date() } : {}),
                ...(newStatus === 'read' ? { readAt: new Date() } : {}),
              },
              { new: true }
            );

            if (updatedMsg) {
              const io = getIO();
              if (io) {
                io.to(`user:${instance.user}`).emit('message:update', updatedMsg);
              }
              if (newStatus === 'delivered') {
                await triggerWebhook(instance.user, instance._id, 'message.delivered', updatedMsg).catch(() => {});
              }
            }
          }
        }
      } catch (err) {
        logger.error(`Message update error for ${this.strId}:`, err.message);
      }
    }
  }

  async sendMessage(to, content, type = 'text') {
    if (!this.sock) {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      logger.info(`sendMessage: instance ${this.strId} socket dead, attempting reconnect...`);
      try {
        await this.init(false);
      } catch (err) {
        await Instance.findByIdAndUpdate(this.instanceId, { status: 'disconnected', lastDisconnected: new Date() });
        throw new Error(`Instance not connected. Reconnect failed: ${err.message}`);
      }
    }

    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

    const resolveUrl = (url) => {
      if (!url) return url;
      const match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
      if (match) return `https://drive.google.com/uc?export=download&confirm=t&id=${match[1]}`;
      return url;
    };

    const getMedia = async () => {
      if (content.mediaPath) {
        try {
          const data = await fs.readFile(content.mediaPath);
          return data;
        } catch {}
      }
      return content.mediaUrl ? { url: resolveUrl(content.mediaUrl) } : undefined;
    };

    const requireMedia = async () => {
      const media = await getMedia();
      if (!media) throw new Error('No media provided for ' + type + ' message. Upload a file or provide a URL.');
      return media;
    };

    let result;
    switch (type) {
      case 'text':
        result = await this.sock.sendMessage(jid, { text: content.text });
        break;
      case 'image': {
        const img = await requireMedia();
        result = await this.sock.sendMessage(jid, { image: img, caption: content.caption || '' });
        break;
      }
      case 'video': {
        const vid = await requireMedia();
        result = await this.sock.sendMessage(jid, { video: vid, caption: content.caption || '' });
        break;
      }
      case 'audio': {
        const aud = await requireMedia();
        result = await this.sock.sendMessage(jid, { audio: aud, mimetype: 'audio/mp4' });
        break;
      }
      case 'document': {
        const doc = await requireMedia();
        result = await this.sock.sendMessage(jid, {
          document: doc, fileName: content.fileName || 'document',
          mimetype: content.mimeType || 'application/octet-stream', caption: content.caption || '',
        });
        break;
      }
      case 'sticker': {
        const stk = await requireMedia();
        result = await this.sock.sendMessage(jid, { sticker: stk });
        break;
      }
      case 'location':
        result = await this.sock.sendMessage(jid, {
          location: { degreesLatitude: content.latitude, degreesLongitude: content.longitude },
        });
        break;
      case 'contact':
        result = await this.sock.sendMessage(jid, {
          contacts: { displayName: content.contactName, contacts: [{ vcard: this._generateVCard(content) }] },
        });
        break;
      default:
        throw new Error(`Unsupported message type: ${type}`);
    }

    return { message: result, from: this.sock?.user?.id || '' };
  }

  async disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    try {
      this.sock?.end(undefined);
      this.sock?.ws?.close();
    } catch {}
    this.sock = null;
    this.connectedSince = null;

    const redis = getRedisClient();
    await redis.del(this.redisKey);

    await Instance.findByIdAndUpdate(this.instanceId, { status: 'disconnected', lastDisconnected: new Date() });
  }

  async logout() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    try {
      this.sock?.logout('Logged out by user');
      this.sock?.end(undefined);
    } catch {}
    this.sock = null;
    this.connectedSince = null;

    const authPath = this.authPath;
    try { await fs.rm(authPath, { recursive: true, force: true }); } catch {}

    const redis = getRedisClient();
    await redis.del(this.redisKey);

    await Instance.findByIdAndUpdate(this.instanceId, {
      status: 'disconnected', authData: { creds: null, keys: null }, lastDisconnected: new Date(),
    });
  }

  getConnectionStatus() {
    if (!this.sock) return { connected: false, status: 'disconnected' };
    const state = this.sock.ws?.readyState === 1 ? 'connected' : 'disconnected';
    return { connected: state === 'connected', status: state, user: this.sock.user };
  }

  async _saveMediaForMessage(msg, savedMsg) {
    try {
      const msgType = getMessageType(msg.message);
      if (!['image', 'video', 'audio', 'document', 'sticker'].includes(msgType)) return;
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
      const stream = await downloadMediaMessage(msg, 'buffer', { sock: this.sock, logger: baileysLogger });
      if (!stream) return;
      const buf = Buffer.isBuffer(stream) ? stream : Buffer.from(stream);
      const sub = msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage || msg.message?.stickerMessage || {};
      const mimeType = sub.mimetype || '';
      const fileName = sub.fileName || '';
      const mediaDoc = await saveMedia({
        userId: savedMsg.user, instanceId: savedMsg.instance, messageId: savedMsg._id,
        direction: savedMsg.direction, mediaType: msgType, mimeType, buffer: buf,
        fileName, from: savedMsg.from, to: savedMsg.to,
      });
      if (mediaDoc) {
        await Message.findByIdAndUpdate(savedMsg._id, {
          $set: {
            'content.mediaUrl': config.app.url + mediaDoc.url,
            'content.fileName': fileName || mediaDoc.fileName,
            'content.mimeType': mimeType || mediaDoc.mimeType,
          },
        });
      }
    } catch (err) {
      logger.error(`Media save error for ${this.strId}: ${err.message}`);
    }
  }

  _extractContent(message) {
    if (!message) return { text: '' };
    if (message.conversation) return { text: message.conversation };
    if (message.extendedTextMessage) return { text: message.extendedTextMessage.text };
    if (message.imageMessage) return { caption: message.imageMessage.caption || '', mediaUrl: '', mimeType: message.imageMessage.mimetype || '' };
    if (message.videoMessage) return { caption: message.videoMessage.caption || '', mediaUrl: '', mimeType: message.videoMessage.mimetype || '' };
    if (message.documentMessage) return { caption: message.documentMessage.caption || '', fileName: message.documentMessage.fileName || '', mediaUrl: '', mimeType: message.documentMessage.mimetype || '' };
    if (message.audioMessage) return { mediaUrl: '', mimeType: message.audioMessage.mimetype || '' };
    if (message.stickerMessage) return { mediaUrl: '', mimeType: message.stickerMessage.mimetype || '' };
    return { text: '' };
  }

  _generateVCard(contact) {
    return [
      'BEGIN:VCARD', 'VERSION:3.0',
      `FN:${contact.contactName || 'Contact'}`,
      `TEL;TYPE=CELL:${contact.contactPhone || ''}`,
      'END:VCARD',
    ].join('\n');
  }
}

export default WhatsAppInstance;
