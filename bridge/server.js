const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, '.data');
const AUTH_DIR = path.join(ROOT, 'auth_info');
const MEDIA_DIR = path.join(DATA_DIR, 'voice-notes');
const PORT = Number.parseInt(process.env.BRIDGE_PORT || '3000', 10);
const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
const MAX_AUDIO_FILE_BYTES = 8 * 1024 * 1024;
const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const logger = pino({ level: 'silent' });

const loopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
if (!loopback && BRIDGE_TOKEN.length < 32) {
  console.error('Refusing non-local bind: set BRIDGE_TOKEN to a random value of at least 32 characters.');
  process.exit(1);
}

let db;
let sock;
let currentQRDataUrl = null;
let connectionStatus = 'starting';
let reconnectTimer;
let connecting = false;
let baileysApi;

async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

function authMiddleware(req, res, next) {
  if (loopback && !BRIDGE_TOKEN) return next();
  const header = req.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? Buffer.from(header.slice(7)) : Buffer.alloc(0);
  const expected = Buffer.from(BRIDGE_TOKEN);
  if (!supplied.length || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Bridge access token required.' });
  }
  next();
}

function getText(content) {
  if (content.conversation) return ['text', content.conversation];
  if (content.extendedTextMessage?.text) return ['text', content.extendedTextMessage.text];
  if (content.imageMessage) return ['image', content.imageMessage.caption ? `[Photo] ${content.imageMessage.caption}` : '[Photo]'];
  if (content.videoMessage) return ['video', content.videoMessage.caption ? `[Video] ${content.videoMessage.caption}` : '[Video]'];
  if (content.audioMessage) {
    return content.audioMessage.ptt ? ['voice_note', '[Voice note]'] : ['audio', '[Audio file]'];
  }
  if (content.documentMessage) return ['document', `[Document: ${content.documentMessage.fileName || 'file'}]`];
  if (content.stickerMessage) return ['sticker', '[Sticker]'];
  if (content.locationMessage || content.liveLocationMessage) return ['location', '[Location]'];
  if (content.contactMessage || content.contactsArrayMessage) return ['contact', '[Contact]'];
  if (content.pollCreationMessage || content.pollCreationMessageV3) return ['poll', '[Poll]'];
  if (content.reactionMessage) return ['reaction', `[Reaction: ${content.reactionMessage.text || 'removed'}]`];
  return ['message', '[Message]'];
}

function safeMediaName(message) {
  const identifier = `${message.key?.remoteJid || ''}:${message.key?.id || crypto.randomUUID()}`;
  return `${crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 32)}.opus`;
}

async function pruneMedia() {
  const entries = await fs.readdir(MEDIA_DIR, { withFileTypes: true });
  const files = [];
  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{32}\.opus$/.test(entry.name)) continue;
    const filePath = path.join(MEDIA_DIR, entry.name);
    const stat = await fs.stat(filePath);
    files.push({ filePath, name: entry.name, size: stat.size, modified: stat.mtimeMs });
    totalBytes += stat.size;
  }
  files.sort((a, b) => a.modified - b.modified);
  while (totalBytes > MAX_MEDIA_BYTES && files.length) {
    const oldest = files.shift();
    await fs.unlink(oldest.filePath).catch(() => {});
    db.clearMediaPath(oldest.name);
    totalBytes -= oldest.size;
  }
}

async function storeVoiceNote(message, normalizedContent) {
  const audio = normalizedContent?.audioMessage;
  if (!audio?.ptt || Number(audio.fileLength || 0) > MAX_AUDIO_FILE_BYTES) return;

  const fileName = safeMediaName(message);
  const filePath = path.join(MEDIA_DIR, fileName);
  try {
    const stream = await baileysApi.downloadMediaMessage(message, 'stream', {}, {
      logger,
      reuploadRequest: (originalMessage) => sock.updateMediaMessage(originalMessage),
    });
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > MAX_AUDIO_FILE_BYTES) {
        stream.destroy();
        return;
      }
      chunks.push(chunk);
    }
    if (!total) return;
    await fs.writeFile(filePath, Buffer.concat(chunks), { mode: 0o600 });
    db.setMediaPath(message.key.id, fileName, 'audio/ogg');
    await pruneMedia();
  } catch (error) {
    console.error(`Could not save voice note ${message.key?.id || '(unknown id)'}: ${error.message}`);
  }
}

function saveIncomingMessage(message, normalizedContent) {
  const chatJid = message.key?.remoteJid;
  if (!chatJid || chatJid === 'status@broadcast' || chatJid.endsWith('@broadcast')) return;

  const [messageType, text] = getText(normalizedContent || {});
  const timestamp = Number(message.messageTimestamp) || Math.floor(Date.now() / 1000);
  const fromMe = Boolean(message.key?.fromMe);
  const senderJid = fromMe ? 'Me' : (message.key?.participant || chatJid);
  const senderName = message.pushName || (fromMe ? 'Me' : '');
  const id = message.key?.id || crypto.randomUUID();
  const savedMessage = {
    id,
    chat_jid: chatJid,
    sender_jid: senderJid,
    sender_name: senderName,
    from_me: fromMe,
    timestamp,
    message_type: messageType,
    text: String(text).slice(0, 4096),
    media_path: null,
    media_mimetype: null,
  };

  const result = db.saveMessage(savedMessage);
  for (const removed of result.removed) {
    if (removed.media_path) fs.unlink(path.join(MEDIA_DIR, removed.media_path)).catch(() => {});
  }
  if (!result.inserted) return;
  const fallbackChatName = chatJid.endsWith('@g.us') ? null : senderName;
  db.saveChat(chatJid, fallbackChatName || null, savedMessage.text, timestamp);

  if (messageType === 'voice_note') {
    storeVoiceNote(message, normalizedContent).catch((error) => {
      console.error(`Voice note processing failed: ${error.message}`);
    });
  }
}

async function startWhatsAppBridge() {
  if (connecting) return;
  connecting = true;
  try {
    const baileys = await import('@whiskeysockets/baileys');
    baileysApi = baileys;
    const { state, saveCreds } = await baileys.useMultiFileAuthState(AUTH_DIR);
    connectionStatus = 'connecting';

    sock = baileys.default({
      auth: state,
      logger,
      shouldSyncHistoryMessage: () => false,
    });
    connecting = false;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        currentQRDataUrl = await QRCode.toDataURL(qr);
        connectionStatus = 'qr_ready';
        console.log('\nScan this QR in WhatsApp → Settings → Linked devices → Link a device:\n');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('\nThe QR code grants access to the account. Do not share it.\n');
      }
      if (connection === 'open') {
        connectionStatus = 'connected';
        currentQRDataUrl = null;
        console.log('WhatsApp linked. New live messages will appear in the dashboard.');
      }
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
        connectionStatus = loggedOut ? 'logged-out' : 'disconnected';
        currentQRDataUrl = null;
        console.error(`WhatsApp connection closed (${statusCode || 'unknown'}).`);
        if (!loggedOut) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            startWhatsAppBridge().catch((error) => console.error(`Reconnect failed: ${error.message}`));
          }, 3000);
        } else {
          console.error('The linked device was logged out. Auth data was kept; remove auth_info manually only to relink.');
        }
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type, requestId }) => {
      // Keep this a live bridge: do not import history or process history requests.
      if (type !== 'notify' || requestId) return;
      for (const message of messages) {
        if (!message.message) continue;
        const normalized = baileys.normalizeMessageContent(message.message);
        saveIncomingMessage(message, normalized);
      }
    });

    sock.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) db.saveChatName(chat.id, chat.name);
    });
    sock.ev.on('chats.update', (chats) => {
      for (const chat of chats) db.saveChatName(chat.id, chat.name);
    });
    sock.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        db.saveChatName(contact.id, contact.name || contact.pushName || contact.verifiedName);
      }
    });
    sock.ev.on('groups.upsert', (groups) => {
      for (const group of groups) db.saveChatName(group.id, group.subject);
    });
    sock.ev.on('groups.update', (groups) => {
      for (const group of groups) db.saveChatName(group.id, group.subject);
    });
  } catch (error) {
    connecting = false;
    connectionStatus = 'disconnected';
    console.error(`Could not connect to WhatsApp: ${error.message}`);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      startWhatsAppBridge().catch((retryError) => console.error(`Reconnect failed: ${retryError.message}`));
    }, 5000);
  }
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(ROOT, 'public')));
  app.use('/api', authMiddleware);

  app.get('/api/status', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: connectionStatus, qr: currentQRDataUrl });
  });
  app.get('/api/chats', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(db.getChats());
  });
  app.get('/api/messages/:jid', (req, res) => {
    res.set('Cache-Control', 'no-store').json(db.getMessages(req.params.jid));
  });
  app.get('/api/media/:file', async (req, res) => {
    const fileName = req.params.file;
    if (!/^[a-f0-9]{32}\.opus$/.test(fileName)) return res.sendStatus(404);
    const filePath = path.join(MEDIA_DIR, fileName);
    try {
      await fs.access(filePath);
      res.set({ 'Content-Type': 'audio/ogg', 'Cache-Control': 'private, no-store' });
      return res.sendFile(filePath);
    } catch {
      return res.sendStatus(404);
    }
  });
  app.use('/api', (_req, res) => res.sendStatus(404));
  return app;
}

async function main() {
  await privateDirectory(DATA_DIR);
  await privateDirectory(AUTH_DIR);
  await privateDirectory(MEDIA_DIR);
  const { createDatabase } = require('./db');
  db = createDatabase(path.join(DATA_DIR, 'live_chats.db'));
  await fs.chmod(path.join(DATA_DIR, 'live_chats.db'), 0o600).catch(() => {});

  const app = createApp();
  const server = app.listen(PORT, HOST, () => {
    const displayHost = loopback ? '127.0.0.1' : HOST;
    console.log(`Dashboard: http://${displayHost}:${PORT}`);
    console.log(`Saved messages: ${db.getStats().total_messages || 0}; voice-note storage cap: ${MAX_MEDIA_BYTES / 1024 / 1024} MiB.`);
    if (!loopback) console.log('Remote bind enabled. Access only through a trusted encrypted VPN or HTTPS proxy.');
    startWhatsAppBridge();
  });
  server.on('error', (error) => {
    console.error(`Dashboard server error: ${error.message}`);
    process.exitCode = 1;
  });
}

main().catch((error) => {
  console.error(`Could not start bridge: ${error.stack || error.message}`);
  process.exitCode = 1;
});
