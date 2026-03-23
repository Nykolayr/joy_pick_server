const express = require('express');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const {
  fetchFeaturesFromArcgis,
  mapFeatureToRow,
  msNowUtc,
  thresholdDeleteBeforeMs,
  syncWindowMs
} = require('../services/earthdayCleanupsSync');

const router = express.Router();

router.use(authenticate);
router.use(requireSuperAdmin);

const UPSERT_SQL = `
INSERT INTO earthday_cleanups (
  objectid, globalid, first_name_, last_name_, email_address_, phone_number_pub,
  cleanup_date, start_time, who_is_holding_the_cleanup, name_of_the_cleanup_event,
  name_of_cleanup_location, cleanup_event_location, how_should_volunteers_register,
  GeoCodedAddress, lat, lng, used_for_internal_request
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
ON DUPLICATE KEY UPDATE
  globalid = VALUES(globalid),
  first_name_ = VALUES(first_name_),
  last_name_ = VALUES(last_name_),
  email_address_ = VALUES(email_address_),
  phone_number_pub = VALUES(phone_number_pub),
  cleanup_date = VALUES(cleanup_date),
  start_time = VALUES(start_time),
  who_is_holding_the_cleanup = VALUES(who_is_holding_the_cleanup),
  name_of_the_cleanup_event = VALUES(name_of_the_cleanup_event),
  name_of_cleanup_location = VALUES(name_of_cleanup_location),
  cleanup_event_location = VALUES(cleanup_event_location),
  how_should_volunteers_register = VALUES(how_should_volunteers_register),
  GeoCodedAddress = VALUES(GeoCodedAddress),
  lat = VALUES(lat),
  lng = VALUES(lng),
  used_for_internal_request = earthday_cleanups.used_for_internal_request
`;

const SELECT_LIST_COLUMNS = `
  objectid, globalid, first_name_, last_name_, email_address_, phone_number_pub,
  cleanup_date, start_time, who_is_holding_the_cleanup, name_of_the_cleanup_event,
  name_of_cleanup_location, cleanup_event_location, how_should_volunteers_register,
  GeoCodedAddress, lat, lng, used_for_internal_request, created_at, updated_at
`;

/**
 * Парсинг границы фильтра по cleanup_date (epoch ms в БД).
 * — целое число в строке → трактуем как ms;
 * — только YYYY-MM-DD: from = 00:00:00.000Z, to = 23:59:59.999Z того же дня;
 * — иначе Date.parse (ISO 8601).
 */
function parseCleanupDateBound(raw, role) {
  if (raw == null) return { ms: null };
  const s = String(raw).trim();
  if (s === '') return { ms: null };

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return { error: 'Некорректное число даты' };
    return { ms: n };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const fromMs = Date.parse(`${s}T00:00:00.000Z`);
    if (Number.isNaN(fromMs)) return { error: 'Некорректная дата' };
    if (role === 'to') {
      const toMs = Date.parse(`${s}T23:59:59.999Z`);
      return { ms: toMs };
    }
    return { ms: fromMs };
  }

  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return { error: 'Некорректная дата (ожидается ISO 8601 или YYYY-MM-DD)' };
  return { ms };
}

/** Query exclude_used: только строки с used_for_internal_request = 0 (корректная пагинация на бэкенде). */
function parseExcludeUsed(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  const s = String(raw).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/**
 * GET /earthday-cleanups-admin
 * Список с пагинацией; опционально cleanup_date_from / cleanup_date_to, exclude_used.
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const excludeUsed = parseExcludeUsed(req.query.exclude_used);

    const fromParsed = parseCleanupDateBound(req.query.cleanup_date_from, 'from');
    if (fromParsed.error) {
      return error(res, fromParsed.error, 400);
    }
    const toParsed = parseCleanupDateBound(req.query.cleanup_date_to, 'to');
    if (toParsed.error) {
      return error(res, toParsed.error, 400);
    }

    if (fromParsed.ms != null && toParsed.ms != null && fromParsed.ms > toParsed.ms) {
      return error(res, 'cleanup_date_from не может быть больше cleanup_date_to', 400);
    }

    const conditions = [];
    const params = [];
    if (fromParsed.ms != null) {
      conditions.push('cleanup_date >= ?');
      params.push(fromParsed.ms);
    }
    if (toParsed.ms != null) {
      conditions.push('cleanup_date <= ?');
      params.push(toParsed.ms);
    }
    if (excludeUsed) {
      conditions.push('used_for_internal_request = ?');
      params.push(0);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM earthday_cleanups ${whereClause}`,
      params
    );
    const total = countRows[0] ? Number(countRows[0].total) : 0;

    const [items] = await pool.execute(
      `SELECT ${SELECT_LIST_COLUMNS}
       FROM earthday_cleanups
       ${whereClause}
       ORDER BY cleanup_date ASC, objectid ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    return success(res, {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages
      },
      filters: {
        cleanup_date_from: fromParsed.ms,
        cleanup_date_to: toParsed.ms,
        exclude_used: excludeUsed
      }
    });
  } catch (e) {
    return error(res, e.message || 'Ошибка выборки', 500, e);
  }
});

/**
 * POST /earthday-cleanups-admin/sync
 * Удаляет просроченные и события в ближайшие 24ч (cleanup_date < now+24h),
 * подтягивает до 1000 заявок из ArcGIS с cleanup_date в [now+24h, now+7d],
 * вставляет/обновляет по objectid; без start_time — не вставляет (в parseErrors).
 */
router.post('/sync', async (req, res) => {
  const parseErrors = [];
  const nowMs = msNowUtc();
  const deleteBeforeMs = thresholdDeleteBeforeMs(nowMs);
  const { tFrom, tTo } = syncWindowMs(nowMs);

  const { features, arcgisError, httpStatus } = await fetchFeaturesFromArcgis(tFrom, tTo);
  if (arcgisError) {
    return error(res, arcgisError.message || 'Ошибка загрузки ArcGIS', httpStatus && httpStatus >= 400 ? httpStatus : 502, {
      arcgisError,
      httpStatus,
      parseErrors
    });
  }

  const counters = {
    skippedNoStartTime: 0,
    skippedInvalid: 0,
    upsertInserted: 0,
    upsertUpdated: 0,
    upsertDbErrors: 0
  };

  const rowsToSave = [];
  for (let i = 0; i < features.length; i += 1) {
    const row = mapFeatureToRow(features[i], parseErrors, counters);
    if (row) rowsToSave.push(row);
  }

  let deletedCount = 0;
  let totalInTable = 0;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [delResult] = await conn.execute(
      'DELETE FROM earthday_cleanups WHERE cleanup_date < ?',
      [deleteBeforeMs]
    );
    deletedCount = delResult.affectedRows || 0;

    for (const row of rowsToSave) {
      const params = [
        row.objectid,
        row.globalid,
        row.first_name_,
        row.last_name_,
        row.email_address_,
        row.phone_number_pub,
        row.cleanup_date,
        row.start_time,
        row.who_is_holding_the_cleanup,
        row.name_of_the_cleanup_event,
        row.name_of_cleanup_location,
        row.cleanup_event_location,
        row.how_should_volunteers_register,
        row.GeoCodedAddress,
        row.lat,
        row.lng
      ];
      try {
        const [result] = await conn.execute(UPSERT_SQL, params);
        const ar = result.affectedRows;
        if (ar === 1) counters.upsertInserted += 1;
        else if (ar === 2) counters.upsertUpdated += 1;
      } catch (dbErr) {
        counters.upsertDbErrors += 1;
        parseErrors.push({
          code: 'DB_UPSERT',
          message: dbErr.message || 'Ошибка записи в БД',
          objectid: row.objectid,
          globalid: row.globalid,
          sqlMessage: dbErr.sqlMessage,
          errno: dbErr.errno
        });
      }
    }

    await conn.commit();

    const [countRows] = await pool.execute('SELECT COUNT(*) AS c FROM earthday_cleanups');
    totalInTable = countRows[0] ? Number(countRows[0].c) : 0;
  } catch (e) {
    await conn.rollback();
    return error(res, e.message || 'Ошибка транзакции синхронизации', 500, e);
  } finally {
    conn.release();
  }

  const data = {
    deletedCount,
    fetchedFromApi: features.length,
    newRows: counters.upsertInserted,
    updatedRows: counters.upsertUpdated,
    skippedNoStartTime: counters.skippedNoStartTime,
    skippedInvalid: counters.skippedInvalid,
    upsertDbErrors: counters.upsertDbErrors,
    totalInTable,
    window: {
      deleteIfCleanupDateBeforeMs: deleteBeforeMs,
      arcgisCleanupDateFromMs: tFrom,
      arcgisCleanupDateToMs: tTo,
      nowMs
    },
    parseErrors
  };

  return success(res, data, 'Синхронизация Earth Day cleanups выполнена');
});

function parseUsedForInternalRequest(body) {
  if (body == null || typeof body !== 'object') return { error: 'Тело запроса должно быть JSON-объектом' };
  const v = body.used_for_internal_request;
  if (v === true || v === 1 || v === '1') return { value: 1 };
  if (v === false || v === 0 || v === '0') return { value: 0 };
  if (v === undefined) return { error: 'Поле used_for_internal_request обязательно (true/false или 1/0)' };
  return { error: 'used_for_internal_request: ожидается boolean или 0/1' };
}

/**
 * PATCH /earthday-cleanups-admin/:objectid
 * Обновляет только used_for_internal_request (взяли запись для создания нашей заявки → true/1).
 */
router.patch('/:objectid', async (req, res) => {
  const raw = req.params.objectid;
  const objectid = Number(raw);
  if (!Number.isFinite(objectid)) {
    return error(res, 'Некорректный objectid', 400);
  }

  const parsed = parseUsedForInternalRequest(req.body);
  if (parsed.error) {
    return error(res, parsed.error, 400);
  }

  try {
    const [result] = await pool.execute(
      'UPDATE earthday_cleanups SET used_for_internal_request = ? WHERE objectid = ?',
      [parsed.value, objectid]
    );
    const affected = result.affectedRows || 0;
    if (affected === 0) {
      return error(res, 'Запись не найдена', 404);
    }
    return success(
      res,
      { objectid, used_for_internal_request: parsed.value === 1 },
      'Поле used_for_internal_request обновлено'
    );
  } catch (e) {
    return error(res, e.message || 'Ошибка обновления', 500, e);
  }
});

module.exports = router;
