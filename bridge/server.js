const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const db = require('./db');

const PORT = process.env.PORT || 3000;
const AUTH_DIR = path.join(__dirname, 'auth_info');
const MEDIA_DIR = path.join(__dirname, 'media');

if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

let sock = null;
let currentQR = null;
let currentQRDataUrl = null;
let connectionStatus = 'initializing';
const sseClients = [];

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      // client disconnected
    }
  }
}

async function startWhatsAppBridge() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  connectionStatus = 'connecting';
  broadcastSSE('status', { status: connectionStatus });

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    browser: ['MacBook Pro', 'Chrome', '124.0.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      currentQRDataUrl = await QRCode.toDataURL(qr);
      connectionStatus = 'qr_ready';
      console.log('\n[!] Scan this QR code in WhatsApp on your phone:');
      console.log('    Settings -> Linked Devices -> Link a Device\n');
      qrcodeTerminal.generate(qr, { small: true });
      broadcastSSE('status', { status: 'qr_ready', qr: currentQRDataUrl });
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      currentQR = null;
      currentQRDataUrl = null;
      console.log('\n[+] WhatsApp Live Bridge successfully connected!');
      console.log(`[+] Dashboard live at: http://localhost:${PORT}\n`);
      broadcastSSE('status', { status: 'connected' });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[!] Connection closed. Reason: ${statusCode || 'unknown'}. Reconnecting: ${shouldReconnect}`);
      connectionStatus = 'disconnected';
      broadcastSSE('status', { status: 'disconnected' });

      if (shouldReconnect) {
        setTimeout(startWhatsAppBridge, 3000);
      } else {
        console.log('[!] Device logged out. Cleaning up credentials for re-link...');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(startWhatsAppBridge, 1000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      if (!msg.message) continue;

      const chatJid = msg.key.remoteJid;
      if (!chatJid || chatJid === 'status@broadcast') continue;

      const fromMe = Boolean(msg.key.fromMe);
      const senderJid = fromMe ? 'Me' : (msg.key.participant || chatJid);
      const senderName = msg.pushName || (fromMe ? 'Me' : '');
      const timestamp = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);

      let messageType = 'text';
      let messageText = '';
      let mediaPath = null;
      let mediaMimetype = null;

      const content = msg.message;

      if (content.conversation) {
        messageText = content.conversation;
      } else if (content.extendedTextMessage?.text) {
        messageText = content.extendedTextMessage.text;
      } else if (content.audioMessage) {
        messageType = 'voice_note';
        mediaMimetype = content.audioMessage.mimetype || 'audio/ogg; codecs=opus';
        messageText = content.audioMessage.ptt ? '[Voice Note]' : '[Audio File]';
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {});
          const fileName = `${msg.key.id}.opus`;
          const filePath = path.join(MEDIA_DIR, fileName);
          fs.writeFileSync(filePath, buffer);
          mediaPath = `/media/${fileName}`;
        } catch (err) {
          console.error(`[!] Failed to download voice note ${msg.key.id}:`, err.message);
        }
      } else if (content.imageMessage) {
        messageType = 'image';
        messageText = content.imageMessage.caption ? `[Photo] ${content.imageMessage.caption}` : '[Photo]';
      } else if (content.videoMessage) {
        messageType = 'video';
        messageText = content.videoMessage.caption ? `[Video] ${content.videoMessage.caption}` : '[Video]';
      } else if (content.documentMessage) {
        messageType = 'document';
        messageText = `[Document: ${content.documentMessage.fileName || 'file'}]`;
      } else if (content.stickerMessage) {
        messageType = 'sticker';
        messageText = '[Sticker]';
      } else {
        messageText = '[Media / Notification]';
      }

      // Save message
      const savedMsg = {
        id: msg.key.id,
        chat_jid: chatJid,
        sender_jid: senderJid,
        sender_name: senderName,
        from_me: fromMe,
        timestamp,
        message_type: messageType,
        text: messageText,
        media_path: mediaPath,
        media_mimetype: mediaMimetype
      };

      db.saveMessage(savedMsg);
      db.saveChat(chatJid, senderName || null, messageText, timestamp);

      // Notify connected web dashboards
      broadcastSSE('new_message', { chatJid, message: savedMsg });
    }
  });
}

// Setup Express App
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(MEDIA_DIR));

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    status: connectionStatus,
    qr: currentQRDataUrl
  });
});

app.get('/api/chats', (req, res) => {
  res.json(db.getChats());
});

app.get('/api/messages/:jid', (req, res) => {
  const jid = req.params.jid;
  res.json(db.getMessages(jid));
});

app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);
  res.write(`event: status\ndata: ${JSON.stringify({ status: connectionStatus, qr: currentQRDataUrl })}\n\n`);

  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

app.post('/api/logout', (req, res) => {
  if (sock) {
    sock.logout().catch(() => {});
  }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  res.json({ success: true, message: 'Logged out. Ready to re-link.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[+] Headless WhatsApp Web Server running at http://localhost:${PORT}`);
  startWhatsAppBridge();
});
