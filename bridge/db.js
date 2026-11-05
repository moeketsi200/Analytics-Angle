const { DatabaseSync } = require('node:sqlite');

const MAX_MESSAGES = 5000;

function createDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;

    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message TEXT,
      last_timestamp INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      sender_jid TEXT,
      sender_name TEXT,
      from_me INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL,
      message_type TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      media_path TEXT,
      media_mimetype TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_jid, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(timestamp);
  `);

  const insertChat = db.prepare(`
    INSERT INTO chats (jid, name, last_message, last_timestamp)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
      name = COALESCE(chats.name, excluded.name),
      last_message = excluded.last_message,
      last_timestamp = excluded.last_timestamp;
  `);
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages
      (id, chat_jid, sender_jid, sender_name, from_me, timestamp, message_type, text, media_path, media_mimetype)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);
  const getChats = db.prepare('SELECT * FROM chats ORDER BY last_timestamp DESC LIMIT 500;');
  const getMessages = db.prepare('SELECT * FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT 1000;');
  const getStats = db.prepare(`
    SELECT COUNT(*) AS total_messages,
      COUNT(DISTINCT chat_jid) AS total_chats,
      SUM(CASE WHEN message_type = 'voice_note' THEN 1 ELSE 0 END) AS voice_notes
    FROM messages;
  `);
  const oldMessages = db.prepare(`
    SELECT id, media_path FROM messages
    ORDER BY timestamp DESC, rowid DESC
    LIMIT -1 OFFSET ${MAX_MESSAGES};
  `);
  const deleteMessage = db.prepare('DELETE FROM messages WHERE id = ?;');
  const updateMedia = db.prepare('UPDATE messages SET media_path = ?, media_mimetype = ? WHERE id = ?;');
  const clearMedia = db.prepare('UPDATE messages SET media_path = NULL, media_mimetype = NULL WHERE media_path = ?;');
  const updateChatName = db.prepare('UPDATE chats SET name = ? WHERE jid = ?;');
  const trimChats = db.prepare('DELETE FROM chats WHERE jid NOT IN (SELECT DISTINCT chat_jid FROM messages);');

  return {
    saveChat(jid, name, lastMessage, lastTimestamp) {
      insertChat.run(jid, name || null, String(lastMessage || '').slice(0, 4096), lastTimestamp || Math.floor(Date.now() / 1000));
    },
    saveChatName(jid, name) {
      if (jid && name) updateChatName.run(String(name).slice(0, 256), jid);
    },
    saveMessage(message) {
      const result = insertMessage.run(
        message.id,
        message.chat_jid,
        message.sender_jid,
        String(message.sender_name || '').slice(0, 256),
        message.from_me ? 1 : 0,
        message.timestamp,
        message.message_type,
        String(message.text || '').slice(0, 4096),
        message.media_path || null,
        message.media_mimetype || null,
      );
      const removed = [];
      for (const old of oldMessages.all()) {
        removed.push(old);
        deleteMessage.run(old.id);
      }
      if (removed.length) trimChats.run();
      return { inserted: result.changes > 0, removed };
    },
    setMediaPath(id, fileName, mimeType) {
      updateMedia.run(fileName, mimeType, id);
    },
    clearMediaPath(fileName) {
      clearMedia.run(fileName);
    },
    getChats() {
      return getChats.all();
    },
    getMessages(chatJid) {
      return getMessages.all(chatJid).reverse();
    },
    getStats() {
      return getStats.get();
    },
    close() {
      db.close();
    },
  };
}

module.exports = { createDatabase };
