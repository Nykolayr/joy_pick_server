const pool = require('../config/database');
const { generateId } = require('../utils/uuid');

function ownerKeyForUser(userId) {
  return `user:${String(userId || '').trim()}`;
}

function ownerKeyForGuest(guestKey) {
  return `guest:${String(guestKey || '').trim().toLowerCase()}`;
}

function newOpenRouterChatSessionId() {
  return `support-chat-${generateId()}`;
}

/**
 * Текущая сессия OpenRouter для активного чата: одна на owner до clear history.
 */
async function getOrCreateOpenRouterSessionIdForUser(userId) {
  const ownerKey = ownerKeyForUser(userId);
  const [rows] = await pool.execute(
    'SELECT session_id FROM support_ai_openrouter_session WHERE owner_key = ? LIMIT 1',
    [ownerKey]
  );
  if (rows.length && rows[0].session_id) {
    return String(rows[0].session_id);
  }
  const sessionId = newOpenRouterChatSessionId();
  await pool.execute(
    'INSERT INTO support_ai_openrouter_session (owner_key, session_id) VALUES (?, ?)',
    [ownerKey, sessionId]
  );
  return sessionId;
}

async function getOrCreateOpenRouterSessionIdForGuest(guestKey) {
  const ownerKey = ownerKeyForGuest(guestKey);
  const [rows] = await pool.execute(
    'SELECT session_id FROM support_ai_openrouter_session WHERE owner_key = ? LIMIT 1',
    [ownerKey]
  );
  if (rows.length && rows[0].session_id) {
    return String(rows[0].session_id);
  }
  const sessionId = newOpenRouterChatSessionId();
  await pool.execute(
    'INSERT INTO support_ai_openrouter_session (owner_key, session_id) VALUES (?, ?)',
    [ownerKey, sessionId]
  );
  return sessionId;
}

async function clearOpenRouterSessionForUser(userId) {
  const [result] = await pool.execute(
    'DELETE FROM support_ai_openrouter_session WHERE owner_key = ?',
    [ownerKeyForUser(userId)]
  );
  return Number(result.affectedRows) || 0;
}

async function clearOpenRouterSessionForGuest(guestKey) {
  const [result] = await pool.execute(
    'DELETE FROM support_ai_openrouter_session WHERE owner_key = ?',
    [ownerKeyForGuest(guestKey)]
  );
  return Number(result.affectedRows) || 0;
}

module.exports = {
  getOrCreateOpenRouterSessionIdForUser,
  getOrCreateOpenRouterSessionIdForGuest,
  clearOpenRouterSessionForUser,
  clearOpenRouterSessionForGuest
};
