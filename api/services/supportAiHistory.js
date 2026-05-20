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

function toIsoDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  return s || null;
}

function mapUserRow(r) {
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
    created_at: toIsoDate(r.created_at),
    updated_at: toIsoDate(r.updated_at)
  };
}

/**
 * @param {Object} p
 * @param {string} p.userId
 * @param {string} p.userMessage
 * @param {string} p.answer
 * @param {string} [p.answerEn]
 * @param {string} p.locale
 * @param {string} [p.model]
 * @param {string[]|null} p.sources
 * @param {boolean} [p.translationFallback]
 * @param {string|null} [p.errorMessage]
 */
async function saveSupportMessage(p) {
  const id = generateId();
  const userMessage = String(p.userMessage || '').trim().slice(0, MAX_USER_MESSAGE);
  const answer = String(p.answer || '').trim().slice(0, MAX_ANSWER);
  const answerEn = p.answerEn != null ? String(p.answerEn).trim().slice(0, MAX_ANSWER) : null;
  const sourcesJson = p.sources && p.sources.length ? JSON.stringify(p.sources) : null;

  await pool.execute(
    `INSERT INTO support_ai_messages (
      id, user_id, user_message, answer, answer_en, locale, model, sources_json, translation_fallback, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      id,
      p.userId,
      userMessage,
      answer,
      answerEn,
      p.locale,
      p.model || null,
      sourcesJson,
      p.translationFallback ? 1 : 0,
      p.errorMessage != null ? String(p.errorMessage).slice(0, 2000) : null
    ]
  );
  return id;
}

async function createPendingSupportMessage(p) {
  const id = generateId();
  const userMessage = String(p.userMessage || '').trim().slice(0, MAX_USER_MESSAGE);
  await pool.execute(
    `INSERT INTO support_ai_messages (
      id, user_id, user_message, answer, answer_en, locale, model, sources_json, translation_fallback, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [id, p.userId, userMessage, '', null, p.locale, null, null, 0, null]
  );
  return id;
}

async function completePendingSupportMessage(messageId, userId, p) {
  const answer = String(p.answer || '').trim().slice(0, MAX_ANSWER);
  const answerEn = p.answerEn != null ? String(p.answerEn).trim().slice(0, MAX_ANSWER) : null;
  const sourcesJson = p.sources && p.sources.length ? JSON.stringify(p.sources) : null;
  await pool.execute(
    `UPDATE support_ai_messages
     SET answer = ?, answer_en = ?, locale = ?, model = ?, sources_json = ?, translation_fallback = ?, error_message = NULL, updated_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [answer, answerEn, p.locale, p.model || null, sourcesJson, p.translationFallback ? 1 : 0, messageId, userId]
  );
}

async function failPendingSupportMessage(messageId, userId, errorMessage) {
  await pool.execute(
    `UPDATE support_ai_messages
     SET answer = '', answer_en = NULL, model = NULL, sources_json = NULL, translation_fallback = 0, error_message = ?, updated_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [String(errorMessage || 'ai_generation_failed').slice(0, MAX_ERROR), messageId, userId]
  );
}

/**
 * @param {string} userId
 * @param {{ limit?: number, offset?: number }} [opts]
 */
async function listSupportMessages(userId, opts = {}) {
  const limit = Math.min(Math.max(parseInt(String(opts.limit || 50), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(opts.offset || 0), 10) || 0, 0);
  const safeLimit = Number.isFinite(limit) ? limit : 50;
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const order = String(opts.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const [rows] = await pool.execute(
    `SELECT id, user_message, answer, answer_en, locale, model, sources_json, translation_fallback, error_message, created_at, updated_at
     FROM support_ai_messages
     WHERE user_id = ?
     ORDER BY created_at ${order}, id ${order}
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [userId]
  );

  const mapped = rows.map(mapUserRow);
  if (order === 'DESC') {
    mapped.reverse();
  }
  return mapped;
}

async function getSupportMessageById(userId, messageId) {
  const [rows] = await pool.execute(
    `SELECT id, user_message, answer, answer_en, locale, model, sources_json, translation_fallback, error_message, created_at, updated_at
     FROM support_ai_messages
     WHERE user_id = ? AND id = ?
     LIMIT 1`,
    [userId, messageId]
  );
  if (!rows.length) return null;
  return mapUserRow(rows[0]);
}

async function listRecentSupportConversationContext(userId, opts = {}) {
  const limit = Math.min(Math.max(parseInt(String(opts.limit || 8), 10) || 8, 1), 20);
  const excludeMessageId = opts.excludeMessageId ? String(opts.excludeMessageId).trim() : null;
  const [rows] = await pool.execute(
    `SELECT id, user_message, answer, locale, created_at
     FROM support_ai_messages
     WHERE user_id = ?
       AND COALESCE(TRIM(answer), '') <> ''
       AND COALESCE(TRIM(error_message), '') = ''
       ${excludeMessageId ? 'AND id <> ?' : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit}`,
    excludeMessageId ? [userId, excludeMessageId] : [userId]
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

/**
 * @param {string} userId
 */
async function countSupportMessages(userId) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS c FROM support_ai_messages WHERE user_id = ?',
    [userId]
  );
  const raw = rows[0]?.c ?? 0;
  const n = typeof raw === 'bigint' ? Number(raw) : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function clearSupportMessages(userId) {
  const [result] = await pool.execute(
    'DELETE FROM support_ai_messages WHERE user_id = ?',
    [userId]
  );
  return Number(result.affectedRows) || 0;
}

module.exports = {
  saveSupportMessage,
  createPendingSupportMessage,
  completePendingSupportMessage,
  failPendingSupportMessage,
  getSupportMessageById,
  listRecentSupportConversationContext,
  listSupportMessages,
  countSupportMessages,
  clearSupportMessages
};
