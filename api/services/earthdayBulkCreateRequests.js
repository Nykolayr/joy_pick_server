const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { generateId } = require('../utils/uuid');
const { getFileUrl } = require('../middleware/upload');
const {
  buildWikimediaSearchAttempts,
  fetchWikimediaPreviewByAttempts,
  validEarthdayCoords,
  shuffleArrayInPlace,
} = require('../utils/wikimediaCommonsEarthday');
const { createEventRequestFromExternalSource } = require('./createEventRequestCore');
const {
  isEarthdayVisionEnabled,
  classifyEarthdayCoverImage,
} = require('./earthdayImageVision');
const {
  localFilePathFromUploadUrl,
  purgeBadEarthdayImage,
} = require('./earthdayImagePurge');

/** Ожидаемые чанки с фронта (по умолчанию 5); переопределение: EARTHDAY_BULK_CHUNK_MAX */
const CHUNK_MAX = parseInt(process.env.EARTHDAY_BULK_CHUNK_MAX, 10) || 5;
const MAX_IMAGE_BYTES = 1024 * 1024;
const IMAGE_REUSE_DAYS = Math.max(1, parseInt(process.env.EARTHDAY_IMAGE_REUSE_DAYS, 10) || 8);
const WIKIMEDIA_DOWNLOAD_MAX_CANDIDATES = Math.min(
  30,
  Math.max(1, parseInt(process.env.EARTHDAY_WIKIMEDIA_DOWNLOAD_MAX_CANDIDATES, 10) || 5)
);

const SELECT_ROW_COLUMNS = `
  objectid, cleanup_date, start_time, who_is_holding_the_cleanup, name_of_the_cleanup_event,
  name_of_cleanup_location, cleanup_event_location, GeoCodedAddress, lat, lng,
  country, location_hint, email_address_, used_for_internal_request
`.replace(/\s+/g, ' ').trim();

function firstNonEmpty(...parts) {
  for (const p of parts) {
    if (p != null && String(p).trim() !== '') return String(p).trim();
  }
  return '';
}

/** Как в БД кэша и backfill: только путь /uploads/... (getFileUrl отдаёт абсолютный URL). */
function toCacheUploadPath(imageUrl) {
  if (typeof imageUrl !== 'string') return null;
  const s = imageUrl.trim();
  if (!s) return null;
  if (s.startsWith('/uploads/')) return s;
  try {
    const u = new URL(s);
    if (u.pathname && u.pathname.startsWith('/uploads/')) return u.pathname;
  } catch {
    return null;
  }
  return null;
}

function normalizeRegionKey(raw) {
  if (raw == null) return '';
  const src = String(raw).toLowerCase();
  const cleaned = src
    .replace(/[0-9]/g, ' ')
    .replace(/[^\p{L}\s,.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  // Берем первые 2 "крупные" части location_hint (обычно страна/регион), без улиц и домов.
  const parts = cleaned
    .split(/[,|;·]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  return parts.slice(0, 2).join(' | ').slice(0, 255);
}

function buildCacheMatch(row) {
  const country = row && row.country != null ? String(row.country).trim() : '';
  const hint = row && row.location_hint != null ? String(row.location_hint).trim() : '';
  if (!country) return null;
  const regionKey = normalizeRegionKey(hint || country);
  if (!regionKey) return null;
  return {
    country: country.slice(0, 128),
    locationHint: hint || null,
    regionKey
  };
}

/** Как на клиенте: только поля строки city / City / country (без вычленения города из адреса). */
function buildCity(row) {
  const c = firstNonEmpty(row.city, row.City, row.country);
  return c || null;
}

function buildName(row) {
  const n = firstNonEmpty(
    row.name_of_the_cleanup_event,
    row.name_of_cleanup_location,
    row.who_is_holding_the_cleanup
  );
  if (n) return n;
  return `Запись #${row.objectid}`;
}

function buildDescription(row) {
  // Основной текст без GeoCodedAddress — полный адрес из парсинга всегда в конце (и email), если есть.
  const base = firstNonEmpty(
    row.name_of_the_cleanup_event,
    row.name_of_cleanup_location,
    row.cleanup_event_location
  );
  let desc = base;
  const org = row.who_is_holding_the_cleanup != null ? String(row.who_is_holding_the_cleanup).trim() : '';
  if (org && desc && !desc.includes(org)) {
    desc = `${desc}\n\nОрганизатор: ${org}`;
  } else if (org && !desc) {
    desc = `Организатор: ${org}`;
  }

  const footer = [];
  const email = row.email_address_ != null ? String(row.email_address_).trim() : '';
  const addr = row.GeoCodedAddress != null ? String(row.GeoCodedAddress).trim() : '';
  if (email) footer.push(`Email: ${email}`);
  if (addr) footer.push(`Адрес: ${addr}`);
  if (footer.length) {
    desc = desc ? `${desc}\n\n${footer.join('\n')}` : footer.join('\n');
  }
  return desc || null;
}

function parseStartDateUtcIso(row) {
  const cleanupMs = row.cleanup_date;
  if (cleanupMs == null || !Number.isFinite(Number(cleanupMs))) {
    return { error: 'Некорректное поле cleanup_date', code: 'BAD_DATE' };
  }
  const baseDate = new Date(Number(cleanupMs));
  if (Number.isNaN(baseDate.getTime())) {
    return { error: 'Некорректное поле cleanup_date', code: 'BAD_DATE' };
  }

  // Как в админке: календарный день из cleanup_date (UTC), время из start_time — HH:mm трактуем как UTC.
  const st = row.start_time;
  if (st != null && String(st).trim() !== '') {
    const s = String(st).trim();
    const hm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (hm) {
      const hh = parseInt(hm[1], 10);
      const mm = parseInt(hm[2], 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        const d = new Date(baseDate);
        d.setUTCHours(hh, mm, 0, 0);
        return { iso: d.toISOString() };
      }
    }
    const n = Number(s);
    if (Number.isFinite(n)) {
      const d = new Date(n);
      if (!Number.isNaN(d.getTime())) return { iso: d.toISOString() };
    }
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) {
      return { iso: new Date(parsed).toISOString() };
    }
    return { error: 'Не удалось разобрать start_time (ожидается HH:mm UTC, epoch или ISO)', code: 'BAD_START_TIME' };
  }

  return { iso: baseDate.toISOString() };
}

function buildPayload(row) {
  if (!validEarthdayCoords(row.lat, row.lng)) {
    return { error: 'Нужны валидные координаты lat/lng', code: 'BAD_COORDS' };
  }
  const datePart = parseStartDateUtcIso(row);
  if (datePart.error) return datePart;

  return {
    name: buildName(row),
    description: buildDescription(row),
    start_date: datePart.iso,
    latitude: Number(row.lat),
    longitude: Number(row.lng),
    city: buildCity(row)
  };
}

function parseObjectIds(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Тело: ожидается JSON-объект с полем objectids или object_ids' };
  }
  let raw = body.objectids ?? body.object_ids ?? body.ids;
  if (!Array.isArray(raw)) {
    return { error: 'Передайте массив objectids (целые objectid из earthday_cleanups)' };
  }
  const seen = new Set();
  const ids = [];
  for (const v of raw) {
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return { error: `Некорректный objectid: ${v}` };
    }
    if (seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  if (ids.length === 0) {
    return { error: 'Массив objectids пуст' };
  }
  if (ids.length > CHUNK_MAX) {
    return { error: `Слишком много objectid за один запрос (максимум ${CHUNK_MAX}, отправляйте чанками)` };
  }
  return { ids };
}

function isAllowedWikimediaImageUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    return h === 'upload.wikimedia.org' || h === 'commons.wikimedia.org';
  } catch {
    return false;
  }
}

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

function ensurePhotosDir() {
  const dest = path.join(uploadsDir, 'photos');
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  return dest;
}

async function compressToJpegMaxBytes(inputBuf, maxBytes) {
  let widthOpt = null;
  let quality = 88;
  for (let iter = 0; iter < 24; iter += 1) {
    const meta = await sharp(inputBuf).metadata();
    const w = meta.width;
    const targetW = widthOpt || (w ? Math.min(w, 2048) : 2048);
    const buf = await sharp(inputBuf)
      .rotate()
      .resize({ width: targetW, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer();
    if (buf.length <= maxBytes) return buf;
    quality -= 7;
    if (quality < 38) {
      quality = 82;
      const next = widthOpt ? Math.floor(widthOpt * 0.72) : (w ? Math.floor(w * 0.55) : 1280);
      widthOpt = Math.max(320, next);
    }
  }
  return sharp(inputBuf).rotate().resize({ width: 320 }).jpeg({ quality: 35, mozjpeg: true }).toBuffer();
}

async function fetchImageBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28000);
  const userAgent = process.env.WIKIMEDIA_USER_AGENT
    || 'JoyPickServer/1.0 (contact: support@joypick.app)';
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': userAgent, Accept: 'image/*,*/*' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } finally {
    clearTimeout(timeout);
  }
}

async function saveJpegToGallery(pool, userId, jpegBuf) {
  ensurePhotosDir();
  const filename = `${generateId()}.jpg`;
  const filePath = path.join(uploadsDir, 'photos', filename);
  await fs.promises.writeFile(filePath, jpegBuf);
  const imageUrl = getFileUrl(filename, 'photos');
  await pool.execute(
    'INSERT INTO request_creation_gallery (image_url, uploaded_by) VALUES (?, ?)',
    [imageUrl, userId]
  );
  return imageUrl;
}

/** Кандидаты уже отсортированы по score; скачиваем и сохраняем первый, прошедший vision. */
async function downloadFirstSuccessfulWikimediaImageToGallery(pool, userId, items, maxCandidates) {
  const slice = items.slice(0, Math.min(items.length, maxCandidates));
  for (const item of slice) {
    const url = item.full_url || item.thumb_url;
    if (!url || !isAllowedWikimediaImageUrl(url)) continue;

    try {
      const buf = await fetchImageBuffer(url);
      const jpeg = await compressToJpegMaxBytes(buf, MAX_IMAGE_BYTES);

      if (isEarthdayVisionEnabled()) {
        const vision = await classifyEarthdayCoverImage({ imageBuffer: jpeg });
        if (vision.verdict === 'reject' || vision.verdict === 'uncertain') continue;
      }

      return await saveJpegToGallery(pool, userId, jpeg);
    } catch {
      // следующий кандидат
    }
  }
  return null;
}

async function markCleanupAsUsed(pool, objectid) {
  const [result] = await pool.execute(
    'UPDATE earthday_cleanups SET used_for_internal_request = 1 WHERE objectid = ?',
    [objectid]
  );
  return (result && result.affectedRows ? Number(result.affectedRows) : 0) > 0;
}

/** Кэш уже чистится скриптом purge + vision при скачивании; при reuse — только проверка, что файл на диске есть. */
async function pickReusableCachedImageUrl(pool, cacheMatch, reuseDays) {
  const [rows] = await pool.execute(
    `SELECT id, image_url
     FROM earthday_image_cache
     WHERE country = ?
       AND region_key = ?
       AND image_url LIKE '/uploads/%'
       AND (
         last_used_at IS NULL
         OR last_used_at <= (UTC_TIMESTAMP() - INTERVAL ? DAY)
       )
     ORDER BY use_count ASC, id ASC
     LIMIT 20`,
    [cacheMatch.country, cacheMatch.regionKey, reuseDays]
  );
  if (!rows || rows.length === 0) return null;

  const candidates = [];
  for (const row of rows) {
    const imageUrl = String(row.image_url);
    const filePath = localFilePathFromUploadUrl(imageUrl);
    if (!filePath || !fs.existsSync(filePath)) {
      try {
        await purgeBadEarthdayImage(pool, imageUrl, { reason: 'missing_file' });
      } catch (e) {
        console.warn('[earthdayBulk] purge missing cache file:', imageUrl, e.message);
      }
      continue;
    }
    candidates.push(row);
  }
  if (candidates.length === 0) return null;

  shuffleArrayInPlace(candidates);
  const picked = candidates[0];
  return {
    id: Number(picked.id),
    image_url: String(picked.image_url),
  };
}

async function markCachedImageAsUsed(pool, cacheId) {
  await pool.execute(
    `UPDATE earthday_image_cache
     SET use_count = use_count + 1,
         last_used_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [cacheId]
  );
}

async function markCachedImageAsUsedByUrl(pool, cacheMatch, imageUrl) {
  const pathOnly = toCacheUploadPath(imageUrl);
  if (!pathOnly) return;
  await pool.execute(
    `UPDATE earthday_image_cache
     SET use_count = use_count + 1,
         last_used_at = UTC_TIMESTAMP()
     WHERE country = ?
       AND region_key = ?
       AND image_url = ?`,
    [cacheMatch.country, cacheMatch.regionKey, pathOnly]
  );
}

async function upsertCachedImage(pool, cacheMatch, imageUrl) {
  const pathOnly = toCacheUploadPath(imageUrl);
  if (!pathOnly) return;
  await pool.execute(
    `INSERT INTO earthday_image_cache (image_url, country, location_hint, region_key, use_count, last_used_at)
     VALUES (?, ?, ?, ?, 0, NULL)
     ON DUPLICATE KEY UPDATE
       location_hint = VALUES(location_hint),
       updated_at = CURRENT_TIMESTAMP`,
    [pathOnly, cacheMatch.country, cacheMatch.locationHint, cacheMatch.regionKey]
  );
}

function buildErrorDiagnostics(err) {
  if (!err) return {};
  return {
    error: err.message || 'Unknown error',
    errorName: err.name,
    errorCode: err.code,
    sqlMessage: err.sqlMessage,
    sqlState: err.sqlState,
    errno: err.errno,
    details: err.details || null,
    originalError: err.originalError
      ? {
          message: err.originalError.message,
          name: err.originalError.name,
          code: err.originalError.code,
          sqlMessage: err.originalError.sqlMessage,
          sqlState: err.originalError.sqlState,
          errno: err.originalError.errno
        }
      : null
  };
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} userId
 * @param {object} body
 */
async function runEarthdayBulkCreateRequests(pool, userId, body) {
  const parsed = parseObjectIds(body);
  if (parsed.error) {
    const err = new Error(parsed.error);
    err.code = 'VALIDATION';
    throw err;
  }
  const objectIds = parsed.ids;

  const placeholders = objectIds.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT ${SELECT_ROW_COLUMNS} FROM earthday_cleanups WHERE objectid IN (${placeholders})`,
    objectIds
  );

  const byId = new Map(rows.map((r) => [Number(r.objectid), r]));
  const errors = [];
  const created = [];

  for (const id of objectIds) {
    if (!byId.has(id)) {
      errors.push({ objectid: id, code: 'NOT_FOUND', message: 'Запись earthday_cleanups не найдена' });
    }
  }

  const validJobs = [];
  for (const id of objectIds) {
    const row = byId.get(id);
    if (!row) continue;

    if (Number(row.used_for_internal_request) === 1) {
      errors.push({
        objectid: id,
        code: 'ALREADY_USED',
        message: 'Запись уже помечена used_for_internal_request'
      });
      continue;
    }

    const payload = buildPayload(row);
    if (payload.error) {
      errors.push({ objectid: id, code: payload.code, message: payload.error });
      continue;
    }
    validJobs.push({ objectid: id, row, payload });
  }

  const wikiLimitSingle = Math.max(18, WIKIMEDIA_DOWNLOAD_MAX_CANDIDATES + 3);

  for (const j of validJobs) {
    const cacheMatch = buildCacheMatch(j.row);
    let selectedImageUrl = null;
    let selectedCacheId = null;

    if (cacheMatch) {
      try {
        const cached = await pickReusableCachedImageUrl(pool, cacheMatch, IMAGE_REUSE_DAYS);
        if (cached) {
          selectedImageUrl = cached.image_url;
          selectedCacheId = cached.id;
        }
      } catch {
        // Не прерываем батч на ошибке чтения кэша; просто идем в Wikimedia pipeline.
      }
    }

    if (!selectedImageUrl) {
      const attempts = buildWikimediaSearchAttempts(j.row);
      if (attempts.length === 0) {
        errors.push({
          objectid: j.objectid,
          code: 'NO_SEARCH',
          message: 'Недостаточно данных для поиска изображений (нет координат и текстовых полей места)'
        });
        continue;
      }

      const wiki = await fetchWikimediaPreviewByAttempts(attempts, wikiLimitSingle);
      if (wiki.error) {
        errors.push({
          objectid: j.objectid,
          code: 'WIKIMEDIA',
          message: wiki.error
        });
        continue;
      }

      const items = wiki.items || [];
      if (items.length === 0) {
        errors.push({
          objectid: j.objectid,
          code: 'NO_COMMONS_IMAGES',
          message: 'Wikimedia не вернул подходящих изображений'
        });
        continue;
      }

      const maxCandidates = Math.min(items.length, WIKIMEDIA_DOWNLOAD_MAX_CANDIDATES);
      selectedImageUrl = await downloadFirstSuccessfulWikimediaImageToGallery(pool, userId, items, maxCandidates);
      if (!selectedImageUrl) {
        errors.push({
          objectid: j.objectid,
          code: 'IMAGE_PIPELINE',
          message: 'Не удалось сжать и сохранить изображения из Wikimedia'
        });
        continue;
      }

      if (cacheMatch) {
        try {
          await upsertCachedImage(pool, cacheMatch, selectedImageUrl);
        } catch {
          // Ошибка кэширования не должна срывать создание заявок.
        }
      }
    }

    try {
      const requestId = await createEventRequestFromExternalSource(pool, {
        userId,
        name: j.payload.name,
        description: j.payload.description,
        start_date: j.payload.start_date,
        latitude: j.payload.latitude,
        longitude: j.payload.longitude,
        city: j.payload.city,
        photosBeforeUrls: [selectedImageUrl],
        earthdayCleanupObjectid: j.objectid
      });
      if (selectedCacheId != null) {
        try {
          await markCachedImageAsUsed(pool, selectedCacheId);
        } catch {
          // Инкремент счетчика не должен ломать основной флоу.
        }
      } else if (cacheMatch) {
        try {
          // Если картинка новая (из Wikimedia), фиксируем первое использование.
          await markCachedImageAsUsedByUrl(pool, cacheMatch, selectedImageUrl);
        } catch {
          // No-op
        }
      }
      await markCleanupAsUsed(pool, j.objectid);
      created.push({ objectid: j.objectid, request_id: requestId });
    } catch (e) {
      errors.push({
        objectid: j.objectid,
        code: 'CREATE_REQUEST',
        message: e.message || 'Ошибка создания заявки или чата',
        diagnostics: buildErrorDiagnostics(e)
      });
    }
  }

  const requestedCount = objectIds.length;

  return {
    success: true,
    requested_count: requestedCount,
    created_count: created.length,
    created,
    errors_count: errors.length,
    errors,
    semantics: 'chunk_sequential',
    /** true, если в теле были id, но ни одна заявка не создана */
    batch_all_failed: requestedCount > 0 && created.length === 0
  };
}

module.exports = {
  runEarthdayBulkCreateRequests,
  CHUNK_MAX
};
