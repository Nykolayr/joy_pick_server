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
const {
  parseWikimediaLimit,
  buildWikimediaSearchAttempts,
  fetchWikimediaPreviewByAttempts
} = require('../utils/wikimediaCommonsEarthday');
const { runEarthdayBulkCreateRequests } = require('../services/earthdayBulkCreateRequests');

const router = express.Router();

router.use((req, res, next) => {
  const shouldLog = req.method === 'OPTIONS' || req.method === 'PATCH';
  if (shouldLog) {
    const origin = req.headers.origin || 'no-origin';
    const routePath = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;
    res.on('finish', () => {
      console.log(`[earthday-cleanups-admin] ${req.method} ${routePath} status=${res.statusCode} origin=${origin}`);
    });
  }
  // Preflight на этом роуте не должен упираться в auth middleware.
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

router.use(authenticate);
router.use(requireSuperAdmin);

const UPSERT_SQL = `
INSERT INTO earthday_cleanups (
  objectid, globalid, first_name_, last_name_, email_address_, phone_number_pub,
  cleanup_date, start_time, who_is_holding_the_cleanup, name_of_the_cleanup_event,
  name_of_cleanup_location, cleanup_event_location, how_should_volunteers_register,
  GeoCodedAddress, lat, lng, continent, country, location_hint, used_for_internal_request
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
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
  continent = VALUES(continent),
  country = VALUES(country),
  location_hint = VALUES(location_hint),
  used_for_internal_request = earthday_cleanups.used_for_internal_request
`;

const SELECT_LIST_COLUMNS = `
  objectid, globalid, first_name_, last_name_, email_address_, phone_number_pub,
  cleanup_date, start_time, who_is_holding_the_cleanup, name_of_the_cleanup_event,
  name_of_cleanup_location, cleanup_event_location, how_should_volunteers_register,
  GeoCodedAddress, lat, lng, continent, country, location_hint, used_for_internal_request, created_at, updated_at
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

/** Разрешённые колонки для ORDER BY (только whitelist, без подстановки из query). */
const SORT_BY_WHITELIST = {
  cleanup_date: 'cleanup_date',
  continent: 'continent',
  country: 'country'
};

function parseSortBy(raw) {
  const key = raw == null || String(raw).trim() === '' ? 'cleanup_date' : String(raw).trim().toLowerCase();
  const column = SORT_BY_WHITELIST[key];
  if (!column) {
    return {
      error:
        'sort_by: допустимо cleanup_date (по умолчанию), continent или country'
    };
  }
  return { column };
}

function parseSortDir(raw) {
  const s = raw == null || String(raw).trim() === '' ? 'asc' : String(raw).trim().toLowerCase();
  if (s !== 'asc' && s !== 'desc') {
    return { error: 'sort_dir: допустимо asc или desc' };
  }
  return { dir: s.toUpperCase() };
}

/** Опциональный фильтр по значению колонки (точное совпадение, как в БД). */
function parseStringEqFilter(raw, maxLen, paramName) {
  if (raw === undefined || raw === null) return { value: null };
  const s = String(raw).trim();
  if (s === '') return { value: null };
  if (s.length > maxLen) {
    return { error: `${paramName}: максимум ${maxLen} символов` };
  }
  return { value: s };
}

/**
 * GET /earthday-cleanups-admin
 * Список с пагинацией; опционально cleanup_date_from / cleanup_date_to, exclude_used,
 * continent / country (точное совпадение с полями в БД, англ. названия),
 * sort_by (cleanup_date | continent | country), sort_dir (asc | desc).
 */
router.get('/', async (req, res) => {
  try {
    const nowMs = msNowUtc();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const excludeUsed = parseExcludeUsed(req.query.exclude_used);

    const continentFilter = parseStringEqFilter(req.query.continent, 64, 'continent');
    if (continentFilter.error) {
      return error(res, continentFilter.error, 400);
    }
    const countryFilter = parseStringEqFilter(req.query.country, 128, 'country');
    if (countryFilter.error) {
      return error(res, countryFilter.error, 400);
    }

    const sortByParsed = parseSortBy(req.query.sort_by);
    if (sortByParsed.error) {
      return error(res, sortByParsed.error, 400);
    }
    const sortDirParsed = parseSortDir(req.query.sort_dir);
    if (sortDirParsed.error) {
      return error(res, sortDirParsed.error, 400);
    }
    const sortColumn = sortByParsed.column;
    const sortDir = sortDirParsed.dir;

    // По умолчанию выдаём неделю вперёд: [now+24h, now+7d], если фронт не передал фильтры явно.
    const fallbackFromMs = nowMs + 24 * 60 * 60 * 1000;
    const fallbackToMs = nowMs + 7 * 24 * 60 * 60 * 1000;
    const rawCleanupDateFrom = req.query.cleanup_date_from == null || String(req.query.cleanup_date_from).trim() === ''
      ? String(fallbackFromMs)
      : req.query.cleanup_date_from;
    const rawCleanupDateTo = req.query.cleanup_date_to == null || String(req.query.cleanup_date_to).trim() === ''
      ? String(fallbackToMs)
      : req.query.cleanup_date_to;

    const fromParsed = parseCleanupDateBound(rawCleanupDateFrom, 'from');
    if (fromParsed.error) {
      return error(res, fromParsed.error, 400);
    }
    const toParsed = parseCleanupDateBound(rawCleanupDateTo, 'to');
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
    if (continentFilter.value != null) {
      conditions.push('continent = ?');
      params.push(continentFilter.value);
    }
    if (countryFilter.value != null) {
      conditions.push('country = ?');
      params.push(countryFilter.value);
    }
    // Не показывать записи без адреса парсинга (GeoCodedAddress пустой/NULL)
    conditions.push("TRIM(COALESCE(GeoCodedAddress, '')) <> ''");
    // Не показывать заглушку 0,0 (нет реальных координат); пагинация считается без них
    conditions.push('(COALESCE(lat, 0) != 0 OR COALESCE(lng, 0) != 0)');

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM earthday_cleanups ${whereClause}`,
      params
    );
    const total = countRows[0] ? Number(countRows[0].total) : 0;

    // LIMIT/OFFSET нельзя надёжно биндить в prepared statement на части MySQL/MariaDB (ER_WRONG_ARGUMENTS).
    const limitInt = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 20));
    const offsetInt = Math.max(0, Math.floor(Number(offset)) || 0);

    // При сортировке по континенту/стране: сначала не-NULL, потом направление по полю, затем дата (стабильность)
    const orderPrimary =
      sortColumn === 'continent'
        ? `continent IS NULL ASC, continent ${sortDir}, cleanup_date ASC, objectid ASC`
        : sortColumn === 'country'
          ? `country IS NULL ASC, country ${sortDir}, cleanup_date ASC, objectid ASC`
          : `cleanup_date ${sortDir}, objectid ASC`;

    const [items] = await pool.execute(
      `SELECT ${SELECT_LIST_COLUMNS}
       FROM earthday_cleanups
       ${whereClause}
       ORDER BY ${orderPrimary}
       LIMIT ${limitInt} OFFSET ${offsetInt}`,
      params
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
        exclude_used: excludeUsed,
        continent: continentFilter.value,
        country: countryFilter.value,
        sort_by: sortColumn,
        sort_dir: sortDir.toLowerCase()
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
 * вставляет/обновляет по objectid; без start_time или без координат — не вставляет.
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
    skippedNoCoordinates: 0,
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
        row.lng,
        row.continent,
        row.country,
        row.location_hint
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
    skippedNoCoordinates: counters.skippedNoCoordinates,
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

/**
 * POST /earthday-cleanups-admin/bulk-create-requests
 * Пакетное создание заявок category=event (from_external_source), фото из Wikimedia → сжатие → галерея.
 * Частичный успех: ошибки по отдельным objectid не откатывают уже созданные заявки.
 *
 * Тело: до 5 objectid за запрос (чанк с фронта): { "objectids": [...] } или object_ids.
 * Дубликаты удаляются; лимит: EARTHDAY_BULK_CHUNK_MAX (по умолчанию 5).
 * Даже если в батче не создано ни одной заявки — возвращаем успех с деталями ошибок.
 */
router.post('/bulk-create-requests', async (req, res) => {
  try {
    const data = await runEarthdayBulkCreateRequests(pool, req.user.userId, req.body);
    return success(res, data, 'Пакетное создание заявок из Earth Day выполнено');
  } catch (e) {
    if (e && e.code === 'VALIDATION') {
      return error(res, e.message, 400);
    }
    return error(res, e.message || 'Ошибка пакетного создания заявок', 500, e);
  }
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
 * GET /earthday-cleanups-admin/:objectid/wikimedia-preview
 * Превью изображений из Wikimedia Commons по данным записи Earth Day.
 */
router.get('/:objectid/wikimedia-preview', async (req, res) => {
  const objectid = Number(req.params.objectid);
  if (!Number.isFinite(objectid)) {
    return error(res, 'Некорректный objectid', 400);
  }

  const parsedLimit = parseWikimediaLimit(req.query.limit);
  if (parsedLimit.error) {
    return error(res, parsedLimit.error, 400);
  }
  const limit = parsedLimit.value;

  try {
    const [rows] = await pool.execute(
      `SELECT objectid, GeoCodedAddress, country, location_hint, lat, lng, name_of_cleanup_location
       FROM earthday_cleanups WHERE objectid = ? LIMIT 1`,
      [objectid]
    );
    if (!rows || rows.length === 0) {
      return error(res, 'Запись Earth Day cleanup не найдена', 404);
    }

    const row = rows[0];
    const attempts = buildWikimediaSearchAttempts(row);
    if (attempts.length === 0) {
      return error(res, 'Недостаточно данных для поиска изображений (нет координат и текстовых полей места)', 400);
    }

    const wiki = await fetchWikimediaPreviewByAttempts(attempts, limit);
    if (wiki.error) {
      return error(res, wiki.error, wiki.status || 502);
    }

    const items = wiki.items || [];
    return success(res, {
      objectid,
      limit,
      search_strategy: wiki.strategy_used || null,
      srsearch: wiki.srsearch_used || null,
      attempts: attempts.map((a) => ({ label: a.label, srsearch: a.srsearch })),
      items,
      urls: items.map((i) => i.thumb_url).filter(Boolean)
    }, 'Wikimedia preview loaded');
  } catch (e) {
    return error(res, e.message || 'Ошибка загрузки Wikimedia preview', 500, e);
  }
});

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
