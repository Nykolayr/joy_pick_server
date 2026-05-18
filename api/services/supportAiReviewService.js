const pool = require('../config/database');
const { generateId } = require('../utils/uuid');

const STATUSES = ['draft', 'pending_review', 'fixed'];

function parseHistory(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeSources(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((x) => String(x || '').trim()).filter(Boolean);
  }
  return [];
}

function normalizeRound(input = {}) {
  return {
    question: String(input.question || '').trim(),
    ai_answer: String(input.ai_answer ?? input.aiAnswer ?? '').trim(),
    ai_sources: normalizeSources(input.ai_sources ?? input.aiSources),
    admin_remark: input.admin_remark != null ? String(input.admin_remark).trim() : null,
    answer_after_fix: input.answer_after_fix != null ? String(input.answer_after_fix).trim() : null,
    sources_after_fix: normalizeSources(input.sources_after_fix ?? input.sourcesAfterFix),
    fix_notes: input.fix_notes != null ? String(input.fix_notes).trim() : null,
    verified_at: input.verified_at || null,
    model: input.model != null ? String(input.model).trim() : null
  };
}

function getLastRound(history) {
  if (!history.length) return null;
  return history[history.length - 1];
}

function rowToListItem(row) {
  const history = parseHistory(row.history_json);
  const last = getLastRound(history);
  return {
    id: row.id,
    status: row.status,
    locale: row.locale,
    round_count: history.length,
    last_question: last?.question || null,
    last_admin_remark: last?.admin_remark || null,
    has_answer_after_fix: Boolean(last?.answer_after_fix),
    created_by_admin_id: row.created_by_admin_id,
    fixed_at: row.fixed_at,
    fixed_by: row.fixed_by,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function rowToDetail(row) {
  const history = parseHistory(row.history_json);
  return {
    id: row.id,
    status: row.status,
    locale: row.locale,
    history,
    current_round: getLastRound(history),
    created_by_admin_id: row.created_by_admin_id,
    fixed_at: row.fixed_at,
    fixed_by: row.fixed_by,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function listTickets({ status, limit = 50, offset = 0 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const params = [];
  let where = '';
  if (status && STATUSES.includes(status)) {
    where = 'WHERE status = ?';
    params.push(status);
  }
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM support_ai_review_tickets ${where}`,
    params
  );
  const [rows] = await pool.execute(
    `SELECT * FROM support_ai_review_tickets ${where}
     ORDER BY updated_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );
  return {
    total: Number(countRows[0]?.total || 0),
    items: rows.map(rowToListItem)
  };
}

async function getTicketById(id) {
  const [rows] = await pool.execute('SELECT * FROM support_ai_review_tickets WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) return null;
  return rowToDetail(rows[0]);
}

async function createTicket(adminId, payload) {
  const locale = String(payload.locale || 'ru').trim();
  const round = normalizeRound({
    question: payload.question,
    ai_answer: payload.ai_answer,
    ai_sources: payload.ai_sources,
    model: payload.model
  });
  if (!round.question) {
    const err = new Error('question is required');
    err.statusCode = 400;
    throw err;
  }
  if (!round.ai_answer) {
    const err = new Error('ai_answer is required');
    err.statusCode = 400;
    throw err;
  }
  const id = generateId();
  const history = [round];
  await pool.execute(
    `INSERT INTO support_ai_review_tickets
      (id, status, locale, history_json, created_by_admin_id)
     VALUES (?, 'draft', ?, ?, ?)`,
    [id, locale, JSON.stringify(history), adminId]
  );
  return getTicketById(id);
}

async function updateDraftTicket(id, adminId, payload) {
  const [rows] = await pool.execute('SELECT * FROM support_ai_review_tickets WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) {
    const err = new Error('Ticket not found');
    err.statusCode = 404;
    throw err;
  }
  const row = rows[0];
  if (row.status !== 'draft') {
    const err = new Error('Only draft tickets can be updated');
    err.statusCode = 400;
    throw err;
  }
  const history = parseHistory(row.history_json);
  if (!history.length) {
    const err = new Error('Ticket has no history rounds');
    err.statusCode = 400;
    throw err;
  }
  const last = normalizeRound(history[history.length - 1]);
  if (payload.question !== undefined) last.question = String(payload.question).trim();
  if (payload.ai_answer !== undefined) last.ai_answer = String(payload.ai_answer).trim();
  if (payload.ai_sources !== undefined) last.ai_sources = normalizeSources(payload.ai_sources);
  if (payload.model !== undefined) last.model = payload.model != null ? String(payload.model).trim() : null;
  if (payload.locale !== undefined) {
    row.locale = String(payload.locale).trim();
  }
  if (!last.question || !last.ai_answer) {
    const err = new Error('question and ai_answer are required');
    err.statusCode = 400;
    throw err;
  }
  history[history.length - 1] = last;
  await pool.execute(
    `UPDATE support_ai_review_tickets
     SET locale = ?, history_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [row.locale, JSON.stringify(history), id]
  );
  return getTicketById(id);
}

async function submitForReview(id, adminId, adminRemark) {
  const remark = String(adminRemark || '').trim();
  if (!remark) {
    const err = new Error('admin_remark is required');
    err.statusCode = 400;
    throw err;
  }
  const [rows] = await pool.execute('SELECT * FROM support_ai_review_tickets WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) {
    const err = new Error('Ticket not found');
    err.statusCode = 404;
    throw err;
  }
  const row = rows[0];
  if (row.status !== 'draft') {
    const err = new Error('Only draft tickets can be submitted for review');
    err.statusCode = 400;
    throw err;
  }
  const history = parseHistory(row.history_json);
  const last = getLastRound(history);
  if (!last) {
    const err = new Error('Ticket has no history rounds');
    err.statusCode = 400;
    throw err;
  }
  last.admin_remark = remark;
  history[history.length - 1] = last;
  await pool.execute(
    `UPDATE support_ai_review_tickets
     SET status = 'pending_review', history_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(history), id]
  );
  return getTicketById(id);
}

async function reopenTicket(id, adminId, payload) {
  const remark = String(payload.admin_remark || '').trim();
  if (!remark) {
    const err = new Error('admin_remark is required');
    err.statusCode = 400;
    throw err;
  }
  const [rows] = await pool.execute('SELECT * FROM support_ai_review_tickets WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) {
    const err = new Error('Ticket not found');
    err.statusCode = 404;
    throw err;
  }
  const row = rows[0];
  if (row.status !== 'fixed') {
    const err = new Error('Only fixed tickets can be reopened');
    err.statusCode = 400;
    throw err;
  }
  const history = parseHistory(row.history_json);
  const prev = getLastRound(history);
  const question =
    payload.question != null && String(payload.question).trim()
      ? String(payload.question).trim()
      : prev?.question || '';
  if (!question) {
    const err = new Error('question is required');
    err.statusCode = 400;
    throw err;
  }
  history.push(
    normalizeRound({
      question,
      ai_answer: prev?.answer_after_fix || prev?.ai_answer || '',
      ai_sources: prev?.sources_after_fix?.length ? prev.sources_after_fix : prev?.ai_sources || [],
      admin_remark: remark,
      model: prev?.model || null
    })
  );
  await pool.execute(
    `UPDATE support_ai_review_tickets
     SET status = 'pending_review', history_json = ?, fixed_at = NULL, fixed_by = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(history), id]
  );
  return getTicketById(id);
}

async function deleteDraftTicket(id) {
  const [result] = await pool.execute(
    `DELETE FROM support_ai_review_tickets WHERE id = ? AND status = 'draft'`,
    [id]
  );
  if (!result.affectedRows) {
    const err = new Error('Ticket not found or not a draft');
    err.statusCode = 404;
    throw err;
  }
  return { deleted: true, id };
}

async function listAgentQueue() {
  const [rows] = await pool.execute(
    `SELECT * FROM support_ai_review_tickets
     WHERE status = 'pending_review'
     ORDER BY updated_at ASC`
  );
  return rows
    .map((row) => {
      const history = parseHistory(row.history_json);
      const last = getLastRound(history);
      if (!last) return null;
      return {
        id: row.id,
        locale: row.locale,
        updated_at: row.updated_at,
        round_index: history.length - 1,
        question: last.question,
        ai_answer: last.ai_answer,
        ai_sources: last.ai_sources,
        admin_remark: last.admin_remark
      };
    })
    .filter(Boolean);
}

async function agentCompleteTicket(id, payload) {
  const answerAfterFix = String(payload.answer_after_fix || '').trim();
  if (!answerAfterFix) {
    const err = new Error('answer_after_fix is required');
    err.statusCode = 400;
    throw err;
  }
  const [rows] = await pool.execute('SELECT * FROM support_ai_review_tickets WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) {
    const err = new Error('Ticket not found');
    err.statusCode = 404;
    throw err;
  }
  const row = rows[0];
  if (row.status !== 'pending_review') {
    const err = new Error('Ticket is not pending review');
    err.statusCode = 400;
    throw err;
  }
  const history = parseHistory(row.history_json);
  const last = getLastRound(history);
  if (!last) {
    const err = new Error('Ticket has no history rounds');
    err.statusCode = 400;
    throw err;
  }
  last.answer_after_fix = answerAfterFix;
  last.sources_after_fix = normalizeSources(payload.sources_after_fix);
  if (payload.fix_notes != null) {
    last.fix_notes = String(payload.fix_notes).trim() || null;
  }
  if (payload.model != null) {
    last.model = String(payload.model).trim() || last.model;
  }
  last.verified_at = new Date().toISOString();
  history[history.length - 1] = last;
  await pool.execute(
    `UPDATE support_ai_review_tickets
     SET status = 'fixed', history_json = ?, fixed_at = CURRENT_TIMESTAMP, fixed_by = 'agent',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(history), id]
  );
  return getTicketById(id);
}

module.exports = {
  STATUSES,
  listTickets,
  getTicketById,
  createTicket,
  updateDraftTicket,
  submitForReview,
  reopenTicket,
  deleteDraftTicket,
  listAgentQueue,
  agentCompleteTicket
};
