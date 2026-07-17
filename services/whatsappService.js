import baileysLogger from '@whiskeysockets/baileys/lib/Utils/logger.js';
// Suppress Baileys internal decrypt errors for status@broadcast
baileysLogger.level = 'silent';

import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  isLidUser,
  isPnUser,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs/promises';
import qrcode from 'qrcode';
import config from '../config/index.js';
import Instance from '../models/Instance.js';
import Message from '../models/Message.js';
import logger from '../utils/logger.js';
import { getRedisClient } from '../config/redis.js';
import { getIO } from '../sockets/index.js';
import { triggerWebhook } from './webhookService.js';
import { processAutoReply } from './autoReplyService.js';

const activeConnections = new Map();
const connectionLocks = new Map();
const reconnectAttempts = new Map();
const connectionStableSince = new Map();

export const getAuthPath = (instanceId) => {
  return path.join(config.rootDir, config.baileys.authDir, String(instanceId));
};

export const getConnectionKey = (instanceId) => {
  return `wa:connection:${instanceId}`;
};

export const generateQR = async (instanceId) => {
  const strId = String(instanceId);

  if (connectionLocks.get(strId)) {
    throw new Error('Connection already in progress');
  }

  connectionLocks.set(strId, true);

  try {
    const instance = await Instance.findById(instanceId);
    if (!instance) throw new Error('Instance not found');

    const authPath = getAuthPath(strId);
    await fs.mkdir(authPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    // Close existing connection if any before creating new one
    const existing = activeConnections.get(strId);
    if (existing?.socket) {
      try { existing.socket.end(undefined); } catch {}
      try { existing.socket.ws?.close(); } catch {}
      activeConnections.delete(strId);
    }

    const sock = makeWASocket({
      version,
      browser: Browsers.windows('Chrome'),
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: config.baileys.syncFullHistory,
      markOnlineOnConnect: true,
      logger: baileysLogger,
      generateHighQualityLink: true,
      shouldReconnect: () => false,
    });

    instance.status = 'connecting';
    instance.qrCode = {
      attempts: (instance.qrCode?.attempts || 0) + 1,
    };
    await instance.save();

    sock.ev.on('creds.update', saveCreds);

    // Wait for QR or timeout (30s)
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('QR generation timed out after 30s'));
      }, 30000);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
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
              instanceId: strId,
              qr: qrBase64,
              attempts: instance.qrCode.attempts,
            });
          }
          resolve({ status: 'qr_ready', qr: qrBase64 });
        }

        if (connection === 'open') {
          clearTimeout(timeout);
          connectionStableSince.set(strId, Date.now());
          const profile = {
            name: sock.user?.name || '',
            about: '',
            picture: '',
            phone: sock.user?.id?.split(':')[0] || '',
          };

          instance.status = 'connected';
          instance.phone = profile.phone;
          instance.profile = profile;
          instance.lastConnected = new Date();
          instance.qrCode = undefined;
          await instance.save();

          activeConnections.set(strId, { socket: sock });

          const redisKey = getConnectionKey(strId);
          const redis = getRedisClient();
          await redis.set(redisKey, 'connected', 'EX', 86400);

          const io = getIO();
          if (io) {
            io.to(`user:${instance.user}`).emit('instance:connected', {
              instanceId: strId,
              phone: profile.phone,
            });
          }

          await triggerWebhook(instance.user, instance._id, 'instance.connected', {
            instanceId: strId,
            phone: profile.phone,
          });

          logger.info(`Instance ${strId} connected`);
          resolve({ status: 'connected' });
        }

        if (connection === 'close') {
          clearTimeout(timeout);

          // Log actual disconnect reason
          let reasonCode = 'unknown';
          let reasonMsg = 'Unknown';
          if (lastDisconnect?.error instanceof Boom) {
            reasonCode = lastDisconnect.error?.output?.statusCode;
            reasonMsg = DisconnectReason[reasonCode] || `Code ${reasonCode}`;
          } else if (lastDisconnect?.error) {
            reasonMsg = lastDisconnect.error.message || String(lastDisconnect.error);
          }
          logger.info(`Instance ${strId} disconnected — reason: ${reasonMsg}`);

          const isLoggedOut = lastDisconnect?.error instanceof Boom
            && lastDisconnect.error?.output?.statusCode === DisconnectReason.loggedOut;

          if (!isLoggedOut) {
            instance.status = 'disconnected';
            instance.lastDisconnected = new Date();
            await instance.save();
            activeConnections.delete(strId);

            const io = getIO();
            if (io) {
              io.to(`user:${instance.user}`).emit('instance:disconnected', {
                instanceId: strId,
              });
            }

            await triggerWebhook(instance.user, instance._id, 'instance.disconnected', {
              instanceId: strId,
            });

            // Track flapping — reset counter only if connection was stable 30+ sec
            const stableSince = connectionStableSince.get(strId);
            const wasStable = stableSince && (Date.now() - stableSince > 30000);
            if (!wasStable && reconnectAttempts.has(strId)) {
              // keep existing counter (flapping)
            } else {
              reconnectAttempts.delete(strId);
            }
            connectionStableSince.delete(strId);

            const attempt = (reconnectAttempts.get(strId) || 0) + 1;
            reconnectAttempts.set(strId, attempt);

            // After 3 rapid disconnects, stop & set error
            if (attempt > 3) {
              instance.status = 'error';
              instance.lastDisconnected = new Date();
              await instance.save();
              logger.info(`Instance ${strId} flapping — stopped after ${attempt} disconnects. Set status to error.`);
              reconnectAttempts.delete(strId);
              reject(new Error(`Connection unstable (${reasonMsg}). Retry manually.`));
              return;
            }

            const delay = Math.min(10000 * attempt, 60000); // exponential backoff: 10s, 20s, 30s max 60s
            logger.info(`Instance ${strId} reconnecting in ${delay}ms (attempt ${attempt})...`);

            if (instance.settings?.autoReconnect !== false) {
              setTimeout(() => {
                generateQR(strId).catch(err => {
                  logger.error(`Reconnect failed for ${strId}: ${err.message}`);
                });
              }, delay);
            }
            reject(new Error(`Connection closed: ${reasonMsg}`));
          } else {
            reconnectAttempts.delete(strId);
            instance.status = 'disconnected';
            instance.lastDisconnected = new Date();
            await instance.save();
            activeConnections.delete(strId);
            logger.info(`Instance ${strId} logged out`);
            reject(new Error('Logged out'));
          }
        }
      });

      sock.ev.on('messages.upsert', async (msgEvent) => {
        const { messages, type } = msgEvent;
        if (type !== 'notify') return;

        for (const msg of messages) {
          try {
            const isFromMe = msg.key?.fromMe;
            const remoteJid = msg.key?.remoteJid;
            const msgType = getMessageType(msg.message);

            if (!remoteJid || !msg.message) continue;

            // Skip status broadcasts, newsletters, and status/story messages
            if (remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter') || remoteJid === 'status' || remoteJid.startsWith('status@')) continue;
            if (msgType === 'protocol' || msgType === 'unknown') continue;

            // Resolve LID to phone number for display
            let displayFrom = remoteJid;
            if (isLidUser(remoteJid)) {
              try {
                const pnUser = await sock.signalRepository?.lidMapping?.getPNForLID(remoteJid);
                if (pnUser) displayFrom = pnUser + '@s.whatsapp.net';
              } catch {}
            }

            const ownPhone = sock.authState?.creds?.me?.id?.split(':')[0]?.split('@')[0] || instance.phone || sock.user?.id?.split(':')[0] || '';
            const messageData = {
              user: instance.user,
              instance: instance._id,
              messageType: msgType,
              direction: isFromMe ? 'outgoing' : 'incoming',
              from: isFromMe ? ownPhone : displayFrom,
              to: isFromMe ? remoteJid : ownPhone,
              content: extractContent(msg.message),
              status: isFromMe ? 'sent' : 'received',
              sentAt: isFromMe ? new Date() : undefined,
            };

            const savedMsg = await Message.create(messageData);

            // Log incoming message
            if (!isFromMe) {
              const hasMedia = ['image','video','audio','document','sticker'].includes(msgType);
              console.log(`\n📩 INCOMING ${msgType.toUpperCase()} from ${messageData.from}`);
              console.log(JSON.stringify({
                id: savedMsg._id,
                from: messageData.from,
                to: messageData.to,
                type: msgType,
                caption: messageData.content?.caption || '',
                text: messageData.content?.text || '',
                hasMedia,
                mediaUrl: messageData.content?.mediaUrl || '(not downloading)',
                status: messageData.status,
                instance: savedMsg.instance,
              }, null, 2));
            }

            // Save media attachment to disk
            try {
              if (['image','video','audio','document','sticker'].includes(msgType)) {
                await saveMediaForMessage(sock, msg, savedMsg);
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

            // Chatbot auto-reply for incoming individual messages
            const isUser = isPnUser(remoteJid) || isLidUser(remoteJid);
            if (!isFromMe && isUser) {
              const msgText = extractContent(msg.message)?.text || extractContent(msg.message)?.caption || '';
              processAutoReply(instance, remoteJid, msgText, sock).catch(err => {
                logger.error(`Chatbot error for ${strId}: ${err.message}`);
              });
            }

            const io = getIO();
            if (io) {
              io.to(`user:${instance.user}`).emit('message:new', savedMsg);
            }

            await triggerWebhook(instance.user, instance._id, 'message.received', savedMsg);
          } catch (err) {
            logger.error('Message processing error:', err);
          }
        }
      });

      sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
          try {
            const statusMap = {
              'read': 'read',
              'delivered': 'delivered',
              'sent': 'sent',
            };

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
            logger.error('Message update error:', err);
          }
        }
      });
    });

    return instance;
  } catch (error) {
    connectionLocks.delete(strId);
    logger.error(`QR generation error for ${strId}:`, error);
    throw error;
  } finally {
    connectionLocks.delete(strId);
  }
};

export const disconnectInstance = async (instanceId) => {
  const strId = String(instanceId);
  const connection = activeConnections.get(strId);

  if (connection) {
    try {
      connection.socket?.end(undefined);
      connection.socket?.ws?.close();
    } catch {}
    activeConnections.delete(strId);
  }

  const redis = getRedisClient();
  await redis.del(getConnectionKey(strId));

  const instance = await Instance.findById(instanceId);
  if (instance) {
    instance.status = 'disconnected';
    instance.lastDisconnected = new Date();
    await instance.save();
  }
};

export const logoutInstance = async (instanceId) => {
  const strId = String(instanceId);
  const connection = activeConnections.get(strId);

  if (connection) {
    try {
      connection.socket?.logout('Logged out by user');
      connection.socket?.end(undefined);
    } catch {}
    activeConnections.delete(strId);
  }

  const authPath = getAuthPath(strId);
  try {
    await fs.rm(authPath, { recursive: true, force: true });
  } catch {}

  const instance = await Instance.findById(instanceId);
  if (instance) {
    instance.status = 'disconnected';
    instance.authData = { creds: null, keys: null };
    instance.lastDisconnected = new Date();
    await instance.save();
  }

  const redis = getRedisClient();
  await redis.del(getConnectionKey(strId));
};

export const getSocket = (instanceId) => {
  const connection = activeConnections.get(String(instanceId));
  if (connection?.socket) return connection.socket;
  return null;
};

export const resetStaleConnections = async () => {
  try {
    const staleInstances = await Instance.find({ status: 'connected', isDeleted: false });
    for (const inst of staleInstances) {
      const authPath = getAuthPath(String(inst._id));
      try {
        await fs.access(authPath);
        logger.info(`Auto-reconnecting instance ${inst._id}...`);
        generateQR(inst._id).catch(err => {
          logger.error(`Auto-reconnect failed for ${inst._id}: ${err.message}`);
          Instance.findByIdAndUpdate(inst._id, { status: 'disconnected', lastDisconnected: new Date() }).catch(() => {});
        });
        // Stagger reconnections to avoid simultaneous connections
        await new Promise(r => setTimeout(r, 3000));
      } catch {
        await Instance.findByIdAndUpdate(inst._id, { status: 'disconnected', lastDisconnected: new Date() });
        logger.info(`Marked stale instance ${inst._id} as disconnected (no auth data)`);
      }
    }
    if (staleInstances.length > 0) {
      logger.info(`Processed ${staleInstances.length} stale connection(s)`);
    }
  } catch (err) {
    logger.error('Failed to reset stale connections:', err);
  }
};

export const sendMessage = async (instanceId, to, content, type = 'text') => {
  let sock = getSocket(instanceId);
  if (!sock || sock.ws?.readyState !== 1) {
    logger.info(`sendMessage: instance ${instanceId} socket dead, attempting reconnect...`);
    activeConnections.delete(String(instanceId));
    try {
      const result = await generateQR(String(instanceId));
      if (result.status !== 'connected') {
        throw new Error('Reconnect did not return connected status');
      }
      sock = getSocket(instanceId);
      if (!sock || sock.ws?.readyState !== 1) {
        throw new Error('Socket still not connected after reconnect');
      }
      logger.info(`sendMessage: instance ${instanceId} reconnected, retrying message`);
    } catch (err) {
      await Instance.findByIdAndUpdate(instanceId, { status: 'disconnected', lastDisconnected: new Date() });
      throw new Error(`Instance not connected. Reconnect failed: ${err.message}`);
    }
  }

  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  let result;

  // Convert Google Drive share URL to direct download
  const resolveUrl = (url) => {
    if (!url) return url;
    const match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (match) return `https://drive.google.com/uc?export=download&confirm=t&id=${match[1]}`;
    return url;
  };

  // Read local file as buffer if mediaPath provided
  const getMedia = async () => {
    if (content.mediaPath) {
      try {
        const data = await fs.readFile(content.mediaPath);
        return data;
      } catch {
        // fallback to URL
      }
    }
    return content.mediaUrl ? { url: resolveUrl(content.mediaUrl) } : undefined;
  };

  const requireMedia = async () => {
    const media = await getMedia();
    if (!media) throw new Error('No media provided for ' + type + ' message. Upload a file or provide a URL.');
    return media;
  };

  switch (type) {
    case 'text':
      result = await sock.sendMessage(jid, { text: content.text });
      break;
    case 'image': {
      const img = await requireMedia();
      result = await sock.sendMessage(jid, {
        image: img,
        caption: content.caption || '',
      });
      break;
    }
    case 'video': {
      const vid = await requireMedia();
      result = await sock.sendMessage(jid, {
        video: vid,
        caption: content.caption || '',
      });
      break;
    }
    case 'audio': {
      const aud = await requireMedia();
      result = await sock.sendMessage(jid, {
        audio: aud,
        mimetype: 'audio/mp4',
      });
      break;
    }
    case 'document': {
      const doc = await requireMedia();
      result = await sock.sendMessage(jid, {
        document: doc,
        fileName: content.fileName || 'document',
        mimetype: content.mimeType || 'application/octet-stream',
        caption: content.caption || '',
      });
      break;
    }
    case 'sticker': {
      const stk = await requireMedia();
      result = await sock.sendMessage(jid, {
        sticker: stk,
      });
      break;
    }
    case 'location':
      result = await sock.sendMessage(jid, {
        location: {
          degreesLatitude: content.latitude,
          degreesLongitude: content.longitude,
        },
      });
      break;
    case 'contact':
      result = await sock.sendMessage(jid, {
        contacts: {
          displayName: content.contactName,
          contacts: [{ vcard: generateVCard(content) }],
        },
      });
      break;
    default:
      throw new Error(`Unsupported message type: ${type}`);
  }

  return { message: result, from: sock.user?.id || '' };
};

export const getConnectionStatus = async (instanceId) => {
  const sock = getSocket(instanceId);
  if (!sock) {
    return { connected: false, status: 'disconnected' };
  }

  const state = sock.ws?.readyState === 1 ? 'connected' : 'disconnected';
  return {
    connected: state === 'connected',
    status: state,
    user: sock.user,
  };
};

const saveMediaForMessage = async (sock, msg, savedMsg) => {
  try {
    const msgType = getMessageType(msg.message);
    if (!['image', 'video', 'audio', 'document', 'sticker'].includes(msgType)) return;
    const stream = await downloadMediaMessage(msg, 'buffer', { sock, logger: logger.child({ level: 'silent' }) });
    if (!stream) return;
    const buf = Buffer.isBuffer(stream) ? stream : Buffer.from(stream);
    const sub = msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage || msg.message?.stickerMessage || {};
    const mimeType = sub.mimetype || '';
    const fileName = sub.fileName || '';
    const caption = sub.caption || '';
    const { saveMedia } = await import('./mediaStorage.js');
    const mediaDoc = await saveMedia({
      userId: savedMsg.user,
      instanceId: savedMsg.instance,
      messageId: savedMsg._id,
      direction: savedMsg.direction,
      mediaType: msgType,
      mimeType,
      buffer: buf,
      fileName,
      caption,
      from: savedMsg.from,
      to: savedMsg.to,
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
    logger.error(`Media save error: ${err.message}`);
  }
};

const getMessageType = (message) => {
  if (!message) return 'text';
  if (message.conversation || message.extendedTextMessage) return 'text';
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage) return 'audio';
  if (message.documentMessage) return 'document';
  if (message.stickerMessage) return 'sticker';
  if (message.locationMessage) return 'location';
  if (message.contactMessage) return 'contact';
  if (message.reactionMessage) return 'reaction';
  if (message.protocolMessage || message.senderKeyDistributionMessage || message.stickerPackMessage || message.messageContextInfo) return 'protocol';
  return 'unknown';
};

const extractContent = (message) => {
  if (!message) return { text: '' };
  if (message.conversation) return { text: message.conversation };
  if (message.extendedTextMessage) return { text: message.extendedTextMessage.text };
  if (message.imageMessage) return { caption: message.imageMessage.caption || '', mediaUrl: '', mimeType: message.imageMessage.mimetype || '' };
  if (message.videoMessage) return { caption: message.videoMessage.caption || '', mediaUrl: '', mimeType: message.videoMessage.mimetype || '' };
  if (message.documentMessage) return { caption: message.documentMessage.caption || '', fileName: message.documentMessage.fileName || '', mediaUrl: '', mimeType: message.documentMessage.mimetype || '' };
  if (message.audioMessage) return { mediaUrl: '', mimeType: message.audioMessage.mimetype || '' };
  if (message.stickerMessage) return { mediaUrl: '', mimeType: message.stickerMessage.mimetype || '' };
  return { text: '' };
};

const generateVCard = (contact) => {
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${contact.contactName || 'Contact'}`,
    `TEL;TYPE=CELL:${contact.contactPhone || ''}`,
    'END:VCARD',
  ].join('\n');
};

export const getActiveConnectionCount = () => activeConnections.size;

export const startHealthCheck = () => {
  setInterval(async () => {
    for (const [strId, conn] of activeConnections.entries()) {
      try {
        const sock = conn?.socket;
        if (sock && sock.ws?.readyState !== 1) {
          logger.info(`Health check: instance ${strId} socket dead, cleaning up`);
          activeConnections.delete(strId);
          const redis = getRedisClient();
          await redis.del(getConnectionKey(strId));
          const instance = await Instance.findById(strId);
          if (instance && instance.status === 'connected') {
            instance.status = 'disconnected';
            instance.lastDisconnected = new Date();
            await instance.save();
            if (instance.settings?.autoReconnect !== false) {
              generateQR(strId).catch(err => {
                logger.error(`Health check reconnect failed for ${strId}: ${err.message}`);
              });
            }
          }
        }
      } catch {}
    }
  }, 30000);
};
