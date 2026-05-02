const pool = require('../config/database');
const { generateId } = require('../utils/uuid');

const MAX_USER_MESSAGE = 2000;
const MAX_ANSWER = 16000;
const MAX_ERROR = 2000;

function parseSources(sourcesJson) {
  let sources = sourcesJson;
  if (sources && typeof sources === 'string') {
    try {
      sources = JSON.parse(sources);
    } catch {
      sources = null;
    }
  }
  return sources;
}

function deriveStatus(row) {
  const hasAnswer = Boolean(String(row.answer || '').trim());
  const hasError = Boolean(String(row.error_message || '').trim());
  if (hasAnswer) return 'done';
  if (hasError) return 'error';
  return 'pending';
}

async function createPendingGuestSupportMessage(p) {
  const id = generateId();
  const userMessage = String(p.userMessage || '').trim().slice(0, MAX_USER_MESSAGE);
  const guestKey = String(p.guestKey || '').trim().toLowerCase();
  await pool.execute(
    `INSERT INTO support_ai_messages_guest (
      id, guest_key, user_message, answer, answer_en, locale, model, sources_json, translation_fallback, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [id, guestKey, userMessage, '', null, p.locale, null, null, 0, null]
  );
  return id;
}

async function completePendingGuestSupportMessage(messageId, guestKey, p) {
  const answer = String(p.answer || '').trim().slice(0, MAX_ANSWER);
  const answerEn = p.answerEn != null ? String(p.answerEn).trim().slice(0, MAX_ANSWER) : null;
  const sourcesJson = p.sources && p.sources.length ? JSON.stringify(p.sources) : null;
  await pool.execute(
    `UPDATE support_ai_messages_guest
     SET answer = ?, answer_en = ?, locale = ?, model = ?, sources_json = ?, translation_fallback = ?, error_message = NULL, updated_at = NOW()
     WHERE id = ? AND guest_key = ?`,
    [answer, answerEn, p.locale, p.model || null, sourcesJson, p.translationFallback ? 1 : 0, messageId, guestKey]
  );
}

async function failPendingGuestSupportMessage(messageId, guestKey, errorMessage) {
  await pool.execute(
    `UPDATE support_ai_messages_guest
     SET answer = '', answer_en = NULL, model = NULL, sources_json = NULL, translation_fallback = 0, error_message = ?, updated_at = NOW()
     WHERE id = ? AND guest_key = ?`,
    [String(errorMessage || 'ai_generation_failed').slice(0, MAX_ERROR), messageId, guestKey]
  );
}

async function listGuestSupportMessages(guestKey, opts = {}) {
  const limit = Math.min(Math.max(parseInt(String(opts.limit || 50), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(opts.offset || 0), 10) || 0, 0);
  const safeLimit = Number.isFinite(limit) ? limit : 50;
  const safeOffset = Number.isFinite(offset) ? offset : 0;

  const [rows] = await pool.execute(
    `SELECT id, user_message, answer, answer_en, locale, model, sources_json, translation_fallback, error_message, created_at, updated_at
     FROM support_ai_messages_guest
     WHERE guest_key = ?
     ORDER BY created_at ASC, id ASC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [guestKey]
  );

  return rows.map((r) => {
    const sources = parseSources(r.sources_json);
    return {
      id: r.id,
      user_message: r.user_message,
      answer: r.answer,
      answer_en: r.answer_en,
      locale: r.locale,
      model: r.model,
      sources,
      translation_fallback: Boolean(r.translation_fallback),
      status: deriveStatus(r),
      error_message: r.error_message,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  });
}

async function getGuestSupportMessageById(guestKey, messageId) {
  const [rows] = await pool.execute(
    `SELECT id, user_message, answer, answer_en, locale, model, sources_json, translation_fallback, error_message, created_at, updated_at
     FROM support_ai_messages_guest
     WHERE guest_key = ? AND id = ?
     LIMIT 1`,
    [guestKey, messageId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    user_message: row.user_message,
    answer: row.answer,
    answer_en: row.answer_en,
    locale: row.locale,
    model: row.model,
    sources: parseSources(row.sources_json),
    translation_fallback: Boolean(row.translation_fallback),
    status: deriveStatus(row),
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function listRecentGuestConversationContext(guestKey, opts = {}) {
  const limit = Math.min(Math.max(parseInt(String(opts.limit || 8), 10) || 8, 1), 20);
  const excludeMessageId = opts.excludeMessageId ? String(opts.excludeMessageId).trim() : null;
  const [rows] = await pool.execute(
    `SELECT id, user_message, answer, locale, created_at
     FROM support_ai_messages_guest
     WHERE guest_key = ?
       AND COALESCE(TRIM(answer), '') <> ''
       AND COALESCE(TRIM(error_message), '') = ''
       ${excludeMessageId ? 'AND id <> ?' : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit}`,
    excludeMessageId ? [guestKey, excludeMessageId] : [guestKey]
  );
  return rows
    .map((row) => ({
      id: row.id,
      user_message: row.user_message,
      answer: row.answer,
      locale: row.locale,
      created_at: row.created_at
    }))
    .reverse();
}

async function countGuestSupportMessages(guestKey) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS c FROM support_ai_messages_guest WHERE guest_key = ?',
    [guestKey]
  );
  return Number(rows[0].c) || 0;
}

async function clearGuestSupportMessages(guestKey) {
  const [result] = await pool.execute(
    'DELETE FROM support_ai_messages_guest WHERE guest_key = ?',
    [guestKey]
  );
  return Number(result.affectedRows) || 0;
}

module.exports = {
  createPendingGuestSupportMessage,
  completePendingGuestSupportMessage,
  failPendingGuestSupportMessage,
  getGuestSupportMessageById,
  listRecentGuestConversationContext,
  listGuestSupportMessages,
  countGuestSupportMessages,
  clearGuestSupportMessages
};
