/**
 * Синхронизация заявок Earth Day с ArcGIS FeatureServer.
 */

const {
  normalizeLon,
  continentFromLatLon,
  countryFromLatLon,
  buildLocationHint
} = require('../utils/geoContinentCountry');

const ARCGIS_QUERY_BASE =
  'https://services5.arcgis.com/cy2zIylXXizcsMCw/arcgis/rest/services/survey123_745d2f8184964929a27c2d378c5ec575/FeatureServer/0/query';

const OUT_FIELDS = [
  'objectid',
  'globalid',
  'first_name_',
  'last_name_',
  'email_address_',
  'phone_number_pub',
  'cleanup_date',
  'start_time',
  'who_is_holding_the_cleanup',
  'name_of_the_cleanup_event',
  'name_of_cleanup_location',
  'cleanup_event_location',
  'how_should_volunteers_register',
  'GeoCodedAddress'
].join(',');

const FETCH_TIMEOUT_MS = 120000;
const MAX_RECORDS = 1000;

function msNowUtc() {
  return Date.now();
}

/**
 * Поле cleanup_date в слое — esriFieldTypeDate; сравнение с «сырыми» epoch ms в WHERE даёт
 * «Invalid query parameters» на FeatureServer. Нужен литерал date 'YYYY-MM-DD HH:mm:ss' в UTC.
 */
function arcgisDateLiteralUtc(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `date '${y}-${mo}-${da} ${h}:${mi}:${s}'`;
}

function buildWhereClause(tFromMs, tToMs) {
  return (
    "(event_type = 'Public') AND (approved IS NULL OR approved = 'Yes') AND " +
    `(cleanup_date >= ${arcgisDateLiteralUtc(tFromMs)}) AND (cleanup_date <= ${arcgisDateLiteralUtc(tToMs)})`
  );
}

function buildQueryUrl(tFromMs, tToMs) {
  const params = new URLSearchParams({
    f: 'json',
    where: buildWhereClause(tFromMs, tToMs),
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    orderByFields: 'cleanup_date',
    resultRecordCount: String(MAX_RECORDS)
  });
  return `${ARCGIS_QUERY_BASE}?${params.toString()}`;
}

/**
 * Загрузка фич из ArcGIS. Возвращает { features, arcgisError, httpStatus }.
 */
async function fetchFeaturesFromArcgis(tFromMs, tToMs) {
  const url = buildQueryUrl(tFromMs, tToMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      return {
        features: [],
        arcgisError: {
          code: 'ARCGIS_JSON_PARSE',
          message: 'Ответ ArcGIS не является JSON',
          detail: String(text).slice(0, 500)
        },
        httpStatus: res.status
      };
    }
    if (body.error) {
      return {
        features: [],
        arcgisError: {
          code: 'ARCGIS_ERROR',
          message: body.error.message || 'Ошибка ArcGIS',
          detail: body.error
        },
        httpStatus: res.status
      };
    }
    if (!res.ok) {
      return {
        features: [],
        arcgisError: {
          code: 'ARCGIS_HTTP',
          message: `HTTP ${res.status}`,
          detail: body
        },
        httpStatus: res.status
      };
    }
    const features = Array.isArray(body.features) ? body.features : [];
    return { features, arcgisError: null, httpStatus: res.status };
  } catch (err) {
    const message = err.name === 'AbortError' ? 'Таймаут запроса к ArcGIS' : err.message;
    return {
      features: [],
      arcgisError: {
        code: 'ARCGIS_FETCH',
        message,
        detail: err.name
      },
      httpStatus: null
    };
  } finally {
    clearTimeout(timer);
  }
}

function strOrNull(v, maxLen) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  if (maxLen && s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

/**
 * Преобразует одну фичу в строку для БД или добавляет запись в parseErrors / счётчик пропусков.
 */
function mapFeatureToRow(feature, parseErrors, counters) {
  const attrs = feature && feature.attributes ? feature.attributes : null;
  const oid = attrs && attrs.objectid != null ? attrs.objectid : null;
  const gid = attrs && attrs.globalid != null ? String(attrs.globalid).trim() : null;

  const pushErr = (code, message, extra = {}) => {
    parseErrors.push({
      code,
      message,
      objectid: oid != null ? oid : undefined,
      globalid: gid || undefined,
      ...extra
    });
  };

  if (!attrs) {
    pushErr('MISSING_ATTRIBUTES', 'Нет объекта attributes');
    counters.skippedInvalid += 1;
    return null;
  }

  if (oid == null || Number.isNaN(Number(oid))) {
    pushErr('MISSING_OBJECTID', 'Отсутствует или невалидный objectid');
    counters.skippedInvalid += 1;
    return null;
  }

  if (!gid) {
    pushErr('MISSING_GLOBALID', 'Отсутствует globalid', { objectid: Number(oid) });
    counters.skippedInvalid += 1;
    return null;
  }

  const startRaw = attrs.start_time;
  if (startRaw == null || String(startRaw).trim() === '') {
    parseErrors.push({
      code: 'SKIP_NO_START_TIME',
      message: 'Пропуск: пустой start_time',
      objectid: Number(oid),
      globalid: gid
    });
    counters.skippedNoStartTime += 1;
    return null;
  }

  const cleanupDate = attrs.cleanup_date;
  if (cleanupDate == null || Number.isNaN(Number(cleanupDate))) {
    pushErr('INVALID_CLEANUP_DATE', 'Невалидный cleanup_date', { objectid: Number(oid), globalid: gid });
    counters.skippedInvalid += 1;
    return null;
  }

  const geom = feature.geometry;
  let lat = null;
  let lng = null;
  if (geom && typeof geom.x === 'number' && typeof geom.y === 'number') {
    lng = geom.x;
    lat = geom.y;
  }
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    counters.skippedNoCoordinates += 1;
    return null;
  }

  // Заглушка без реальной точки: ArcGIS часто отдаёт (0, 0) для «Place a Pin» без геокода
  if (Math.abs(lat) < 1e-7 && Math.abs(lng) < 1e-7) {
    counters.skippedNoCoordinates += 1;
    return null;
  }

  const lonNorm = normalizeLon(lng);
  const continent = continentFromLatLon(lat, lonNorm);
  const country = countryFromLatLon(lat, lonNorm);
  const geoAddr = strOrNull(attrs.GeoCodedAddress, 65535);
  const location_hint = buildLocationHint(continent, country, geoAddr);

  return {
    objectid: Number(oid),
    globalid: gid,
    first_name_: strOrNull(attrs.first_name_, 255),
    last_name_: strOrNull(attrs.last_name_, 255),
    email_address_: strOrNull(attrs.email_address_, 255),
    phone_number_pub: strOrNull(attrs.phone_number_pub, 64),
    cleanup_date: Number(cleanupDate),
    start_time: strOrNull(startRaw, 32) || String(startRaw).slice(0, 32),
    who_is_holding_the_cleanup: strOrNull(attrs.who_is_holding_the_cleanup, 512),
    name_of_the_cleanup_event: strOrNull(attrs.name_of_the_cleanup_event, 512),
    name_of_cleanup_location: strOrNull(attrs.name_of_cleanup_location, 512),
    cleanup_event_location: strOrNull(attrs.cleanup_event_location, 255),
    how_should_volunteers_register: strOrNull(attrs.how_should_volunteers_register, 128),
    GeoCodedAddress: geoAddr,
    lat,
    lng,
    continent,
    country,
    location_hint
  };
}

module.exports = {
  msNowUtc,
  buildWhereClause,
  buildQueryUrl,
  fetchFeaturesFromArcgis,
  mapFeatureToRow,
  MAX_RECORDS,
  /** Порог удаления из БД: cleanup_date < now + 24h (epoch ms) */
  thresholdDeleteBeforeMs(nowMs) {
    return nowMs + 24 * 60 * 60 * 1000;
  },
  /** Окно выгрузки из ArcGIS: [now+24h, now+7d] */
  syncWindowMs(nowMs) {
    const day = 24 * 60 * 60 * 1000;
    return { tFrom: nowMs + day, tTo: nowMs + 7 * day };
  }
};
