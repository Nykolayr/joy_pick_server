const { generateId } = require('../utils/uuid');
const { runEarthdayBulkCreateRequests, CHUNK_MAX } = require('./earthdayBulkCreateRequests');

const ASYNC_MAX_IDS = Math.min(5000, Math.max(1, parseInt(process.env.EARTHDAY_ASYNC_BULK_MAX_IDS, 10) || 2000));
const CHUNKS_PER_TICK = Math.min(50, Math.max(1, parseInt(process.env.EARTHDAY_ASYNC_JOB_CHUNKS_PER_TICK, 10) || 10));

/** Имя MySQL GET_LOCK: одна активная async-задача Earth Day bulk на весь сервис (все инстансы с общей БД). */
const ASYNC_ACTIVE_LOCK_NAME = 'joypick:earthday_bulk_async_active';
const GET_LOCK_TIMEOUT_SEC = Math.min(120, Math.max(5, parseInt(process.env.EARTHDAY_ASYNC_CREATE_LOCK_SEC, 10) || 30));

function parseJsonArray(raw) {
  if (raw == null) return { error: 'Пустой список objectid' };
  if (Array.isArray(raw)) return { ids: raw };
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? { ids: p } : { error: 'objectids должен быть JSON-массивом' };
    } catch {
      return { error: 'objectids: невалидный JSON' };
    }
  }
  return { error: 'objectids: ожидается массив' };
}

function normalizeObjectIds(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Тело: JSON-объект с полем objectids или object_ids' };
  }
  const raw = body.objectids ?? body.object_ids ?? body.ids;
  const parsed = parseJsonArray(raw);
  if (parsed.error) return parsed;
  const seen = new Set();
  const ids = [];
  for (const v of parsed.ids) {
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return { error: `Некорректный objectid: ${v}` };
    }
    if (seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  if (ids.length === 0) return { error: 'Массив objectids пуст' };
  if (ids.length > ASYNC_MAX_IDS) {
    return { error: `Слишком много objectid (максимум ${ASYNC_MAX_IDS})` };
  }
  return { ids };
}

function mergeJsonArrays(existing, delta) {
  const a = Array.isArray(existing) ? existing : [];
  const b = Array.isArray(delta) ? delta : [];
  return [...a, ...b];
}

/**
 * Создать задачу асинхронного bulk-create.
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} userId
 * @param {object} body
 */
async function createEarthdayBulkCreateJob(pool, userId, body) {
  const parsed = normalizeObjectIds(body);
  if (parsed.error) {
    const err = new Error(parsed.error);
    err.code = 'VALIDATION';
    throw err;
  }
  const ids = parsed.ids;
  const conn = await pool.getConnection();
  let lockHeld = false;
  try {
    const [lockRows] = await conn.query('SELECT GET_LOCK(?, ?) AS got', [ASYNC_ACTIVE_LOCK_NAME, GET_LOCK_TIMEOUT_SEC]);
    const got = lockRows && lockRows[0] && lockRows[0].got;
    if (got !== 1) {
      const err = new Error(
        got === 0
          ? 'Не удалось занять блокировку для постановки задачи за отведённое время. Повторите запрос.'
          : 'Ошибка блокировки при постановке задачи.'
      );
      err.code = got === 0 ? 'EARTHDAY_BULK_LOCK_TIMEOUT' : 'EARTHDAY_BULK_LOCK_ERROR';
      throw err;
    }
    lockHeld = true;

    const [active] = await conn.execute(
      `SELECT id FROM earthday_bulk_create_jobs WHERE status IN ('pending', 'running') LIMIT 1`
    );
    if (active.length > 0) {
      const err = new Error(
        'Уже выполняется другая задача массового создания заявок Earth Day. Дождитесь её завершения или обновите страницу.'
      );
      err.code = 'EARTHDAY_BULK_ALREADY_RUNNING';
      err.existing_job_id = active[0].id;
      throw err;
    }

    const jobId = generateId();
    await conn.execute(
      `INSERT INTO earthday_bulk_create_jobs
        (id, created_by, status, objectids_json, progress_offset, total, created_summary, errors_summary, message)
       VALUES (?, ?, 'pending', ?, 0, ?, NULL, NULL, NULL)`,
      [jobId, userId, JSON.stringify(ids), ids.length]
    );
    return { job_id: jobId, total: ids.length, chunk_size: CHUNK_MAX };
  } finally {
    if (lockHeld) {
      try {
        await conn.query('SELECT RELEASE_LOCK(?)', [ASYNC_ACTIVE_LOCK_NAME]);
      } catch {
        /* ignore */
      }
    }
    conn.release();
  }
}

function safeJsonParse(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === 'object' && !Buffer.isBuffer(val)) return val;
  try {
    return JSON.parse(String(val));
  } catch {
    return fallback;
  }
}

/**
 * Одна порция: один чанк одной активной задачи (pending/running).
 * @returns {{ didWork: boolean, job_id?: string, finished?: boolean }}
 */
async function processEarthdayBulkCreateJobsOneChunk(pool) {
  const [jobs] = await pool.execute(
    `SELECT id, created_by, status, objectids_json, progress_offset, total, created_summary, errors_summary
     FROM earthday_bulk_create_jobs
     WHERE status IN ('pending', 'running')
     ORDER BY created_at ASC
     LIMIT 1`
  );
  if (!jobs || jobs.length === 0) {
    return { didWork: false };
  }
  const job = jobs[0];
  const ids = safeJsonParse(job.objectids_json, []);
  if (!Array.isArray(ids) || ids.length === 0) {
    await pool.execute(
      `UPDATE earthday_bulk_create_jobs SET status = 'failed', message = ?, updated_at = NOW() WHERE id = ?`,
      ['Пустой или битый objectids_json', job.id]
    );
    return { didWork: true, job_id: job.id, finished: true };
  }
  const offset = Number(job.progress_offset) || 0;
  if (offset >= ids.length) {
    await pool.execute(
      `UPDATE earthday_bulk_create_jobs SET status = 'done', updated_at = NOW() WHERE id = ?`,
      [job.id]
    );
    return { didWork: true, job_id: job.id, finished: true };
  }

  await pool.execute(
    `UPDATE earthday_bulk_create_jobs SET status = 'running', updated_at = NOW() WHERE id = ?`,
    [job.id]
  );

  const slice = ids.slice(offset, offset + CHUNK_MAX);
  let batch;
  try {
    batch = await runEarthdayBulkCreateRequests(pool, job.created_by, { objectids: slice });
  } catch (e) {
    await pool.execute(
      `UPDATE earthday_bulk_create_jobs SET status = 'failed', message = ?, updated_at = NOW() WHERE id = ?`,
      [e.message || 'Ошибка пакетного создания', job.id]
    );
    return { didWork: true, job_id: job.id, finished: true };
  }

  const prevCreated = safeJsonParse(job.created_summary, []);
  const prevErrors = safeJsonParse(job.errors_summary, []);
  const mergedCreated = mergeJsonArrays(prevCreated, batch.created || []);
  const mergedErrors = mergeJsonArrays(prevErrors, batch.errors || []);

  const newOffset = offset + slice.length;
  const done = newOffset >= ids.length;
  const status = done ? 'done' : 'running';

  await pool.execute(
    `UPDATE earthday_bulk_create_jobs
     SET progress_offset = ?, status = ?, created_summary = ?, errors_summary = ?, updated_at = NOW()
     WHERE id = ?`,
    [newOffset, status, JSON.stringify(mergedCreated), JSON.stringify(mergedErrors), job.id]
  );

  return { didWork: true, job_id: job.id, finished: done };
}

/**
 * Несколько чанков за один вызов (cron), чтобы задача не тянулась часами.
 */
async function processEarthdayBulkCreateJobsTick(pool) {
  let chunks = 0;
  let last = null;
  for (let i = 0; i < CHUNKS_PER_TICK; i += 1) {
    const r = await processEarthdayBulkCreateJobsOneChunk(pool);
    if (!r.didWork) break;
    chunks += 1;
    last = r;
    if (r.finished) break;
  }
  return { chunks_processed: chunks, last };
}

/**
 * Полный статус задачи. Любой суперадмин с доступом к earthday-cleanups-admin bulk может читать любую задачу этого типа.
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} jobId
 */
async function getEarthdayBulkCreateJob(pool, jobId) {
  const [rows] = await pool.execute(
    `SELECT id, status, objectids_json, progress_offset, total, created_summary, errors_summary, message, created_at, updated_at
     FROM earthday_bulk_create_jobs WHERE id = ? LIMIT 1`,
    [jobId]
  );
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  const ids = safeJsonParse(row.objectids_json, []);
  const objectids = Array.isArray(ids) ? ids : [];
  return {
    job_id: row.id,
    status: row.status,
    total: Number(row.total),
    progress_offset: Number(row.progress_offset),
    progress_done: Number(row.progress_offset),
    remaining: Math.max(0, Number(row.total) - Number(row.progress_offset)),
    created_count: Array.isArray(safeJsonParse(row.created_summary, [])) ? safeJsonParse(row.created_summary, []).length : 0,
    errors_count: Array.isArray(safeJsonParse(row.errors_summary, [])) ? safeJsonParse(row.errors_summary, []).length : 0,
    created: safeJsonParse(row.created_summary, []),
    errors: safeJsonParse(row.errors_summary, []),
    message: row.message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    chunk_size: CHUNK_MAX,
    objectids
  };
}

/**
 * Единственная активная задача (pending/running) на сервис, если есть.
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<object|null>}
 */
async function getActiveEarthdayBulkCreateJobSnapshot(pool) {
  const [rows] = await pool.execute(
    `SELECT id, status, objectids_json, progress_offset, total, updated_at
     FROM earthday_bulk_create_jobs
     WHERE status IN ('pending', 'running')
     ORDER BY created_at ASC
     LIMIT 1`
  );
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  const ids = safeJsonParse(row.objectids_json, []);
  const objectids = Array.isArray(ids) ? ids : [];
  return {
    job_id: row.id,
    status: row.status,
    total: Number(row.total),
    progress_offset: Number(row.progress_offset),
    progress_done: Number(row.progress_offset),
    updated_at: row.updated_at,
    objectids
  };
}

async function listEarthdayBulkCreateJobs(pool, userId, limit) {
  const lim = Math.min(50, Math.max(1, limit || 20));
  const [rows] = await pool.execute(
    `SELECT id, status, progress_offset, total, message, created_at, updated_at
     FROM earthday_bulk_create_jobs
     WHERE created_by = ?
     ORDER BY created_at DESC
     LIMIT ${lim}`,
    [userId]
  );
  return rows.map((r) => ({
    job_id: r.id,
    status: r.status,
    progress_offset: Number(r.progress_offset),
    total: Number(r.total),
    message: r.message,
    created_at: r.created_at,
    updated_at: r.updated_at
  }));
}

module.exports = {
  createEarthdayBulkCreateJob,
  processEarthdayBulkCreateJobsTick,
  getEarthdayBulkCreateJob,
  getActiveEarthdayBulkCreateJobSnapshot,
  listEarthdayBulkCreateJobs,
  ASYNC_MAX_IDS,
  CHUNKS_PER_TICK
};
