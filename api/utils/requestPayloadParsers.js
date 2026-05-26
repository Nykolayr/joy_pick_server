/**
 * Нормализация значений из multipart/form-data и JSON для записи в MySQL.
 * Используется в api/routes/requests.js (create/update) — поведение должно оставаться стабильным.
 */

function parseBooleanToDbInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') {
    if (value === 1) return 1;
    if (value === 0) return 0;
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return 1;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return 0;
    return null;
  }
  return null;
}

function formatDateTimeForMySql(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
      return raw;
    }
  }

  const dateObj = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateObj.getTime())) return null;

  const yyyy = dateObj.getUTCFullYear();
  const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getUTCDate()).padStart(2, '0');
  const hh = String(dateObj.getUTCHours()).padStart(2, '0');
  const mi = String(dateObj.getUTCMinutes()).padStart(2, '0');
  const ss = String(dateObj.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/**
 * Скалярные поля из multipart/form-data / строковых полей при обновлении заявки.
 * Для boolean возвращает 0/1 (как в БД) или undefined если значение невалидно/пустое.
 */
function parseMultipartScalar(value, type) {
  if (value === undefined || value === null || value === '') return undefined;
  if (type === 'boolean') {
    const parsed = parseBooleanToDbInt(value, null);
    if (parsed === null) {
      return undefined;
    }
    return parsed;
  }
  if (type === 'number') {
    const num = parseFloat(value);
    return Number.isNaN(num) ? undefined : num;
  }
  return value;
}

/**
 * waste_types из JSON body: массив, JSON-строка или CSV.
 */
function parseWasteTypesFromField(waste_types) {
  const empty = [];
  if (waste_types === undefined || waste_types === null || waste_types === '') {
    return empty;
  }
  if (Array.isArray(waste_types)) {
    return waste_types;
  }
  if (typeof waste_types === 'string') {
    try {
      return JSON.parse(waste_types);
    } catch (e) {
      return waste_types.split(',').map((t) => t.trim()).filter((t) => t);
    }
  }
  return empty;
}

/**
 * waste_types из multipart: поле waste_types[] или waste_types.
 */
function parseWasteTypesFromBodyData(bodyData) {
  if (!bodyData || typeof bodyData !== 'object') {
    return [];
  }
  const bracket = bodyData['waste_types[]'];
  // Как в routes: сначала ветка только если поле truthy (пустая строка → смотрим waste_types)
  if (bracket !== undefined && bracket !== null && bracket !== '') {
    if (Array.isArray(bracket)) {
      return bracket;
    }
    return [bracket];
  }
  return parseWasteTypesFromField(bodyData.waste_types);
}

function parseJsonFieldSafe(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  return value;
}

/** Массив URL/строк из JSON-колонки или уже массива (без нормализации BASE_URL). */
function parseJsonArraySafe(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string' && v.trim() !== '');
  }
  const parsed = parseJsonFieldSafe(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v) => typeof v === 'string' && v.trim() !== '');
}

module.exports = {
  parseBooleanToDbInt,
  formatDateTimeForMySql,
  parseMultipartScalar,
  parseWasteTypesFromField,
  parseWasteTypesFromBodyData,
  parseJsonFieldSafe,
  parseJsonArraySafe,
};
