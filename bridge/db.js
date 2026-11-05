const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, 'live_chats.db');
const db = new DatabaseSync(DB_PATH);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY,
    name TEXT,
    last_message TEXT,
    last_timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_jid TEXT,
    sender_jid TEXT,
    sender_name TEXT,
    from_me INTEGER,
    timestamp INTEGER,
    message_type TEXT,
    text TEXT,
    media_path TEXT,
    media_mimetype TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_jid, timestamp);
`);

const stmtInsertChat = db.prepare(`
  INSERT INTO chats (jid, name, last_message, last_timestamp)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(jid) DO UPDATE SET
    name = COALESCE(excluded.name, chats.name),
    last_message = excluded.last_message,
    last_timestamp = excluded.last_timestamp;
`);

const stmtInsertMessage = db.prepare(`
  INSERT OR IGNORE INTO messages (id, chat_jid, sender_jid, sender_name, from_me, timestamp, message_type, text, media_path, media_mimetype)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`);

const stmtGetChats = db.prepare(`
  SELECT * FROM chats ORDER BY last_timestamp DESC;
`);

const stmtGetMessages = db.prepare(`
  SELECT * FROM messages WHERE chat_jid = ? ORDER BY timestamp ASC;
`);

const stmtGetStats = db.prepare(`
  SELECT 
    COUNT(*) as total_messages,
    COUNT(DISTINCT chat_jid) as total_chats,
    SUM(CASE WHEN message_type = 'voice_note' THEN 1 ELSE 0 END) as voice_notes,
    SUM(CASE WHEN message_type = 'text' THEN 1 ELSE 0 END) as text_messages
  FROM messages;
`);

module.exports = {
  saveChat: (jid, name, lastMessage, lastTimestamp) => {
    stmtInsertChat.run(jid, name || null, lastMessage || '', lastTimestamp || Math.floor(Date.now() / 1000));
  },
  saveMessage: (msg) => {
    stmtInsertMessage.run(
      msg.id,
      msg.chat_jid,
      msg.sender_jid,
      msg.sender_name || '',
      msg.from_me ? 1 : 0,
      msg.timestamp,
      msg.message_type,
      msg.text || '',
      msg.media_path || null,
      msg.media_mimetype || null
    );
  },
  getChats: () => stmtGetChats.all(),
  getMessages: (chatJid) => stmtGetMessages.all(chatJid),
  getStats: () => stmtGetStats.get()
};
