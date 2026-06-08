const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { uploadRequestPhotos, getFileUrlFromPath } = require('../middleware/upload');
const { normalizeDatesInObject } = require('../utils/datetime');
const {
  parseBooleanToDbInt,
  formatDateTimeForMySql,
  parseMultipartScalar,
  parseWasteTypesFromField,
  parseWasteTypesFromBodyData,
  parseJsonFieldSafe
} = require('../utils/requestPayloadParsers');
const { 
  sendRequestCreatedNotification, 
  sendJoinNotification, 
  sendSpeedCleanupNotification,
  sendRequestSubmittedNotification,
  sendRequestApprovedNotification,
  sendRequestRejectedNotification,
  sendModerationNotification
} = require('../services/pushNotification');
const { createGroupChatForRequest } = require('../utils/chatHelpers');
const { insertTransferPayoutCheck } = require('../utils/transferPayoutCheck.js');
const stripe = require('../config/stripe.js');
const { parseWorkDurationMinutesInput, normalizeRequestRowWorkDuration } = require('../utils/workDurationStats');

const router = express.Router();
const PUBLIC_BASE_URL = (process.env.BASE_URL || process.env.APP_URL || 'https://joypick.world').replace(/\/+$/, '');

/** Пуш «новая на модерации» — только без автомодерации; при AUTO_MODERATION — только proposed reject. */
function notifyModeratorsNewPendingRequest(payload) {
  const { isAutoModerationEnabled } = require('../services/requestModerationService');
  if (isAutoModerationEnabled()) {
    return;
  }
  sendModerationNotification(payload).catch(() => {});
}

/**
 * Преобразует сырую строку заявки из БД в объект для ответа (JSON-поля, булевы значения, даты).
 */
function toAbsolutePhotoUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/uploads/')) return `${PUBLIC_BASE_URL}${raw}`;
  if (raw.startsWith('uploads/')) return `${PUBLIC_BASE_URL}/${raw}`;
  return raw;
}

function parseJsonArraySafe(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    return value
      .filter((v) => typeof v === 'string' && v.trim() !== '')
      .map((v) => toAbsolutePhotoUrl(v))
      .filter((v) => typeof v === 'string' && v.trim() !== '');
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v) => typeof v === 'string' && v.trim() !== '')
          .map((v) => toAbsolutePhotoUrl(v))
          .filter((v) => typeof v === 'string' && v.trim() !== '');
      }
    } catch (e) {
      // Для обратной совместимости: допускаем CSV-строку URL.
      return s
        .split(',')
        .map((v) => toAbsolutePhotoUrl(v))
        .filter((v) => typeof v === 'string' && v.trim() !== '');
    }
  }
  return [];
}

function uniqueUrls(urls) {
  return Array.from(new Set((urls || []).filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())));
}

function normalizeExternalPhotoUrls(input) {
  const sources = [
    input?.image_url,
    input?.image_urls,
    input?.photo_url,
    input?.photo_urls,
    input?.photos,
    input?.photos_before,
    input?.photos_after,
    input?.['photos[]'],
    input?.['photos_before[]'],
    input?.['photos_after[]']
  ];
  const merged = [];
  for (const source of sources) {
    merged.push(...parseJsonArraySafe(source));
  }
  return uniqueUrls(merged);
}

function processRequestListItem(request) {
  const result = Object.assign({}, request);

  result.photos_before = parseJsonArraySafe(request.photos_before);
  result.photos_after = parseJsonArraySafe(request.photos_after);
  const directPhotos = parseJsonArraySafe(request.photos);
  result.photos = uniqueUrls(directPhotos.length > 0 ? directPhotos : [...result.photos_before, ...result.photos_after]);

  result.waste_types = parseJsonFieldSafe(request.waste_types, []);
  result.actual_participants = parseJsonFieldSafe(request.actual_participants, []);
  result.registered_participants = parseJsonFieldSafe(request.registered_participants, []);

  if (request.category === 'event' && request.created_by) {
    if (!result.registered_participants.includes(request.created_by)) {
      result.registered_participants.push(request.created_by);
    }
  }
  result.participant_completions = parseJsonFieldSafe(request.participant_completions, {});
  if (request.group_chat_id) {
    result.group_chat_id = request.group_chat_id;
  } else {
    result.group_chat_id = null;
  }

  result.private_chats = parseJsonFieldSafe(request.private_chats, []);

  result.only_foot = Boolean(result.only_foot);
  result.possible_by_car = Boolean(result.possible_by_car);
  result.is_open = Boolean(result.is_open);
  result.plant_tree = Boolean(result.plant_tree);
  result.trash_pickup_only = Boolean(result.trash_pickup_only);
  result.from_external_source = Boolean(result.from_external_source);

  if (request.earthday_cleanup_objectid != null && request.earthday_cleanup_objectid !== '') {
    const eo = Number(request.earthday_cleanup_objectid);
    result.earthday_cleanup_objectid = Number.isFinite(eo) ? eo : null;
  } else {
    result.earthday_cleanup_objectid = null;
  }

  normalizeRequestRowWorkDuration(result);

  const { attachCompletionIntegrityToRequest } = require('../services/completionIntegrityPersist');
  attachCompletionIntegrityToRequest(result);

  return normalizeDatesInObject(result);
}

/**
 * GET /api/requests
 * Получение списка заявок с фильтрацией.
 * Query search: подстрока (без учёта регистра) по name, description, city, id (с дефисами и без).
 */
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      status,
      city,
      latitude,
      longitude,
      radius = 10000, // радиус в метрах
      isOpen,
      userId,
      createdBy,
      takenBy,
      search: searchRaw,
    } = req.query;

    // Валидация и преобразование параметров пагинации
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20)); // Максимум 100 на странице
    const offset = (pageNum - 1) * limitNum;
    let query = `
      SELECT r.*
      FROM requests r
    `;

    const conditions = [];
    const params = [];

    if (category) {
      conditions.push('r.category = ?');
      params.push(category);
    }

    if (status) {
      conditions.push('r.status = ?');
      params.push(String(status).trim().toLowerCase());
    } else {
      // По умолчанию отклонённые модератором не показываем в списке
      conditions.push("r.status != 'rejected'");
    }

    if (city) {
      conditions.push('r.city = ?');
      params.push(city);
    }

    if (isOpen !== undefined) {
      conditions.push('r.is_open = ?');
      params.push(isOpen === 'true');
    }

    if (userId) {
      conditions.push('r.user_id = ?');
      params.push(userId);
    }

    if (createdBy) {
      conditions.push('r.created_by = ?');
      params.push(createdBy);
    }

    if (takenBy) {
      conditions.push('r.taken_by = ?');
      params.push(takenBy);
    }

    if (searchRaw !== undefined && searchRaw !== null && String(searchRaw).trim() !== '') {
      const searchTerm = String(searchRaw).trim();
      if (searchTerm.length > 50) {
        return error(res, 'search: максимум 50 символов', 400);
      }
      const low = searchTerm.toLowerCase();
      const idCompact = low.replace(/-/g, '');
      const idConds = ['LOCATE(?, LOWER(r.id)) > 0'];
      const idParams = [low];
      if (idCompact.length > 0) {
        idConds.push("LOCATE(?, REPLACE(LOWER(r.id), '-', '')) > 0");
        idParams.push(idCompact);
      }
      conditions.push(`(
        LOCATE(?, LOWER(COALESCE(r.name, ''))) > 0
        OR LOCATE(?, LOWER(COALESCE(r.description, ''))) > 0
        OR LOCATE(?, LOWER(COALESCE(r.city, ''))) > 0
        OR ${idConds.join(' OR ')}
      )`);
      params.push(low, low, low, ...idParams);
    }

    // Фильтр по радиусу (если указаны координаты)
    if (latitude && longitude) {
      conditions.push(`
        (6371000 * acos(
          cos(radians(?)) * cos(radians(r.latitude)) *
          cos(radians(r.longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(r.latitude))
        )) <= ?
      `);
      params.push(parseFloat(latitude), parseFloat(longitude), parseFloat(latitude), parseFloat(radius));
    }

    const whereClause =
      conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    query += `${whereClause} ORDER BY r.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

    const [requests] = await pool.execute(query, params);

    const processedRequests = requests.map(processRequestListItem);

    const countQuery = `SELECT COUNT(DISTINCT r.id) as total FROM requests r${whereClause}`;
    const [countResult] = await pool.execute(countQuery, params);
    const total = countResult[0].total;

    success(res, {
      requests: processedRequests,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    error(res, 'Error fetching requests list', 500, err);
  }
});

/**
 * GET /api/requests/my
 * Заявки, где текущий пользователь — создатель, исполнитель, донатер или участник.
 * Статус rejected не скрывается (в отличие от GET /api/requests без status).
 * Требует аутентификации.
 */
router.get('/my', authenticate, async (req, res) => {
  const userId = req.user.userId || req.user.id;
  if (!userId) {
    return error(res, 'Unauthorized', 401);
  }

  try {
    const { page = 1, limit = 20, category, status } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    // created_by, taken_by, donor, присоединившийся (joined_user_id для waste/speedCleanup), участник event (actual/registered_participants)
    const conditions = [
      `(r.created_by = ? OR r.taken_by = ? OR r.joined_user_id = ?
        OR r.id IN (SELECT request_id FROM donations WHERE user_id = ?)
        OR (r.actual_participants IS NOT NULL AND JSON_CONTAINS(r.actual_participants, CAST(CONCAT('"', ?, '"') AS JSON), '$'))
        OR (r.registered_participants IS NOT NULL AND JSON_CONTAINS(r.registered_participants, CAST(CONCAT('"', ?, '"') AS JSON), '$')))`
    ];
    const params = [userId, userId, userId, userId, userId, userId];

    if (category) {
      conditions.push('r.category = ?');
      params.push(category);
    }
    if (status) {
      conditions.push('r.status = ?');
      params.push(String(status).trim().toLowerCase());
    }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    const query = `
      SELECT r.*
      FROM requests r
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    const [requests] = await pool.execute(query, params);
    const processedRequests = requests.map((request) => {
      const item = processRequestListItem(request);
      if (item.created_by !== userId) {
        item.completion_integrity = null;
      }
      return item;
    });

    const countQuery = `
      SELECT COUNT(DISTINCT r.id) as total
      FROM requests r
      ${whereClause}
    `;
    const [countResult] = await pool.execute(countQuery, params);
    const total = countResult[0].total;

    success(res, {
      requests: processedRequests,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    error(res, 'Error retrieving my requests', 500, err);
  }
});

/**
 * Собрать объект заявки как в GET /api/requests/:id (поле request).
 * @returns {Promise<{ request: object }|null>}
 */
async function buildRequestDetailForApi(pool, id) {
  const [requests] = await pool.execute(
    `SELECT r.*
    FROM requests r
    WHERE r.id = ?`,
    [id]
  );

  if (requests.length === 0) {
    return null;
  }

  const request = requests[0];
    
    // Участники для event хранятся в JSON поле actual_participants (только реальные участники)
    // Для получения всех участников (включая зарегистрированных) нужно использовать таблицу donations или другой механизм
    // Пока оставляем пустым, так как участники event теперь хранятся в actual_participants
    request.participants = [];
    request.contributors = [];
    request.contributions = {};

    // Получение донатов
    const [donations] = await pool.execute(
      'SELECT * FROM donations WHERE request_id = ? ORDER BY created_at DESC',
      [id]
    );
    request.donations = donations;

    // Ожидаемая сумма исполнителю при pending (waste/speedCleanup) — чтобы показать «вы получите ~$X после одобрения»
    if (request.status === 'pending' && (request.category === 'wasteLocation' || request.category === 'speedCleanup') && donations.length > 0) {
      const totalDonations = donations.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
      const totalCents = Math.round(totalDonations * 100);
      const platformFeeCents = Math.round(totalCents * 0.07);
      const stripeFeeCents = Math.round(totalCents * 0.029) + (donations.length * 30);
      const transferCents = totalCents - platformFeeCents - stripeFeeCents;
      request.estimated_executor_payout_cents = Math.max(0, transferCents);
      request.estimated_executor_payout_dollars = (request.estimated_executor_payout_cents / 100).toFixed(2);
    } else {
      request.estimated_executor_payout_cents = null;
      request.estimated_executor_payout_dollars = null;
    }

    // Нормализуем фото и приводим /uploads/... к абсолютному URL.
    request.photos_before = parseJsonArraySafe(request.photos_before);
    request.photos_after = parseJsonArraySafe(request.photos_after);
    // Стабильный контракт для клиента: photos всегда присутствует.
    request.photos = uniqueUrls([...(request.photos_before || []), ...(request.photos_after || [])]);
    
    request.waste_types = parseJsonFieldSafe(request.waste_types, []);
    request.actual_participants = parseJsonFieldSafe(request.actual_participants, []);
    request.registered_participants = parseJsonFieldSafe(request.registered_participants, []);
    
    // КРИТИЧЕСКИ ВАЖНО: Для event заявок создатель всегда должен быть в списке участников
    if (request.category === 'event' && request.created_by) {
      if (!request.registered_participants.includes(request.created_by)) {
        request.registered_participants.push(request.created_by);
        // Сохраняем исправленный список в базу данных
        await pool.execute(
          'UPDATE requests SET registered_participants = ?, updated_at = NOW() WHERE id = ?',
          [JSON.stringify(request.registered_participants), id]
        );
      }
    }
    request.participant_completions = parseJsonFieldSafe(request.participant_completions, {});
    // Обработка group_chat_id
    if (request.group_chat_id) {
      request.group_chat_id = request.group_chat_id;
    } else {
      request.group_chat_id = null;
    }

    request.private_chats = parseJsonFieldSafe(request.private_chats, []);
    
    request.only_foot = Boolean(request.only_foot);
    request.possible_by_car = Boolean(request.possible_by_car);
    request.is_open = Boolean(request.is_open);
    request.plant_tree = Boolean(request.plant_tree);
    request.trash_pickup_only = Boolean(request.trash_pickup_only);
    request.from_external_source = Boolean(request.from_external_source);

    normalizeRequestRowWorkDuration(request);

    const { attachCompletionIntegrityToRequest } = require('../services/completionIntegrityPersist');
    attachCompletionIntegrityToRequest(request);

    // Нормализация дат в UTC
    const normalizedRequest = normalizeDatesInObject(request);
    
    // Нормализация дат в донатах
    if (normalizedRequest.donations && Array.isArray(normalizedRequest.donations)) {
      normalizedRequest.donations = normalizedRequest.donations.map(donation => 
        normalizeDatesInObject(donation)
      );
    }

    return { request: normalizedRequest };
}

/**
 * GET /api/requests/:id
 * Получение заявки по ID
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await buildRequestDetailForApi(pool, req.params.id);
    if (!result) {
      return error(res, 'Request not found', 404);
    }
    success(res, result);
  } catch (err) {
    error(res, 'Error fetching request', 500, err);
  }
});

/**
 * POST /api/requests
 * Создание новой заявки
 * Поддерживает загрузку файлов через multipart/form-data:
 * - photos: массив файлов для основных фото
 * - photos_before: массив файлов для фото "до"
 * - photos_after: массив файлов для фото "после"
 * 
 * Также поддерживает отправку URL через JSON (для обратной совместимости)
 */
router.post('/', authenticate, uploadRequestPhotos, [
  body('category').isIn(['wasteLocation', 'speedCleanup', 'event']).withMessage('Invalid category'),
  body('name').notEmpty().withMessage('Name is required'),
  body('description').custom((value, { req }) => {
    const { requiresDescriptionOnCreate } = require('../utils/clientAppCompat');
    if (!requiresDescriptionOnCreate(req)) return true;
    if (!value || !String(value).trim()) {
      throw new Error('Description is required');
    }
    return true;
  }),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('city').optional().isString()
], async (req, res, next) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }

    // Обработка загруженных файлов (только файлы, URL не принимаем)
    const uploadedPhotosBefore = [];
    const uploadedPhotosAfter = [];

    if (req.files) {
      // Обрабатываем фото "до"
      if (req.files.photos_before && Array.isArray(req.files.photos_before)) {
        for (const file of req.files.photos_before) {
          const fileUrl = getFileUrlFromPath(file.path);
          if (fileUrl) uploadedPhotosBefore.push(fileUrl);
        }
      }

      // Обрабатываем фото "после"
      if (req.files.photos_after && Array.isArray(req.files.photos_after)) {
        for (const file of req.files.photos_after) {
          const fileUrl = getFileUrlFromPath(file.path);
          if (fileUrl) uploadedPhotosAfter.push(fileUrl);
        }
      }
    }

    // Парсим JSON данные (если отправлены как JSON)
    let bodyData = req.body;
    if (typeof req.body === 'string') {
      try {
        bodyData = JSON.parse(req.body);
      } catch (e) {
        // Если не JSON, используем как есть
      }
    }


    const {
      category,
      name,
      description,
      latitude,
      longitude,
      city,
      garbage_size,
      only_foot = false,
      possible_by_car = false,
      reward_amount,
      start_date,
      end_date,
      status, // Статус может быть передан явно (для speedCleanup при переходе на страницу выполнения)
      priority = 'medium',
      waste_types = [],
      target_amount,
      plant_tree = false,
      trash_pickup_only = false,
      from_external_source: rawFromExternal
    } = bodyData;
    const startDateForDb = formatDateTimeForMySql(start_date);
    const endDateForDb = formatDateTimeForMySql(end_date);
    if ((start_date !== undefined && start_date !== null && start_date !== '' && !startDateForDb) ||
      (end_date !== undefined && end_date !== null && end_date !== '' && !endDateForDb)) {
      return error(res, 'start_date/end_date: некорректный формат даты', 400);
    }

    const onlyFootForDb = parseBooleanToDbInt(only_foot, 0);
    const possibleByCarForDb = parseBooleanToDbInt(possible_by_car, 0);
    const plantTreeForDb = parseBooleanToDbInt(plant_tree, 0);
    const trashPickupOnlyForDb = parseBooleanToDbInt(trash_pickup_only, 0);
    if (process.env.REQUESTS_DEBUG_BOOL_PARSING === '1') {
      console.info('[requests][create][bool-parse]', {
        originalUrl: req.originalUrl,
        category,
        only_foot: { raw: only_foot, parsed: onlyFootForDb, type: typeof only_foot },
        possible_by_car: { raw: possible_by_car, parsed: possibleByCarForDb, type: typeof possible_by_car },
        plant_tree: { raw: plant_tree, parsed: plantTreeForDb, type: typeof plant_tree },
        trash_pickup_only: { raw: trash_pickup_only, parsed: trashPickupOnlyForDb, type: typeof trash_pickup_only }
      });
    }
    if (onlyFootForDb === null || possibleByCarForDb === null || plantTreeForDb === null || trashPickupOnlyForDb === null) {
      return error(
        res,
        'only_foot/possible_by_car/plant_tree/trash_pickup_only: ожидаются boolean или 0/1',
        400
      );
    }

    let fromExternalSource = false;
    if (
      rawFromExternal === true ||
      rawFromExternal === 1 ||
      rawFromExternal === '1' ||
      rawFromExternal === 'true'
    ) {
      if (!req.user.isSuperAdmin) {
        return error(res, 'from_external_source: true доступно только суперадмину', 403);
      }
      fromExternalSource = true;
    } else if (
      rawFromExternal === false ||
      rawFromExternal === 0 ||
      rawFromExternal === '0' ||
      rawFromExternal === 'false' ||
      rawFromExternal === undefined ||
      rawFromExternal === null ||
      rawFromExternal === ''
    ) {
      fromExternalSource = false;
    } else {
      return error(res, 'from_external_source: ожидается boolean или 0/1', 400);
    }

    let earthdayCleanupObjectid = null;
    const rawEarthdayOid = bodyData.earthday_cleanup_objectid;
    if (rawEarthdayOid != null && rawEarthdayOid !== '') {
      if (!fromExternalSource || !req.user.isSuperAdmin) {
        return error(
          res,
          'earthday_cleanup_objectid допустим только при from_external_source: true и для суперадмина',
          400
        );
      }
      const e = typeof rawEarthdayOid === 'number' ? rawEarthdayOid : parseInt(String(rawEarthdayOid), 10);
      if (!Number.isFinite(e) || !Number.isInteger(e) || e <= 0) {
        return error(res, 'earthday_cleanup_objectid: ожидается положительное целое число', 400);
      }
      earthdayCleanupObjectid = e;
    }

    const hasWorkDuration =
      bodyData.work_duration_minutes !== undefined &&
      bodyData.work_duration_minutes !== null &&
      bodyData.work_duration_minutes !== '';
    if (hasWorkDuration && category !== 'speedCleanup') {
      return error(res, 'work_duration_minutes допустимо только для speedCleanup', 400);
    }
    let workDurationMinutesForInsert = null;
    if (category === 'speedCleanup' && hasWorkDuration) {
      try {
        workDurationMinutesForInsert = parseWorkDurationMinutesInput(bodyData.work_duration_minutes);
      } catch (e) {
        if (e.code === 'INVALID_WORK_DURATION') {
          return error(res, 'work_duration_minutes: ожидается целое от 0 до 10080', 400);
        }
        throw e;
      }
    }

    const processedWasteTypes = parseWasteTypesFromField(waste_types);

    const externalPhotos = fromExternalSource ? normalizeExternalPhotoUrls(bodyData) : [];

    // Для внешних (parsed) заявок допускаем URL-фото из source-полей и form-data:
    // image_url / image_urls / photo_url / photo_urls / photos / photos_before / photos_after (+ []-варианты).
    // Сохраняем их в photos_before, чтобы мобильный клиент гарантированно получил превью.
    const finalPhotosBefore = externalPhotos.length > 0
      ? uniqueUrls([...uploadedPhotosBefore, ...externalPhotos])
      : uploadedPhotosBefore;
    const finalPhotosAfter = uploadedPhotosAfter;

    const { checkRequestIntegrity, normalizeLocale } = require('../services/requestIntegrity');
    const { sendIntegrityCheckFailed } = require('../utils/integrityErrorResponse');
    const { SUPPORTED_LOCALES } = require('../services/translateNews');
    const {
      supportsIntegrityBlockOnCreate,
      normalizeDescriptionForCreate,
    } = require('../utils/clientAppCompat');

    const rawLocale = bodyData.locale ?? req.query?.locale;
    if (rawLocale != null && String(rawLocale).trim() !== '') {
      const locKey = String(rawLocale).trim().toLowerCase().split('-')[0];
      if (!SUPPORTED_LOCALES.includes(locKey)) {
        return error(
          res,
          `locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
          400
        );
      }
    }
    // Без integrity_enforce — legacy, locale не обязателен. С enforce — желателен с мобилки, иначе en / Accept-Language.
    const requestLocale = normalizeLocale(
      rawLocale || req.headers['accept-language']
    );
    const descriptionForCreate = normalizeDescriptionForCreate(req, description, name);
    const photoFilesBefore = (req.files?.photos_before || []).map((f) => f.path);
    const photoFilesAfter = (req.files?.photos_after || []).map((f) => f.path);

    const integrityResult = await checkRequestIntegrity({
      phase: 'create',
      category,
      name,
      description: descriptionForCreate,
      latitude,
      longitude,
      city,
      photosBefore: finalPhotosBefore,
      photosAfter: finalPhotosAfter,
      photoFilesBefore,
      photoFilesAfter,
      locale: requestLocale,
    });

    if (!integrityResult.ok && supportsIntegrityBlockOnCreate(req)) {
      return sendIntegrityCheckFailed(res, integrityResult);
    }

    const requestId = generateId();
    const userId = req.user.userId;

    // Определяем статус по умолчанию согласно новой концепции
    let defaultStatus = 'new'; // По умолчанию статус 'new'
    if (category === 'event') {
      // Для event статус сразу 'inProgress'
      defaultStatus = 'inProgress';
    } else if (status) {
      // Если статус передан явно (например, для speedCleanup при переходе на страницу выполнения)
      defaultStatus = status;
    }

    // Для event: создатель автоматически становится участником
    let registeredParticipants = null;
    if (category === 'event') {
      registeredParticipants = JSON.stringify([userId]);
    }

    // Для waste: 7 дней на присоединение; после истечения — уведомление о продлении на 7 дней или снятие через сутки
    const expiresAt = category === 'wasteLocation' 
      ? formatDateTimeForMySql(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
      : null;

    // Для event заявок инициализируем пустой массив приватных чатов
    let privateChats = null;
    if (category === 'event') {
      privateChats = JSON.stringify([]);
    }

    // КРИТИЧЕСКИ ВАЖНО: Сначала создаем заявку БЕЗ group_chat_id (NULL)
    // Потом создадим групповой чат и обновим заявку
    // Это нужно, чтобы избежать ошибки внешнего ключа (request_id должен существовать в таблице requests)
    // ВАЖНО: cost и payment_intent_id удалены - теперь все платежи через донаты
    await pool.execute(
      `INSERT INTO requests (
        id, user_id, category, name, description, latitude, longitude, city,
        garbage_size, only_foot, possible_by_car, reward_amount, is_open,
        start_date, end_date, status, priority, assigned_to, notes, created_by,
        taken_by, total_contributed, target_amount, joined_user_id, join_date,
        completion_comment, plant_tree, trash_pickup_only,
        created_at, updated_at, rejection_reason, rejection_message, actual_participants,
        photos_before, photos_after, registered_participants, waste_types, expires_at,
        extended_count, participant_completions, group_chat_id, private_chats, from_external_source,
        earthday_cleanup_objectid, work_duration_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requestId,
        userId,
        category,
        name,
        description || null,
        latitude || null,
        longitude || null,
        city || null,
        garbage_size || null,
        onlyFootForDb,
        possibleByCarForDb,
        reward_amount || null,
        true, // is_open по умолчанию true
        startDateForDb,
        endDateForDb,
        defaultStatus,
        priority,
        null, // assigned_to
        null, // notes
        userId, // created_by использует тот же userId
        null, // taken_by
        null, // total_contributed
        target_amount || null,
        null, // joined_user_id
        null, // join_date
        null, // completion_comment
        plantTreeForDb,
        trashPickupOnlyForDb,
        null, // rejection_reason
        null, // rejection_message
        null, // actual_participants
        finalPhotosBefore.length > 0 ? JSON.stringify(finalPhotosBefore) : null,
        finalPhotosAfter.length > 0 ? JSON.stringify(finalPhotosAfter) : null,
        registeredParticipants,
        processedWasteTypes.length > 0 ? JSON.stringify(processedWasteTypes) : null,
        expiresAt,
        0, // extended_count (NOT NULL, default 0)
        null, // participant_completions
        null, // group_chat_id пока NULL, обновим после создания чата
        privateChats,
        fromExternalSource ? 1 : 0,
        earthdayCleanupObjectid,
        workDurationMinutesForInsert
      ]
    );

    // КРИТИЧЕСКИ ВАЖНО: Теперь создаем групповой чат (заявка уже существует в БД)
    let groupChatId = null;
    try {
      groupChatId = await createGroupChatForRequest(requestId, userId, category);
      
      // Обновляем заявку с group_chat_id
      await pool.execute(
        'UPDATE requests SET group_chat_id = ? WHERE id = ?',
        [groupChatId, requestId]
      );
    } catch (chatErr) {
      // Если не удалось создать чат, удаляем заявку и возвращаем ошибку
      await pool.execute('DELETE FROM requests WHERE id = ?', [requestId]);
      return error(res, 'Error creating group chat', 500, chatErr);
    }

    // Инициализация participant_completions для создателя event заявки
    // Создатель автоматически одобрен (не требует подтверждения от заказчика)
    if (category === 'event') {
      try {
        const { initializeParticipantCompletion } = require('../utils/participantCompletions');
        await initializeParticipantCompletion(requestId, userId, true); // true = isCreator
      } catch (completionErr) {
        // Передаем детали ошибки в ответ API
        return error(res, 'Error initializing participant_completion for creator', 500, completionErr);
      }
    }

    if (earthdayCleanupObjectid != null) {
      await pool.execute(
        'UPDATE earthday_cleanups SET used_for_internal_request = 1 WHERE objectid = ?',
        [earthdayCleanupObjectid]
      );
    }

    // Получение созданной заявки
    const [requests] = await pool.execute(
      `SELECT r.*
      FROM requests r
      WHERE r.id = ?`,
      [requestId]
    );

    const request = requests[0];
    
    request.photos_before = parseJsonArraySafe(request.photos_before);
    request.photos_after = parseJsonArraySafe(request.photos_after);
    request.photos = uniqueUrls([...(request.photos_before || []), ...(request.photos_after || [])]);
    
    request.waste_types = parseJsonFieldSafe(request.waste_types, []);
    request.actual_participants = parseJsonFieldSafe(request.actual_participants, []);
    request.participants = [];
    request.contributors = [];
    request.contributions = {};
    request.donations = [];

    // Обработка group_chat_id и private_chats из БД
    if (request.group_chat_id) {
      request.group_chat_id = request.group_chat_id;
    } else {
      request.group_chat_id = null;
    }

    request.private_chats = parseJsonFieldSafe(request.private_chats, []);

    request.only_foot = Boolean(request.only_foot);
    request.possible_by_car = Boolean(request.possible_by_car);
    request.is_open = Boolean(request.is_open);
    request.plant_tree = Boolean(request.plant_tree);
    request.trash_pickup_only = Boolean(request.trash_pickup_only);
    request.from_external_source = Boolean(request.from_external_source);

    normalizeRequestRowWorkDuration(request);

    // Нормализация дат в UTC
    const normalizedRequest = normalizeDatesInObject(request);

    // Отправка push-уведомлений пользователям рядом (асинхронно, не блокируем ответ)
    if (latitude && longitude) {
      sendRequestCreatedNotification({
        id: requestId,
        category,
        name,
        created_by: userId,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        photos: [...finalPhotosBefore, ...finalPhotosAfter], // Объединяем все фото
      }).catch(err => {
        // Не прерываем выполнение, просто игнорируем ошибку
      });
    }

    success(res, { 
      request: normalizedRequest
    }, 'Request created', 201);
  } catch (err) {
    // Добавляем диагностическую информацию в ответ
    const diagnosticInfo = {
      originalError: err.message,
      sqlError: err.sql || null,
      errorCode: err.code || null,
      
      // Информация о структуре запроса
      insertColumnsCount: 45, // ожидаемое количество колонок
      insertColumns: [
        'id', 'user_id', 'category', 'name', 'description', 'latitude', 'longitude', 'city',
        'garbage_size', 'only_foot', 'possible_by_car', 'reward_amount', 'is_open',
        'start_date', 'end_date', 'status', 'priority', 'assigned_to', 'notes', 'created_by',
        'taken_by', 'total_contributed', 'target_amount', 'joined_user_id', 'join_date',
        'completion_comment', 'plant_tree', 'trash_pickup_only',
        'created_at', 'updated_at', 'rejection_reason', 'rejection_message', 'actual_participants',
        'photos_before', 'photos_after', 'registered_participants', 'waste_types', 'expires_at',
        'extended_count', 'participant_completions', 'group_chat_id', 'private_chats', 'from_external_source',
        'earthday_cleanup_objectid', 'work_duration_minutes'
      ],
      
      // Информация о параметрах
      valuesCount: 43, // количество ? плейсхолдеров + 2 NOW()
      nowCount: 2,
      totalParams: 45
    };
    
    // Возвращаем детальную ошибку клиенту
    error(res, 'VALUES_COUNT_41_EXPECTED_42_MISSING_1_PARAM', 500, { ...err, diagnostic: diagnosticInfo });
  }
});

/**
 * PUT /api/requests/:id
 * Обновление заявки
 * Поддерживает multipart/form-data с файлами
 */
router.put('/:id', authenticate, uploadRequestPhotos, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Обработка загруженных файлов (только файлы, URL не принимаем)
    const uploadedPhotosBefore = [];
    const uploadedPhotosAfter = [];

    if (req.files) {
      // Обрабатываем фото "до"
      if (req.files.photos_before && Array.isArray(req.files.photos_before)) {
        for (const file of req.files.photos_before) {
          const fileUrl = getFileUrlFromPath(file.path);
          if (fileUrl) uploadedPhotosBefore.push(fileUrl);
        }
      }

      // Обрабатываем фото "после"
      if (req.files.photos_after && Array.isArray(req.files.photos_after)) {
        for (const file of req.files.photos_after) {
          const fileUrl = getFileUrlFromPath(file.path);
          if (fileUrl) uploadedPhotosAfter.push(fileUrl);
        }
      }
    }

    // Проверка прав доступа
    const [existingRequests] = await pool.execute(
      'SELECT created_by, joined_user_id, category, start_date FROM requests WHERE id = ?',
      [id]
    );

    if (existingRequests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const createdBy = existingRequests[0].created_by;
    const joinedUserId = existingRequests[0].joined_user_id || null;
    const isCreator = createdBy && String(createdBy) === String(userId);
    const isExecutor = joinedUserId && String(joinedUserId) === String(userId);
    const isAdmin = req.user.isAdmin;

    // Создатель, исполнитель (joined_user_id) или админ может обновлять заявку
    if (!isCreator && !isExecutor && !isAdmin) {
      return error(res, 'Access denied', 403);
    }

    // Парсим данные из multipart/form-data
    // В form-data все значения приходят как строки, нужно их правильно обработать
    let bodyData = req.body;
    
    const wasteTypesArray = parseWasteTypesFromBodyData(bodyData);

    const {
      name,
      description,
      latitude,
      longitude,
      city,
      garbage_size,
      only_foot,
      possible_by_car,
      reward_amount,
      start_date,
      end_date,
      status,
      priority,
      is_open,
      target_amount,
      plant_tree,
      trash_pickup_only,
      completion_comment,
      rejection_reason,
      rejection_message,
      actual_participants,
      joined_user_id,
      join_date
    } = bodyData;

    // Используем обработанный массив waste_types
    const waste_types = wasteTypesArray.length > 0 ? wasteTypesArray : undefined;

    const updates = [];
    const params = [];

    if (bodyData.work_duration_minutes !== undefined) {
      const cat = String(existingRequests[0].category || '').toLowerCase();
      if (cat !== 'speedcleanup') {
        return error(res, 'work_duration_minutes допустимо только для speedCleanup', 400);
      }
      let wDm = null;
      if (bodyData.work_duration_minutes !== null && bodyData.work_duration_minutes !== '') {
        try {
          wDm = parseWorkDurationMinutesInput(bodyData.work_duration_minutes);
        } catch (e) {
          if (e.code === 'INVALID_WORK_DURATION') {
            return error(res, 'work_duration_minutes: ожидается целое от 0 до 10080', 400);
          }
          throw e;
        }
      }
      updates.push('work_duration_minutes = ?');
      params.push(wDm);
    }

    if (name !== undefined && name !== null && name !== '') {
      updates.push('name = ?');
      params.push(name);
    }
    if (description !== undefined && description !== null && description !== '') {
      updates.push('description = ?');
      params.push(description);
    }
    if (latitude !== undefined && latitude !== null && latitude !== '') {
      updates.push('latitude = ?');
      params.push(parseMultipartScalar(latitude, 'number'));
    }
    if (longitude !== undefined && longitude !== null && longitude !== '') {
      updates.push('longitude = ?');
      params.push(parseMultipartScalar(longitude, 'number'));
    }
    if (city !== undefined && city !== null && city !== '') {
      updates.push('city = ?');
      params.push(city);
    }
    if (garbage_size !== undefined && garbage_size !== null && garbage_size !== '') {
      updates.push('garbage_size = ?');
      params.push(parseMultipartScalar(garbage_size, 'number'));
    }
    if (only_foot !== undefined && only_foot !== null && only_foot !== '') {
      const parsedOnlyFoot = parseMultipartScalar(only_foot, 'boolean');
      if (parsedOnlyFoot === undefined) {
        return error(res, 'only_foot: ожидается boolean или 0/1', 400);
      }
      updates.push('only_foot = ?');
      params.push(parsedOnlyFoot);
    }
    if (possible_by_car !== undefined && possible_by_car !== null && possible_by_car !== '') {
      const parsedPossibleByCar = parseMultipartScalar(possible_by_car, 'boolean');
      if (parsedPossibleByCar === undefined) {
        return error(res, 'possible_by_car: ожидается boolean или 0/1', 400);
      }
      updates.push('possible_by_car = ?');
      params.push(parsedPossibleByCar);
    }
    // cost удален - теперь все платежи через донаты
    if (reward_amount !== undefined && reward_amount !== null && reward_amount !== '') {
      updates.push('reward_amount = ?');
      params.push(parseMultipartScalar(reward_amount, 'number'));
    }
    let eventStartRescheduledToFuture = false;
    if (start_date !== undefined) {
      const normalizedStartDate = formatDateTimeForMySql(start_date);
      if (start_date !== null && start_date !== '' && !normalizedStartDate) {
        return error(res, 'start_date: некорректный формат даты', 400);
      }
      const catNorm = String(existingRequests[0].category || '').toLowerCase();
      const existingStart = existingRequests[0].start_date;
      const explicitEmpty = start_date === null || start_date === '';
      const explicitValue =
        !explicitEmpty && normalizedStartDate != null && String(start_date).trim() !== '';

      if (catNorm === 'speedcleanup') {
        if (existingStart) {
          if (explicitValue) {
            updates.push('start_date = ?');
            params.push(normalizedStartDate);
          }
        } else if (explicitValue) {
          updates.push('start_date = ?');
          params.push(normalizedStartDate);
        }
      } else {
        updates.push('start_date = ?');
        params.push(normalizedStartDate);
        if (
          catNorm === 'event' &&
          normalizedStartDate &&
          new Date(normalizedStartDate).getTime() > Date.now()
        ) {
          eventStartRescheduledToFuture = true;
        }
      }
    }
    if (end_date !== undefined) {
      const normalizedEndDate = formatDateTimeForMySql(end_date);
      if (end_date !== null && end_date !== '' && !normalizedEndDate) {
        return error(res, 'end_date: некорректный формат даты', 400);
      }
      updates.push('end_date = ?');
      params.push(normalizedEndDate);
    }
    // Переменные для обработки изменения статуса
    let requestCategory = null;
    let requestCreatedBy = null;
    let requestJoinedUserId = null;
    let oldStatus = null;
    let statusChangedToPending = false;
    let statusChangedToApproved = false;
    let statusChangedToRejected = false;
    let speedCleanupEarnedCoin = false;

    if (status !== undefined && status !== null && status !== '') {
      const statusNormalized = typeof status === 'string' ? status.trim().toLowerCase() : String(status).toLowerCase();
      // Получаем текущие данные заявки перед обновлением
      const [currentRequest] = await pool.execute(
        'SELECT category, status, created_by, joined_user_id, start_date, end_date FROM requests WHERE id = ?',
        [id]
      );

      if (currentRequest.length > 0) {
        requestCategory = currentRequest[0].category;
        oldStatus = currentRequest[0].status;
        requestCreatedBy = currentRequest[0].created_by;
        requestJoinedUserId = currentRequest[0].joined_user_id;
        const categoryNormalized = requestCategory ? String(requestCategory).trim().toLowerCase() : '';

        // Проверяем изменение статуса на pending (отправка на рассмотрение)
        // КРИТИЧЕСКИ ВАЖНО: Для event и wasteLocation изменение статуса на pending разрешено ТОЛЬКО через /close-by-creator
        if (statusNormalized === 'pending' && oldStatus !== 'pending') {
          if (categoryNormalized === 'event' || categoryNormalized === 'wastelocation') { // wasteLocation в БД
            return error(res, 'For event and wasteLocation use POST /api/requests/:requestId/close-by-creator to close the request', 400);
          }
          statusChangedToPending = true;
        }

        // Проверяем изменение статуса на approved (одобрение)
        if (statusNormalized === 'approved' && oldStatus !== 'approved') {
          statusChangedToApproved = true;
          
          // Для speedCleanup проверяем разницу между start_date и end_date
          if (categoryNormalized === 'speedcleanup') {
            const startDate = currentRequest[0].start_date;
            const endDate = currentRequest[0].end_date;
            if (startDate && endDate) {
              const start = new Date(startDate);
              const end = new Date(endDate);
              const diffMinutes = (end - start) / (1000 * 60);
              speedCleanupEarnedCoin = diffMinutes >= 20;
            }
          }
        }

        // Проверяем изменение статуса на rejected (отклонение)
        if (statusNormalized === 'rejected' && oldStatus !== 'rejected') {
          statusChangedToRejected = true;
        }

        if (
          (statusNormalized === 'approved' || statusNormalized === 'rejected') &&
          (statusChangedToApproved || statusChangedToRejected)
        ) {
          if (!isAdmin) {
            return error(res, 'Only admin can approve or reject requests', 403);
          }
        }
      }

      const deferStatusToModerationService =
        statusChangedToApproved || statusChangedToRejected;

      if (!deferStatusToModerationService) {
        updates.push('status = ?');
        params.push(statusNormalized);
        if (statusNormalized === 'approved') {
          updates.push('approved_at = NOW()');
          updates.push('submitted_for_review_at = NULL');
        }
        if (statusNormalized === 'rejected') {
          updates.push('submitted_for_review_at = NULL');
        }
      }
    }
    if (statusChangedToPending) {
      updates.push('submitted_for_review_at = NOW()');
      updates.push('donation_window_started_at = COALESCE(donation_window_started_at, NOW())');
    }
    if (priority !== undefined && priority !== null && priority !== '') {
      updates.push('priority = ?');
      params.push(priority);
    }
    if (is_open !== undefined) {
      const parsedIsOpen = parseMultipartScalar(is_open, 'boolean');
      if (parsedIsOpen === undefined) {
        return error(res, 'is_open: ожидается boolean или 0/1', 400);
      }
      updates.push('is_open = ?');
      params.push(parsedIsOpen);
    }
    if (target_amount !== undefined && target_amount !== null && target_amount !== '') {
      updates.push('target_amount = ?');
      params.push(parseMultipartScalar(target_amount, 'number'));
    }
    if (plant_tree !== undefined && plant_tree !== null && plant_tree !== '') {
      const parsedPlantTree = parseMultipartScalar(plant_tree, 'boolean');
      if (parsedPlantTree === undefined) {
        return error(res, 'plant_tree: ожидается boolean или 0/1', 400);
      }
      updates.push('plant_tree = ?');
      params.push(parsedPlantTree);
    }
    if (trash_pickup_only !== undefined && trash_pickup_only !== null && trash_pickup_only !== '') {
      const parsedTrashPickupOnly = parseMultipartScalar(trash_pickup_only, 'boolean');
      if (parsedTrashPickupOnly === undefined) {
        return error(res, 'trash_pickup_only: ожидается boolean или 0/1', 400);
      }
      updates.push('trash_pickup_only = ?');
      params.push(parsedTrashPickupOnly);
    }
    if (completion_comment !== undefined && completion_comment !== null && completion_comment !== '') {
      updates.push('completion_comment = ?');
      params.push(completion_comment);
    }
    if (waste_types !== undefined && waste_types !== null && (Array.isArray(waste_types) ? waste_types.length > 0 : true)) {
      updates.push('waste_types = ?');
      params.push(Array.isArray(waste_types) && waste_types.length > 0 ? JSON.stringify(waste_types) : null);
    }
    if (rejection_reason !== undefined) {
      // Приравниваем пустую строку к null
      const normalizedRejectionReason = (rejection_reason === '' || rejection_reason === null) ? null : rejection_reason;
      updates.push('rejection_reason = ?');
      params.push(normalizedRejectionReason);
    }
    if (rejection_message !== undefined) {
      // Приравниваем пустую строку к null
      const normalizedRejectionMessage = (rejection_message === '' || rejection_message === null) ? null : rejection_message;
      updates.push('rejection_message = ?');
      params.push(normalizedRejectionMessage);
    }
    if (actual_participants !== undefined) {
      updates.push('actual_participants = ?');
      params.push(Array.isArray(actual_participants) ? JSON.stringify(actual_participants) : null);
    }
    
    // Валидация actual_participants: все ID должны быть UUID из БД
    if (actual_participants !== undefined && Array.isArray(actual_participants)) {
      for (const participantId of actual_participants) {
        if (participantId && !participantId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          return error(res, `actual_participants contains invalid ID: ${participantId}. All IDs must be UUIDs from the database (users.id).`, 400);
        }
      }
    }
    
    // Обработка отсоединения от заявки (joined_user_id и join_date = null)
    // Пустые строки приравниваются к null
    let normalizedJoinedUserId = null;
    let executorUnjoined = false; // Флаг для отслеживания отсоединения исполнителя от waste заявки
    let unjoinedUserId = null; // ID пользователя, который отсоединился
    
    if (joined_user_id !== undefined) {
      // Приравниваем пустую строку к null
      normalizedJoinedUserId = (joined_user_id === '' || joined_user_id === null) ? null : joined_user_id;
      
      // Валидация: joined_user_id должен быть UUID из БД (поле id) или null
      // НЕ принимаем Firebase UID - только UUID из базы данных
      if (normalizedJoinedUserId !== null && !normalizedJoinedUserId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        return error(res, 'joined_user_id must be a UUID from the database (users.id). Firebase UID is not supported. Use DB user id.', 400);
      }
      
      // Проверка существования пользователя в БД (если не null)
      if (normalizedJoinedUserId) {
        const [users] = await pool.execute(
          'SELECT id FROM users WHERE id = ?',
          [normalizedJoinedUserId]
        );
        
        if (users.length === 0) {
          return error(res, 'User with given ID not found in database', 404);
        }
      }
      
      // Проверяем отсоединение: если был присоединен исполнитель, а теперь null
      // Получаем текущее значение joined_user_id из заявки
      if (normalizedJoinedUserId === null) {
        const [currentRequest] = await pool.execute(
          'SELECT category, joined_user_id, created_by, name FROM requests WHERE id = ?',
          [id]
        );
        
        if (currentRequest.length > 0) {
          const currentJoinedUserId = currentRequest[0].joined_user_id;
          const currentCategory = currentRequest[0].category;
          
          // Если был присоединен исполнитель и теперь отсоединяется (только для wasteLocation)
          if (currentJoinedUserId && currentJoinedUserId !== null && currentCategory === 'wasteLocation') {
            executorUnjoined = true;
            unjoinedUserId = currentJoinedUserId;
            requestCreatedBy = currentRequest[0].created_by; // Сохраняем для уведомления
            requestCategory = currentCategory;
          }
        }
      }
      
      updates.push('joined_user_id = ?');
      params.push(normalizedJoinedUserId);
    }
    if (join_date !== undefined) {
      // Приравниваем пустую строку к null
      const normalizedJoinDate = formatDateTimeForMySql(join_date);
      if (join_date !== null && join_date !== '' && !normalizedJoinDate) {
        return error(res, 'join_date: некорректный формат даты', 400);
      }
      updates.push('join_date = ?');
      params.push(normalizedJoinDate);
    }
    
    // Обновление photos_before (только если загружены файлы)
    if (uploadedPhotosBefore.length > 0) {
      updates.push('photos_before = ?');
      params.push(JSON.stringify(uploadedPhotosBefore));
    }
    
    // Обновление photos_after (только если загружены файлы)
    if (uploadedPhotosAfter.length > 0) {
      updates.push('photos_after = ?');
      params.push(JSON.stringify(uploadedPhotosAfter));
    }

    // Для event: перенос времени (start_date/end_date) разрешён только создателю или админу
    if (start_date !== undefined || end_date !== undefined) {
      const [reqRow] = await pool.execute(
        'SELECT category FROM requests WHERE id = ?',
        [id]
      );
      if (reqRow.length > 0 && String(reqRow[0].category || '').toLowerCase() === 'event') {
        if (!isCreator && !isAdmin) {
          return error(res, 'Only the event creator or admin can reschedule the event', 403);
        }
      }
    }

    if (
      statusChangedToPending &&
      String(requestCategory || '').toLowerCase() === 'speedcleanup'
    ) {
      const [speedRows] = await pool.execute(
        `SELECT latitude, longitude, photos_before, photos_after, work_duration_minutes, start_date, end_date, join_date
         FROM requests WHERE id = ?`,
        [id]
      );
      if (speedRows.length > 0) {
        const speedRow = speedRows[0];
        let photosBeforeMerged = parseJsonArraySafe(speedRow.photos_before);
        let photosAfterMerged = parseJsonArraySafe(speedRow.photos_after);
        if (uploadedPhotosBefore.length > 0) photosBeforeMerged = uploadedPhotosBefore;
        if (uploadedPhotosAfter.length > 0) photosAfterMerged = uploadedPhotosAfter;

        let workMinutesCheck = speedRow.work_duration_minutes;
        if (bodyData.work_duration_minutes !== undefined && bodyData.work_duration_minutes !== null && bodyData.work_duration_minutes !== '') {
          try {
            workMinutesCheck = parseWorkDurationMinutesInput(bodyData.work_duration_minutes);
          } catch {
            /* validation already failed earlier */
          }
        }

        let effectiveEndDate = speedRow.end_date;
        if (bodyData.end_date !== undefined && bodyData.end_date !== null && bodyData.end_date !== '') {
          effectiveEndDate = formatDateTimeForMySql(bodyData.end_date) || speedRow.end_date;
        } else if (statusChangedToPending) {
          effectiveEndDate = new Date().toISOString();
        }
        const submittedAt = effectiveEndDate || new Date().toISOString();

        const { checkRequestIntegrity, normalizeLocale } = require('../services/requestIntegrity');
        const { integrityEnforceOrRespond } = require('../utils/integrityGate');
        const blockedSpeed = await integrityEnforceOrRespond(
          req,
          res,
          () =>
            checkRequestIntegrity({
              phase: 'close',
              category: 'speedCleanup',
              latitude: speedRow.latitude,
              longitude: speedRow.longitude,
              photosBefore: photosBeforeMerged,
              photosAfter: photosAfterMerged,
              photoFilesBefore: (req.files?.photos_before || []).map((f) => f.path),
              photoFilesAfter: (req.files?.photos_after || []).map((f) => f.path),
              completionLatitude: bodyData.completion_latitude,
              completionLongitude: bodyData.completion_longitude,
              workDurationMinutes: workMinutesCheck,
              joinDate: speedRow.join_date,
              startDate: speedRow.start_date,
              endDate: effectiveEndDate,
              submittedForReviewAt: submittedAt,
              locale: normalizeLocale(bodyData?.locale || req.query?.locale),
            }),
          { requestId: id }
        );
        if (blockedSpeed) return;

        const { clearCompletionIntegrityRejected } = require('../services/completionIntegrityPersist');
        await clearCompletionIntegrityRejected(id);
      }
    }

    if (updates.length === 0 && !statusChangedToApproved && !statusChangedToRejected) {
      return error(res, 'No data to update', 400);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(id);

      await pool.execute(
        `UPDATE requests SET ${updates.join(', ')} WHERE id = ?`,
        params
      );

      if (eventStartRescheduledToFuture) {
        await pool.execute(
          `DELETE FROM cron_actions
           WHERE request_id = ? AND action_type = 'checkEventAfterStartDate'`,
          [id]
        );
      }
    }

    // ========== ОБРАБОТКА ИЗМЕНЕНИЯ СТАТУСА ==========
    
    // 1. Обработка отправки на рассмотрение (pending)
    if (statusChangedToPending && requestCreatedBy) {
      try {
        // Получаем данные заявки для уведомлений
        const [requestData] = await pool.execute(
          `SELECT r.name, r.category, u.display_name as creator_name 
           FROM requests r 
           LEFT JOIN users u ON r.created_by = u.id 
           WHERE r.id = ?`,
          [id]
        );

        if (requestData.length > 0) {
          const requestInfo = requestData[0];
          
          // Отправляем пуш-уведомление создателю
          sendRequestSubmittedNotification({
            userIds: [requestCreatedBy],
            requestId: id,
            requestCategory: requestInfo.category || requestCategory,
          }).catch(() => {});

          notifyModeratorsNewPendingRequest({
            requestId: id,
            requestName: requestInfo.name || 'Unnamed Request',
            requestCategory: requestInfo.category || requestCategory,
            creatorName: requestInfo.creator_name || 'Unknown User',
          });

          const { runIntegrityOnPending } = require('../services/requestIntegrityOnPending');
          runIntegrityOnPending(id, { locale: bodyData?.locale || req.query?.locale }).catch((e) => {
            console.error('[requests] runIntegrityOnPending:', id, e?.message || e);
          });
        }
      } catch (error) {
        // Игнорируем ошибки обработки отправки на рассмотрение
      }
    }

    // 2–3. Финальная модерация (approve/reject) — единый сервис
    let wasteTransferResult = null;
    if (statusChangedToApproved || statusChangedToRejected) {
      const requestModerationService = require('../services/requestModerationService');
      try {
        const modResult = await requestModerationService.finalizeModeration(id, {
          action: statusChangedToApproved ? 'approve' : 'reject',
          source: 'manual',
          adminUserId: req.user.userId,
          rejectionReason: rejection_reason,
          rejectionMessage: rejection_message,
        });
        if (modResult.transfer_result) {
          wasteTransferResult = modResult.transfer_result;
        }
      } catch (modErr) {
        if (modErr.code === 'INVALID_STATUS') {
          return error(res, modErr.message, 400);
        }
        console.error('[requests] finalizeModeration error:', modErr);
        return error(res, 'Error finalizing moderation', 500, modErr);
      }
    }

    // 4. Обработка отсоединения исполнителя от waste заявки
    if (executorUnjoined && unjoinedUserId && requestCreatedBy) {
      try {
        // Получаем данные заявки для уведомления
        const [requestData] = await pool.execute(
          'SELECT name FROM requests WHERE id = ?',
          [id]
        );

        if (requestData.length > 0) {
          const requestName = requestData[0].name || 'Request';
          
          // Отправляем push-уведомление создателю
          sendJoinNotification({
            requestId: id,
            requestName: requestName,
            requestCategory: requestCategory || 'wasteLocation',
            creatorId: requestCreatedBy,
            actionUserId: unjoinedUserId,
            actionType: 'unjoined',
          }).catch(err => {
          });
        }
      } catch (error) {
        // Игнорируем ошибки обработки отсоединения исполнителя
      }
    }

    // Получение обновленной заявки
    const [requests] = await pool.execute(
      `SELECT r.*
      FROM requests r
      WHERE r.id = ?`,
      [id]
    );

    const request = requests[0];
    
    request.photos_before = parseJsonArraySafe(request.photos_before);
    request.photos_after = parseJsonArraySafe(request.photos_after);
    request.photos = uniqueUrls([...(request.photos_before || []), ...(request.photos_after || [])]);
    request.waste_types = parseJsonFieldSafe(request.waste_types, []);
    request.actual_participants = parseJsonFieldSafe(request.actual_participants, []);
    request.participant_completions = parseJsonFieldSafe(request.participant_completions, {});
// Нормализация дат в UTC
    const normalizedRequest = normalizeDatesInObject(request);

    const responseData = { request: normalizedRequest };
    if (wasteTransferResult) {
      responseData.transfer_result = wasteTransferResult;
    }
    success(res, responseData, 'Request updated');
  } catch (err) {
    error(res, 'Error updating request', 500, err);
  }
});

/**
 * DELETE /api/requests/:id
 * Удаление заявки
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Проверка прав доступа
    const [existingRequests] = await pool.execute(
      'SELECT created_by FROM requests WHERE id = ?',
      [id]
    );

    if (existingRequests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    // Только создатель или админ может удалять
    if (existingRequests[0].created_by !== userId && !req.user.isAdmin) {
      return error(res, 'Access denied', 403);
    }

    // Получаем все PaymentIntent для заявки (только донаты)
    // ВАЖНО: Теперь все платежи идут через донаты, включая платеж создателя
    const [donations] = await pool.execute(
      'SELECT payment_intent_id FROM donations WHERE request_id = ?',
      [id]
    );

    // Собираем все PaymentIntent ID для отмены
    const paymentIntentIds = [];
    donations.forEach(d => {
      if (d.payment_intent_id && !paymentIntentIds.includes(d.payment_intent_id)) {
        paymentIntentIds.push(d.payment_intent_id);
      }
    });

    // Отменяем или возвращаем все PaymentIntent в Stripe
    // Для requires_capture - отменяем (размораживаем средства)
    // Для succeeded - делаем refund (возвращаем деньги на карту)
    const cancelErrors = [];
    const refundErrors = [];
    const refundedPaymentIntents = [];
    
    for (const paymentIntentId of paymentIntentIds) {
      try {
        // Проверяем статус PaymentIntent
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.status === 'succeeded') {
          // Платеж уже захвачен - делаем refund (возвращаем деньги на карту)
          try {
            // Получаем charge для refund
            const charges = await stripe.charges.list({
              payment_intent: paymentIntentId,
              limit: 1
            });
            
            if (charges.data.length > 0) {
              const charge = charges.data[0];
              // Делаем полный refund
              await stripe.refunds.create({
                charge: charge.id,
                reason: 'requested_by_customer'
              });
              
              refundedPaymentIntents.push(paymentIntentId);
              
              // Обновляем статус в БД
              await pool.execute(
                'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
                ['refunded', paymentIntentId]
              );
            }
          } catch (refundErr) {
            refundErrors.push({
              payment_intent_id: paymentIntentId,
              error: refundErr.message
            });
          }
        } else if (paymentIntent.status !== 'canceled' && 
                   paymentIntent.status !== 'succeeded' &&
                   (paymentIntent.status === 'requires_capture' || 
                    paymentIntent.status === 'requires_payment_method' ||
                    paymentIntent.status === 'requires_confirmation' ||
                    paymentIntent.status === 'requires_action')) {
          // Платеж еще не захвачен - отменяем (размораживаем средства)
          await stripe.paymentIntents.cancel(paymentIntentId);
          
          // Обновляем статус в БД
          await pool.execute(
            'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
            ['canceled', paymentIntentId]
          );
        }
      } catch (cancelErr) {
        // Игнорируем ошибки отмены/refund (возможно, уже отменен или refunded)
        cancelErrors.push({
          payment_intent_id: paymentIntentId,
          error: cancelErr.message
        });
      }
    }

    const { releaseEarthdayCleanupOnRequestDelete } = require('../utils/earthdayRequestLink');
    await releaseEarthdayCleanupOnRequestDelete(pool, id);

    // Удаляем ВСЕ чаты заявки (group и private) перед удалением заявки
    const { deleteAllChatsForRequest } = require('../utils/chatHelpers');
    await deleteAllChatsForRequest(id);

    await pool.execute('DELETE FROM requests WHERE id = ?', [id]);

    // Возвращаем информацию об отмене/refund PaymentIntent
    if (paymentIntentIds.length > 0) {
      const response = {
        refunded_payment_intents: refundedPaymentIntents.length,
        canceled_payment_intents: paymentIntentIds.length - refundedPaymentIntents.length - cancelErrors.length - refundErrors.length
      };
      
      if (cancelErrors.length > 0) {
        response.cancel_errors = cancelErrors;
      }
      if (refundErrors.length > 0) {
        response.refund_errors = refundErrors;
      }
      
      const message = refundedPaymentIntents.length > 0 
        ? 'Request deleted, funds returned to cards'
        : 'Request deleted, frozen funds returned';
      
      success(res, response, message);
    } else {
      success(res, null, 'Request deleted');
    }
  } catch (err) {
    error(res, 'Error deleting request', 500, err);
  }
});

/**
 * POST /api/requests/:id/join
 * Присоединение к заявке (для waste location)
 */
router.post('/:id/join', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Проверка существования заявки
    const [requests] = await pool.execute(
      'SELECT id, category, name, created_by, joined_user_id, join_date FROM requests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const request = requests[0];

    // Проверка типа заявки
    if (request.category !== 'wasteLocation') {
      return error(res, 'Cannot join this request type', 400);
    }

    // Проверка статуса заявки
    // Можно присоединиться только к заявкам со статусом 'new'
    const [currentRequest] = await pool.execute(
      'SELECT status FROM requests WHERE id = ?',
      [id]
    );
    if (currentRequest.length === 0) {
      return error(res, 'Request not found', 404);
    }
    
    const requestStatus = currentRequest[0].status;

    // Разрешаем присоединение: статус 'new' ИЛИ статус 'inProgress' при пустом joined_user_id (исправление рассинхрона)
    const canJoin = requestStatus === 'new' || (requestStatus === 'inProgress' && !request.joined_user_id);
    if (!canJoin) {
      const statusReasons = {
        inProgress: 'Someone has already joined this request',
        approved: 'Request has been approved and is closed',
        archived: 'Request is archived',
        rejected: 'Request was rejected',
        pending_payment: 'Request is awaiting payment',
        pendingApproval: 'Request is under review',
      };
      const reason = statusReasons[requestStatus] || `Request status: ${requestStatus}`;
      return error(res, reason, 400, { request_status: requestStatus, reason });
    }

    // Проверка, не присоединился ли уже кто-то (другой пользователь)
    if (request.joined_user_id && request.joined_user_id !== userId) {
      // Проверка истечения срока (1 день)
      const joinDate = new Date(request.join_date);
      const now = new Date();
      const oneDayLater = new Date(joinDate.getTime() + 24 * 60 * 60 * 1000);

      if (now < oneDayLater) {
        return error(res, 'Another user has already joined this request', 409);
      }
    }

    // Присоединение: меняем статус на 'inProgress' и сохраняем joined_user_id
    await pool.execute(
      'UPDATE requests SET joined_user_id = ?, join_date = NOW(), status = ?, updated_at = NOW() WHERE id = ?',
      [userId, 'inProgress', id]
    );

    // Инициализация participant_completions для присоединившегося участника
    try {
      const { initializeParticipantCompletion } = require('../utils/participantCompletions');
      await initializeParticipantCompletion(id, userId);
    } catch (completionErr) {
      // Передаем детали ошибки в ответ API
      return error(res, 'Error initializing participant_completion', 500, completionErr);
    }

    // Добавление присоединившегося в групповой чат заявки (СИНХРОННО - важно для корректной работы)
    try {
      const { addUserToGroupChatByRequest } = require('../utils/chatHelpers');
      await addUserToGroupChatByRequest(id, userId);
    } catch (chatErr) {
      // Передаем детали ошибки в ответ API
      return error(res, 'Error adding to group chat', 500, chatErr);
    }

    // Отправка push-уведомления создателю заявки (асинхронно)
    if (request.created_by) {
      sendJoinNotification({
        requestId: id,
        requestName: request.name || 'Request',
        requestCategory: request.category,
        creatorId: request.created_by,
        actionUserId: userId,
        actionType: 'joined',
      }).catch(err => {
      });
    }

    success(res, null, 'You have joined the request');
  } catch (err) {
    error(res, 'Error joining request', 500, err);
  }
});

/**
 * PUT /api/requests/:id/close-event
 * @deprecated Используйте POST /api/requests/:requestId/close-by-creator
 * Этот эндпоинт отключен в пользу новой системы participant_completions
 * Для закрытия event и waste заявок используйте POST /api/requests/:requestId/close-by-creator
 */
router.put('/:id/close-event', authenticate, uploadRequestPhotos, async (req, res) => {
  return error(res, 'This endpoint is disabled. Use POST /api/requests/:requestId/close-by-creator for event and wasteLocation', 410);
});

/**
 * POST /api/requests/:id/participate
 * Участие в событии (для event)
 */
router.post('/:id/participate', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Проверка существования заявки
    const [requests] = await pool.execute(
      'SELECT id, category, name, created_by, registered_participants FROM requests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const request = requests[0];

    if (request.category !== 'event') {
      return error(res, 'This is not an event', 400);
    }

    // Проверка, не является ли пользователь создателем
    if (request.created_by === userId) {
      return error(res, 'You are already the event creator', 409);
    }

    // Получаем текущий список зарегистрированных участников
    let registeredParticipants = parseJsonFieldSafe(request.registered_participants, []);

    // КРИТИЧЕСКИ ВАЖНО: Создатель всегда должен быть в списке участников
    // Если его там нет, добавляем его обратно
    if (!registeredParticipants.includes(request.created_by)) {
      registeredParticipants.push(request.created_by);
    }

    // Проверка, не участвует ли уже
    const isAlreadyParticipant = registeredParticipants.includes(userId);
    
    if (!isAlreadyParticipant) {
      // Добавляем пользователя в список участников
      registeredParticipants.push(userId);
      
      // КРИТИЧЕСКИ ВАЖНО: Убеждаемся, что создатель остается в списке
      // (на случай, если он был удален по какой-то причине)
      if (!registeredParticipants.includes(request.created_by)) {
        registeredParticipants.push(request.created_by);
      }
      
      await pool.execute(
        'UPDATE requests SET registered_participants = ?, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(registeredParticipants), id]
      );

      // Инициализация participant_completions для присоединившегося участника
      try {
        const { initializeParticipantCompletion } = require('../utils/participantCompletions');
        await initializeParticipantCompletion(id, userId);
      } catch (completionErr) {
        // Передаем детали ошибки в ответ API
        return error(res, 'Error initializing participant_completion', 500, completionErr);
      }
    }

    // Добавление участника события в групповой чат заявки (СИНХРОННО - важно для корректной работы)
    // Выполняем всегда, даже если пользователь уже участник (на случай, если он был удален из чата)
    try {
      const { addUserToGroupChatByRequest } = require('../utils/chatHelpers');
      await addUserToGroupChatByRequest(id, userId);
    } catch (chatErr) {
      // Передаем детали ошибки в ответ API
      return error(res, 'Error adding to group chat', 500, chatErr);
    }

    // КРИТИЧЕСКИ ВАЖНО: Создаем приватный чат между участником и создателем
    // и добавляем его в массив private_chats заявки
    try {
      const { generateId } = require('../utils/uuid');
      const { addUserToChat } = require('../utils/chatHelpers');
      
      // Получаем текущий массив private_chats
      const [requestData] = await pool.execute(
        'SELECT private_chats FROM requests WHERE id = ?',
        [id]
      );
      
      let privateChats = [];
      if (requestData[0].private_chats) {
        try {
          privateChats = typeof requestData[0].private_chats === 'string'
            ? JSON.parse(requestData[0].private_chats)
            : requestData[0].private_chats;
        } catch (e) {
          privateChats = [];
        }
      }

      // Проверяем, существует ли уже приватный чат для этого участника
      const existingPrivateChat = privateChats.find(pc => pc.user_id === userId);
      let privateChatId;

      // Сначала проверяем БД на наличие чата для этого request_id и user_id
      const [existingChatsInDb] = await pool.execute(
        `SELECT id FROM chats WHERE type = 'private' AND request_id = ? AND user_id = ?`,
        [id, userId]
      );

      if (existingChatsInDb.length > 0) {
        // Чат уже существует в БД
        privateChatId = existingChatsInDb[0].id;
        
        // Если его нет в массиве private_chats, добавляем
        if (!existingPrivateChat) {
          privateChats.push({
            chat_id: privateChatId,
            user_id: userId
          });
        } else if (existingPrivateChat.chat_id !== privateChatId) {
          // Обновляем chat_id в массиве, если он не совпадает
          existingPrivateChat.chat_id = privateChatId;
        }
      } else if (existingPrivateChat && existingPrivateChat.chat_id) {
        // Чат есть в массиве, но не в БД - проверяем, существует ли он
        const [chatCheck] = await pool.execute(
          'SELECT id FROM chats WHERE id = ?',
          [existingPrivateChat.chat_id]
        );

        if (chatCheck.length > 0) {
          // Чат существует, используем его
          privateChatId = existingPrivateChat.chat_id;
        } else {
          // Чат не существует, создаем новый
          privateChatId = generateId();
          try {
            await pool.execute(
              `INSERT INTO chats (id, type, request_id, user_id, created_by, created_at, last_message_at)
               VALUES (?, 'private', ?, ?, ?, NOW(), NOW())`,
              [privateChatId, id, userId, userId]
            );
            existingPrivateChat.chat_id = privateChatId;
          } catch (insertErr) {
            // Если ошибка дубликата - ищем существующий чат
            if (insertErr.code === 'ER_DUP_ENTRY') {
              const [duplicateChats] = await pool.execute(
                `SELECT id FROM chats WHERE type = 'private' AND request_id = ? AND user_id = ?`,
                [id, userId]
              );
              if (duplicateChats.length > 0) {
                privateChatId = duplicateChats[0].id;
                existingPrivateChat.chat_id = privateChatId;
              } else {
                throw insertErr;
              }
            } else {
              throw insertErr;
            }
          }
        }
      } else {
        // СНАЧАЛА проверяем, существует ли уже приватный чат для этого пользователя и заявки
        const [existingChats] = await pool.execute(
          `SELECT id FROM chats WHERE type = 'private' AND request_id = ? AND user_id = ?`,
          [id, userId]
        );

        if (existingChats.length > 0) {
          // Чат уже существует - используем его
          privateChatId = existingChats[0].id;
        } else {
          // Создаем новый приватный чат
          privateChatId = generateId();
          try {
            await pool.execute(
              `INSERT INTO chats (id, type, request_id, user_id, created_by, created_at, last_message_at)
               VALUES (?, 'private', ?, ?, ?, NOW(), NOW())`,
              [privateChatId, id, userId, userId]
            );
          } catch (insertErr) {
            // Если ошибка дубликата - ищем существующий чат (race condition)
            if (insertErr.code === 'ER_DUP_ENTRY') {
              const [duplicateChats] = await pool.execute(
                `SELECT id FROM chats WHERE type = 'private' AND request_id = ? AND user_id = ?`,
                [id, userId]
              );
              if (duplicateChats.length > 0) {
                privateChatId = duplicateChats[0].id;
              } else {
                // Пробуем найти по другому критерию (может быть индекс на type+request_id)
                const [altChats] = await pool.execute(
                  `SELECT id FROM chats WHERE type = 'private' AND request_id = ? LIMIT 1`,
                  [id]
                );
                if (altChats.length > 0) {
                  privateChatId = altChats[0].id;
                } else {
                  return error(res, 'Failed to create private chat', 500, {
                    errorMessage: 'Chat already exists but could not be found',
                    errorCode: insertErr.code,
                    requestId: id,
                    userId: userId,
                    sqlMessage: insertErr.sqlMessage
                  });
                }
              }
            } else {
              throw insertErr;
            }
          }
        }

        // Добавляем новый приватный чат в массив
        privateChats.push({
          chat_id: privateChatId,
          user_id: userId
        });
      }

      // Добавляем обоих участников в чат (если они еще не добавлены)
      await addUserToChat(privateChatId, userId);
      await addUserToChat(privateChatId, request.created_by);

      // Обновляем массив private_chats в заявке
      // Если пользователь уже был участником и чат уже был в массиве, обновление не изменит данные
      // Но если чат был создан или найден в БД, но не был в массиве - обновим массив
      await pool.execute(
        'UPDATE requests SET private_chats = ?, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(privateChats), id]
      );
    } catch (privateChatErr) {
      // Передаем детали ошибки в ответ API
      return error(res, 'Error creating private chat', 500, privateChatErr);
    }

    // Отправка push-уведомления создателю заявки (асинхронно)
    // Отправляем только если пользователь новый участник
    if (!isAlreadyParticipant && request.created_by) {
      sendJoinNotification({
        requestId: id,
        requestName: request.name || 'Event',
        requestCategory: request.category,
        creatorId: request.created_by,
        actionUserId: userId,
        actionType: 'participated',
      }).catch(err => {
      });
    }

    // Возвращаем успешный ответ (даже если пользователь уже был участником)
    const message = isAlreadyParticipant 
      ? 'You are already participating in this event' 
      : 'You have joined the event';
    success(res, null, message);
  } catch (err) {
    error(res, 'Error joining event', 500, err);
  }
});

/**
 * DELETE /api/requests/:id/participate
 * Отмена участия в событии
 */
router.delete('/:id/participate', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Получаем текущий список зарегистрированных участников
    const [requests] = await pool.execute(
      'SELECT id, category, created_by, registered_participants FROM requests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const request = requests[0];

    if (request.category !== 'event') {
      return error(res, 'This is not an event', 400);
    }

    // КРИТИЧЕСКИ ВАЖНО: Создатель не может отменить участие (он всегда остается участником)
    if (request.created_by === userId) {
      return error(res, 'Event creator cannot cancel participation', 400);
    }

    // Получаем текущий список участников
    let registeredParticipants = parseJsonFieldSafe(request.registered_participants, []);

    // Удаляем пользователя из списка участников
    registeredParticipants = registeredParticipants.filter(p => p !== userId);
    
    // КРИТИЧЕСКИ ВАЖНО: Убеждаемся, что создатель всегда остается в списке
    if (request.created_by && !registeredParticipants.includes(request.created_by)) {
      registeredParticipants.push(request.created_by);
    }
    
    await pool.execute(
      'UPDATE requests SET registered_participants = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(registeredParticipants), id]
    );

    // Удаляем пользователя из группового чата
    const { removeUserFromGroupChatByRequest } = require('../utils/chatHelpers');
    removeUserFromGroupChatByRequest(id, userId).catch(err => {
      // Не прерываем выполнение, просто игнорируем ошибку
    });

    // КРИТИЧЕСКИ ВАЖНО: Удаляем приватный чат из массива private_chats
    try {
      // Получаем текущий массив private_chats
      const [requestData] = await pool.execute(
        'SELECT private_chats FROM requests WHERE id = ?',
        [id]
      );
      
      let privateChats = [];
      if (requestData[0].private_chats) {
        try {
          privateChats = typeof requestData[0].private_chats === 'string'
            ? JSON.parse(requestData[0].private_chats)
            : requestData[0].private_chats;
        } catch (e) {
          privateChats = [];
        }
      }

      // Удаляем приватный чат для этого пользователя из массива
      privateChats = privateChats.filter(chat => chat.user_id !== userId);

      // Обновляем массив private_chats в заявке
      await pool.execute(
        'UPDATE requests SET private_chats = ?, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(privateChats), id]
      );
    } catch (privateChatErr) {
      // Не прерываем выполнение, просто игнорируем ошибку
    }

    success(res, null, 'Participation cancelled');
  } catch (err) {
    error(res, 'Error cancelling participation', 500, err);
  }
});

/**
 * Обработка одобрения заявки типа wasteLocation.
 * Возвращает { transferCreated: boolean, transferError?: string } чтобы админка/фронт видели причину, если Transfer не создан.
 */
async function handleWasteApproval(requestId, creatorId) {
  const coinsToAward = 1;
  const awardedUserIds = new Set();
  let transferResult = { transferCreated: false };

  // 0. Удаляем из заявки донаты с неуспешным платежом (как будто их не было)
  const { removeFailedDonationsFromRequest } = require('../utils/donationTransferHelpers');
  await removeFailedDonationsFromRequest(requestId).catch(() => {});

  // 1. Начисляем коины создателю
  if (creatorId) {
    await pool.execute(
      'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_created = COALESCE(coins_from_created, 0) + ?, updated_at = NOW() WHERE id = ?',
      [coinsToAward, coinsToAward, creatorId]
    );
    awardedUserIds.add(creatorId);
  }

  // 2. Начисляем коины исполнителю (joined_user_id) для wasteLocation
  const [requestDataForExecutor] = await pool.execute(
    'SELECT joined_user_id FROM requests WHERE id = ?',
    [requestId]
  );
  const executorUserIds = [];
  const executorId = requestDataForExecutor[0]?.joined_user_id;
  if (executorId && !awardedUserIds.has(executorId)) {
    await pool.execute(
      'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
      [coinsToAward, coinsToAward, executorId]
    );
    awardedUserIds.add(executorId);
    executorUserIds.push(executorId);
  }

  // 3. Начисляем коины донатерам
  const [donations] = await pool.execute(
    'SELECT DISTINCT user_id, amount FROM donations WHERE request_id = ?',
    [requestId]
  );
  const donorUserIds = [];
  for (const donation of donations) {
    if (donation.user_id && !awardedUserIds.has(donation.user_id)) {
      await pool.execute(
        'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
        [coinsToAward, coinsToAward, donation.user_id]
      );
      awardedUserIds.add(donation.user_id);
      donorUserIds.push(donation.user_id);
    }
  }

  // 4. Переводим деньги исполнителю только если у него полный Stripe (can_receive_payouts).
  // Иначе не делаем transfer и не возвращаем донатерам — вся сумма остаётся на счёте приложения.
  const totalDonations = donations.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
  const totalAmountCents = Math.round(totalDonations * 100);
  const platformFeeCents = Math.round(totalAmountCents * 0.07);
  const stripeFeeCents = Math.round(totalAmountCents * 0.029) + (donations.length * 30);
  const transferAmountCents = totalAmountCents - platformFeeCents - stripeFeeCents;

  if (!executorId) {
    transferResult.transferError = 'executor_missing';
  } else if (transferAmountCents <= 0) {
    transferResult.transferError = 'no_donations_or_zero_amount';
  } else {
    try {
      const [executorUser] = await pool.execute(
        'SELECT can_receive_payouts FROM users WHERE id = ?',
        [executorId]
      );
      const [stripeAccounts] = await pool.execute(
        'SELECT account_id FROM stripe_accounts WHERE user_id = ?',
        [executorId]
      );
      const executorCanReceive = executorUser[0]?.can_receive_payouts === 1 && stripeAccounts.length > 0;

      if (!executorCanReceive) {
        transferResult.transferError = 'executor_incomplete_stripe';
        transferResult.left_on_platform = true;
      } else {
        const stripeAccountId = stripeAccounts[0].account_id;
        let sourcePaymentIntentId = null;

        const [paymentIntentsFromDb] = await pool.execute(
          `SELECT payment_intent_id FROM donations d
           JOIN payment_intents pi ON d.payment_intent_id = pi.payment_intent_id
           WHERE d.request_id = ? AND pi.status = 'succeeded'
           LIMIT 1`,
    [requestId]
  );
        if (paymentIntentsFromDb.length > 0) {
          sourcePaymentIntentId = paymentIntentsFromDb[0].payment_intent_id;
        }
        if (!sourcePaymentIntentId) {
          const [donationsWithPi] = await pool.execute(
            'SELECT payment_intent_id FROM donations WHERE request_id = ? AND payment_intent_id IS NOT NULL',
            [requestId]
          );
          for (const row of donationsWithPi) {
            try {
              const stripePI = await stripe.paymentIntents.retrieve(row.payment_intent_id);
              if (stripePI.status === 'succeeded') {
                sourcePaymentIntentId = stripePI.id;
                await pool.execute(
                  'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
                  ['succeeded', stripePI.id]
                );
                break;
              }
            } catch (e) {}
          }
        }

        if (!sourcePaymentIntentId) {
          transferResult.transferError = 'no_succeeded_payment_in_stripe';
        } else {
          // source_transaction принимает charge id (ch_xxx), не payment_intent id (pi_xxx)
          let sourceTransactionId = null;
          try {
            const pi = await stripe.paymentIntents.retrieve(sourcePaymentIntentId, { expand: ['latest_charge'] });
            const lc = pi.latest_charge;
            sourceTransactionId = (typeof lc === 'object' && lc?.id) ? lc.id : (typeof lc === 'string' ? lc : null);
          } catch (e) {}
          const transfer = await stripe.transfers.create({
            amount: transferAmountCents,
            currency: 'usd',
            destination: stripeAccountId,
            source_transaction: sourceTransactionId || undefined,
            metadata: {
              request_id: requestId,
              performer_user_id: executorId
            }
          });
          const transferId = generateId();
          await pool.execute(
            `INSERT INTO transfers (id, transfer_id, request_id, performer_user_id, amount_cents, platform_fee_cents, stripe_fee_cents, currency, status, source_payment_intent_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              transferId,
              transfer.id,
              requestId,
              executorId,
              transferAmountCents,
              platformFeeCents,
              stripeFeeCents,
              'usd',
              'pending',
              sourcePaymentIntentId
            ]
          );
          insertTransferPayoutCheck(transferId, executorId, transferAmountCents).catch(() => {});
          transferResult = { transferCreated: true };
        }
      }
    } catch (transferErr) {
      transferResult.transferError = transferErr.message || 'stripe_transfer_failed';
    }
  }

  // 5. Отправляем push-уведомления
  if (creatorId) {
    sendRequestApprovedNotification({ userIds: [creatorId], requestId, messageType: 'creator', requestCategory: 'wasteLocation' }).catch(() => {});
  }
  if (executorUserIds.length > 0) {
    // Отправляем исполнителю уведомление с информацией о выплате
    const payoutAmount = transferAmountCents > 0 ? (transferAmountCents / 100).toFixed(2) : null;
    sendRequestApprovedNotification({ 
      userIds: executorUserIds, 
      requestId, 
      messageType: 'executor', 
      requestCategory: 'wasteLocation',
      payoutAmount: payoutAmount
    }).catch(() => {});
  }
  if (donorUserIds.length > 0) {
    sendRequestApprovedNotification({ userIds: donorUserIds, requestId, messageType: 'donor', requestCategory: 'wasteLocation' }).catch(() => {});
  }

  // 6. Удаляем групповой чат заявки (асинхронно, не блокируем выполнение)
  const { deleteGroupChatForRequest } = require('../utils/chatHelpers');
  deleteGroupChatForRequest(requestId).catch(() => {});

  // Статус остаётся approved. В archived переводит cron после всех выплат и окончания срока.
  return transferResult;
}

/**
 * Обработка одобрения заявки типа event
 */
async function handleEventApproval(requestId, creatorId) {
  const coinsToAward = 1;
  const awardedUserIds = new Set();

  // 0. Удаляем из заявки донаты с неуспешным платежом (как будто их не было)
  const { removeFailedDonationsFromRequest } = require('../utils/donationTransferHelpers');
  await removeFailedDonationsFromRequest(requestId).catch(() => {});

  // 1. Начисляем коины заказчику (создателю заявки)
  if (creatorId) {
    await pool.execute(
      'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_created = COALESCE(coins_from_created, 0) + ?, updated_at = NOW() WHERE id = ?',
      [coinsToAward, coinsToAward, creatorId]
    );
    // НЕ добавляем creatorId в awardedUserIds, так как создатель также является участником
    // и должен получить коины и как заказчик, и как approved участник
  }

  // 3. Начисляем коины только approved участникам из participant_completions
  // КРИТИЧЕСКИ ВАЖНО: Создатель также является участником и автоматически одобрен
  // Он получает коины и как заказчик (за создание заявки), и как approved участник (за участие)
  const { getApprovedParticipants } = require('../utils/participantCompletions');
  const approvedParticipants = await getApprovedParticipants(requestId);
  
  const participantUserIds = [];
  for (const participantId of approvedParticipants) {
    if (participantId) {
      // Для создателя: начисляем коины как за участие (coins_from_participation)
      // Для остальных участников: также начисляем коины как за участие
      // Создатель получает коины дважды: как заказчик (уже начислено выше) и как участник (начисляем здесь)
      await pool.execute(
        'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
        [coinsToAward, coinsToAward, participantId]
      );
      awardedUserIds.add(participantId);
      participantUserIds.push(participantId);
    }
  }

  // 4. Начисляем коины донатерам
  const [donations] = await pool.execute(
    'SELECT DISTINCT user_id, amount FROM donations WHERE request_id = ?',
    [requestId]
  );
  const donorUserIds = [];
  for (const donation of donations) {
    if (donation.user_id && !awardedUserIds.has(donation.user_id)) {
      await pool.execute(
        'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
        [coinsToAward, coinsToAward, donation.user_id]
      );
      awardedUserIds.add(donation.user_id);
      donorUserIds.push(donation.user_id);
    }
  }

  // 5. Общую сумму делим на всех approved участников. Долю тех, у кого полный Stripe — переводим им.
  // Долю тех, у кого нет полного Stripe — оставляем на счёте приложения (не переводим, не возвращаем).
  const totalDonations = donations.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
  const totalAmountCents = Math.round(totalDonations * 100);
  const platformFeeCents = Math.round(totalAmountCents * 0.07);
  const stripeFeeCents = Math.round(totalAmountCents * 0.029) + (donations.length * 30);
  const netTransferCents = totalAmountCents - platformFeeCents - stripeFeeCents;
  const totalParticipants = approvedParticipants.length || 1;
  const amountPerPerson = totalParticipants > 0 ? Math.floor(netTransferCents / totalParticipants) : 0;

  const eligibleParticipantIds = approvedParticipants.length > 0
    ? (await pool.execute(
        `SELECT u.id FROM users u
         INNER JOIN stripe_accounts sa ON sa.user_id = u.id
         WHERE u.can_receive_payouts = 1 AND u.id IN (${approvedParticipants.map(() => '?').join(',')})`,
        approvedParticipants
      ))[0].map(r => r.id)
    : [];

  let participantsWithPayout = [];
  if (eligibleParticipantIds.length > 0 && amountPerPerson > 0) {
      let sourcePaymentIntentId = null;
      const [paymentIntentsFromDb] = await pool.execute(
        `SELECT payment_intent_id FROM donations d
         JOIN payment_intents pi ON d.payment_intent_id = pi.payment_intent_id
         WHERE d.request_id = ? AND pi.status = 'succeeded'
         LIMIT 1`,
        [requestId]
      );
      if (paymentIntentsFromDb.length > 0) sourcePaymentIntentId = paymentIntentsFromDb[0].payment_intent_id;
      if (!sourcePaymentIntentId) {
        const [donationsWithPi] = await pool.execute(
          'SELECT payment_intent_id FROM donations WHERE request_id = ? AND payment_intent_id IS NOT NULL',
          [requestId]
        );
        for (const row of donationsWithPi) {
          try {
            const stripePI = await stripe.paymentIntents.retrieve(row.payment_intent_id);
            if (stripePI.status === 'succeeded') {
              sourcePaymentIntentId = stripePI.id;
              await pool.execute(
                'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
                ['succeeded', stripePI.id]
              );
              break;
            }
          } catch (e) {}
        }
      }
      let sourceTransactionId = null;
      if (sourcePaymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(sourcePaymentIntentId, { expand: ['latest_charge'] });
          const lc = pi.latest_charge;
          sourceTransactionId = (typeof lc === 'object' && lc?.id) ? lc.id : (typeof lc === 'string' ? lc : null);
        } catch (e) {}
      }
      if (sourcePaymentIntentId) {
        const platformFeePerTransfer = Math.floor(platformFeeCents / eligibleParticipantIds.length);
        const stripeFeePerTransfer = Math.floor(stripeFeeCents / eligibleParticipantIds.length);
        for (const performerId of eligibleParticipantIds) {
          try {
            const [acc] = await pool.execute('SELECT account_id FROM stripe_accounts WHERE user_id = ?', [performerId]);
            if (acc.length === 0) continue;
            const transfer = await stripe.transfers.create({
              amount: amountPerPerson,
              currency: 'usd',
              destination: acc[0].account_id,
              source_transaction: sourceTransactionId || undefined,
              metadata: { request_id: requestId, performer_user_id: performerId }
            });
            const transferId = generateId();
            await pool.execute(
              `INSERT INTO transfers (id, transfer_id, request_id, performer_user_id, amount_cents, platform_fee_cents, stripe_fee_cents, currency, status, source_payment_intent_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [transferId, transfer.id, requestId, performerId, amountPerPerson, platformFeePerTransfer, stripeFeePerTransfer, 'usd', 'pending', sourcePaymentIntentId]
            );
            insertTransferPayoutCheck(transferId, performerId, amountPerPerson).catch(() => {});
            participantsWithPayout.push({ userId: performerId, amountCents: amountPerPerson });
          } catch (transferErr) {}
        }
      }
  }
  // Если нет участников с полным Stripe — ничего не переводим и не возвращаем, сумма остаётся на счёте приложения.

  // 6. Отправляем push-уведомления
  if (creatorId) {
    const creatorPayout = participantsWithPayout.find(p => p.userId === creatorId);
    const payoutAmount = creatorPayout ? (creatorPayout.amountCents / 100).toFixed(2) : null;
    sendRequestApprovedNotification({
      userIds: [creatorId],
      requestId,
      messageType: 'creator',
      requestCategory: 'event',
      payoutAmount: payoutAmount
    }).catch(() => {});
  }
  if (participantUserIds.length > 0) {
    for (const p of participantsWithPayout) {
      if (p.userId !== creatorId) {
        sendRequestApprovedNotification({
          userIds: [p.userId],
          requestId,
          messageType: 'participant',
          requestCategory: 'event',
          payoutAmount: (p.amountCents / 100).toFixed(2)
        }).catch(() => {});
      }
    }
    const notifiedParticipantIds = new Set(participantsWithPayout.map(p => p.userId));
    const others = participantUserIds.filter(id => !notifiedParticipantIds.has(id));
    if (others.length > 0) {
      sendRequestApprovedNotification({ userIds: others, requestId, messageType: 'participant', requestCategory: 'event' }).catch(() => {});
    }
  }
  if (donorUserIds.length > 0) {
    sendRequestApprovedNotification({ userIds: donorUserIds, requestId, messageType: 'donor', requestCategory: 'event' }).catch(() => {});
  }

  // 7. Удаляем групповой чат заявки (асинхронно, не блокируем выполнение)
  const { deleteGroupChatForRequest } = require('../utils/chatHelpers');
  deleteGroupChatForRequest(requestId).catch(() => {});

  // Статус остаётся approved. В archived переводит cron после всех выплат и окончания срока.
}

/**
 * Обработка одобрения заявки типа speedCleanup: распределение донатов создателю + коины создателю и донатерам.
 */
async function handleSpeedCleanupApproval(requestId, creatorId, earnedCoin) {
  const coinsToAward = 1;
  const { removeFailedDonationsFromRequest } = require('../utils/donationTransferHelpers');
  await removeFailedDonationsFromRequest(requestId).catch(() => {});

  const [donations] = await pool.execute(
    'SELECT id, user_id, amount, payment_intent_id FROM donations WHERE request_id = ?',
    [requestId]
  );

  // 1. Коины создателю (если earnedCoin)
  if (earnedCoin && creatorId) {
    await pool.execute(
      'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_created = COALESCE(coins_from_created, 0) + ?, updated_at = NOW() WHERE id = ?',
      [coinsToAward, coinsToAward, creatorId]
    );
  }

  // 2. Коины донатерам (по 1 каждому, кроме создателя)
  const donorUserIds = [];
  for (const d of donations) {
    if (d.user_id && d.user_id !== creatorId) {
      await pool.execute(
        'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
        [coinsToAward, coinsToAward, d.user_id]
      );
      donorUserIds.push(d.user_id);
    }
  }

  // 3. Деньги: вся сумма донатов (за вычетом комиссий) — создателю
  const totalDonations = donations.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
  const totalAmountCents = Math.round(totalDonations * 100);
  const platformFeeCents = Math.round(totalAmountCents * 0.07);
  const stripeFeeCents = Math.round(totalAmountCents * 0.029) + (donations.length * 30);
  const netTransferCents = totalAmountCents - platformFeeCents - stripeFeeCents;

  if (creatorId && netTransferCents > 0) {
    const [accRows] = await pool.execute('SELECT account_id FROM stripe_accounts WHERE user_id = ?', [creatorId]);
    if (accRows.length > 0) {
      let sourcePaymentIntentId = null;
      const [piFromDb] = await pool.execute(
        `SELECT payment_intent_id FROM donations d JOIN payment_intents pi ON d.payment_intent_id = pi.payment_intent_id WHERE d.request_id = ? AND pi.status = 'succeeded' LIMIT 1`,
        [requestId]
      );
      if (piFromDb.length > 0) sourcePaymentIntentId = piFromDb[0].payment_intent_id;
      if (!sourcePaymentIntentId) {
        const [donWithPi] = await pool.execute('SELECT payment_intent_id FROM donations WHERE request_id = ? AND payment_intent_id IS NOT NULL', [requestId]);
        for (const row of donWithPi) {
          try {
            const pi = await stripe.paymentIntents.retrieve(row.payment_intent_id);
            if (pi.status === 'succeeded') {
              sourcePaymentIntentId = pi.id;
              break;
            }
          } catch (_) {}
        }
      }
      let sourceTransactionId = null;
      if (sourcePaymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(sourcePaymentIntentId, { expand: ['latest_charge'] });
          sourceTransactionId = pi.latest_charge?.id || (typeof pi.latest_charge === 'string' ? pi.latest_charge : null);
        } catch (_) {}
      }
      if (sourcePaymentIntentId) {
        try {
          const transfer = await stripe.transfers.create({
            amount: netTransferCents,
            currency: 'usd',
            destination: accRows[0].account_id,
            source_transaction: sourceTransactionId || undefined,
            metadata: { request_id: requestId, performer_user_id: creatorId }
          });
          const transferId = generateId();
          await pool.execute(
            `INSERT INTO transfers (id, transfer_id, request_id, performer_user_id, amount_cents, platform_fee_cents, stripe_fee_cents, currency, status, source_payment_intent_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [transferId, transfer.id, requestId, creatorId, netTransferCents, platformFeeCents, stripeFeeCents, 'usd', 'pending', sourcePaymentIntentId]
          );
          insertTransferPayoutCheck(transferId, creatorId, netTransferCents).catch(() => {});
        } catch (transferErr) {}
      }
    }
  }

  if (creatorId) {
    sendSpeedCleanupNotification({ userIds: [creatorId], earnedCoin: earnedCoin }).catch(() => {});
  }
  if (donorUserIds.length > 0) {
    sendRequestApprovedNotification({ userIds: donorUserIds, requestId, messageType: 'donor', requestCategory: 'speedCleanup' }).catch(() => {});
  }
}

/**
 * Перед переводом speedCleanup в archived: выплата только по донатам после одобрения (деньги — создателю, коины — только новым донатерам).
 * Вызывается из крона в autoCompleteSpeedCleanup. Идемпотентно по cron_actions.
 *
 * @returns {Promise<{ done: boolean, skipped?: boolean, paid?: number, hadPostApprovalDonations: boolean }>}
 */
async function payoutSpeedCleanupNewDonationsBeforeArchive(requestId) {
  const [reqRows] = await pool.execute(
    'SELECT id, created_by, approved_at FROM requests WHERE id = ? AND category = ? AND status = ?',
    [requestId, 'speedCleanup', 'approved']
  );
  if (reqRows.length === 0 || !reqRows[0].approved_at) {
    return { done: false, hadPostApprovalDonations: false };
  }
  const creatorId = reqRows[0].created_by;
  const approvedAt = reqRows[0].approved_at;

  const [alreadyDone] = await pool.execute(
    `SELECT id FROM cron_actions WHERE action_type = 'payoutSpeedCleanupBeforeArchive' AND request_id = ? AND status = 'completed' LIMIT 1`,
    [requestId]
  );
  if (alreadyDone.length > 0) {
    return { done: true, skipped: true, hadPostApprovalDonations: true };
  }

  const [donations] = await pool.execute(
    'SELECT id, user_id, amount, payment_intent_id, created_at FROM donations WHERE request_id = ? AND created_at > ?',
    [requestId, approvedAt]
  );
  if (donations.length === 0) {
    return { done: true, paid: 0, hadPostApprovalDonations: false };
  }

  const coinsToAward = 1;
  for (const d of donations) {
    if (d.user_id && d.user_id !== creatorId) {
      await pool.execute(
        'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
        [coinsToAward, coinsToAward, d.user_id]
      );
    }
  }

  const totalDonations = donations.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
  const totalAmountCents = Math.round(totalDonations * 100);
  const platformFeeCents = Math.round(totalAmountCents * 0.07);
  const stripeFeeCents = Math.round(totalAmountCents * 0.029) + (donations.length * 30);
  const netTransferCents = totalAmountCents - platformFeeCents - stripeFeeCents;

  if (creatorId && netTransferCents > 0) {
    const [accRows] = await pool.execute('SELECT account_id FROM stripe_accounts WHERE user_id = ?', [creatorId]);
    if (accRows.length > 0) {
      let sourcePaymentIntentId = null;
      for (const d of donations) {
        if (!d.payment_intent_id) continue;
        try {
          const pi = await stripe.paymentIntents.retrieve(d.payment_intent_id);
          if (pi.status === 'succeeded') {
            sourcePaymentIntentId = pi.id;
            break;
          }
        } catch (_) {}
      }
      let sourceTransactionId = null;
      if (sourcePaymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(sourcePaymentIntentId, { expand: ['latest_charge'] });
          sourceTransactionId = pi.latest_charge?.id || (typeof pi.latest_charge === 'string' ? pi.latest_charge : null);
        } catch (_) {}
      }
      if (sourcePaymentIntentId) {
        try {
          const transfer = await stripe.transfers.create({
            amount: netTransferCents,
            currency: 'usd',
            destination: accRows[0].account_id,
            source_transaction: sourceTransactionId || undefined,
            metadata: { request_id: requestId, performer_user_id: creatorId }
          });
          const transferId = generateId();
          await pool.execute(
            `INSERT INTO transfers (id, transfer_id, request_id, performer_user_id, amount_cents, platform_fee_cents, stripe_fee_cents, currency, status, source_payment_intent_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [transferId, transfer.id, requestId, creatorId, netTransferCents, platformFeeCents, stripeFeeCents, 'usd', 'pending', sourcePaymentIntentId]
          );
          insertTransferPayoutCheck(transferId, creatorId, netTransferCents).catch(() => {});
        } catch (_) {}
      }
    }
  }

  await pool.execute(
    `INSERT INTO cron_actions (id, action_type, request_id, request_category, action_description, status, executed_at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [generateId(), 'payoutSpeedCleanupBeforeArchive', requestId, 'speedCleanup', `Payout of post-approval donations (${donations.length}) before archive`, 'completed']
  );
  const donorIds = donations.map(d => d.user_id).filter(Boolean);
  if (donorIds.length > 0) {
    sendRequestApprovedNotification({ userIds: donorIds, requestId, messageType: 'donor', requestCategory: 'speedCleanup' }).catch(() => {});
  }
  return { done: true, paid: donations.length, hadPostApprovalDonations: true };
}

/**
 * Вернуть донаты по заявке (Stripe refund/cancel). Не меняет статус заявки и не трогает jcoins.
 * @returns {Promise<string[]>} уникальные user_id донатеров
 */
async function refundDonationsForRequest(requestId) {
  const [donations] = await pool.execute(
    'SELECT DISTINCT user_id, amount, payment_intent_id FROM donations WHERE request_id = ?',
    [requestId]
  );
  const donorUserIdSet = new Set();
  for (const donation of donations) {
    if (donation.amount && donation.amount > 0 && donation.payment_intent_id) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(donation.payment_intent_id);

        if (paymentIntent.status === 'succeeded') {
          const charges = await stripe.charges.list({
            payment_intent: donation.payment_intent_id,
            limit: 1
          });

          if (charges.data.length > 0) {
            await stripe.refunds.create({
              charge: charges.data[0].id,
              reason: 'requested_by_customer'
            });

            await pool.execute(
              'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
              ['refunded', donation.payment_intent_id]
            );
          }
        } else if (paymentIntent.status !== 'canceled') {
          await stripe.paymentIntents.cancel(donation.payment_intent_id);

          await pool.execute(
            'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
            ['canceled', donation.payment_intent_id]
          );
        }

        if (donation.user_id) donorUserIdSet.add(donation.user_id);
      } catch (stripeErr) {
        if (donation.user_id) donorUserIdSet.add(donation.user_id);
      }
    }
  }
  return [...donorUserIdSet];
}

/**
 * Таймаут модерации: деньги донатам назад, статус archived, без отката коинов и без удаления group chat
 * (participant_completions / work_duration_minutes сохраняются).
 */
async function archivePendingModerationTimeout(requestId, category, creatorId) {
  const finalMessage =
    'Заявка снята с модерации (нет апрува в срок). Донаты возвращены. Данные о работе и начисления сохранены.';

  const donorUserIds = await refundDonationsForRequest(requestId);

  if (creatorId) {
    sendRequestRejectedNotification({
      userIds: [creatorId],
      requestId,
      messageType: 'creator',
      rejectionMessage: finalMessage,
      requestCategory: category
    }).catch(() => {});
  }
  if (donorUserIds.length > 0) {
    sendRequestRejectedNotification({
      userIds: donorUserIds,
      requestId,
      messageType: 'donor',
      rejectionMessage: finalMessage,
      requestCategory: category
    }).catch(() => {});
  }

  await pool.execute(
    'UPDATE requests SET status = ?, submitted_for_review_at = NULL, updated_at = NOW() WHERE id = ?',
    ['archived', requestId]
  );
}

/**
 * Обработка отклонения заявки
 */
async function handleRequestRejection(requestId, category, creatorId, rejectionReason, rejectionMessage) {
  const { resolveRejectionNotificationText, looksLikeIntegrityCode } = require('../utils/rejectionNotificationText');
  const primaryCode = looksLikeIntegrityCode(rejectionReason) ? String(rejectionReason).trim() : null;
  const resolved = resolveRejectionNotificationText({
    rejectionMessage: rejectionMessage || rejectionReason,
    primaryCode,
    messageType: 'creator',
  });
  const finalMessage = resolved.body;

  const donorUserIds = await refundDonationsForRequest(requestId);

  const [roleRows] = await pool.execute(
    'SELECT joined_user_id FROM requests WHERE id = ?',
    [requestId]
  );
  const executorId = roleRows[0]?.joined_user_id || null;

  if (creatorId) {
    sendRequestRejectedNotification({
      userIds: [creatorId],
      requestId,
      messageType: 'creator',
      rejectionMessage: finalMessage,
      requestCategory: category,
      primaryCode: resolved.primaryCode,
      messageKey: resolved.messageKey,
    }).catch(() => {});
  }
  if (executorId && executorId !== creatorId) {
    sendRequestRejectedNotification({
      userIds: [executorId],
      requestId,
      messageType: 'executor',
      rejectionMessage: finalMessage,
      requestCategory: category,
      primaryCode: resolved.primaryCode,
      messageKey: resolved.messageKey,
    }).catch(() => {});
  }
  if (donorUserIds.length > 0) {
    sendRequestRejectedNotification({
      userIds: donorUserIds,
      requestId,
      messageType: 'donor',
      rejectionMessage: finalMessage,
      requestCategory: category,
      primaryCode: resolved.primaryCode,
      messageKey: resolved.messageKey,
    }).catch(() => {});
  }

  // 5. Удаляем групповой чат заявки (асинхронно, не блокируем выполнение)
  const { deleteGroupChatForRequest } = require('../utils/chatHelpers');
  deleteGroupChatForRequest(requestId).catch(() => {});

  // 6. Устанавливаем статус на rejected (на случай, если он еще не установлен)
  await pool.execute(
    'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
    ['rejected', requestId]
  );
}

/**
 * POST /api/requests/:id/extend
 * Продление заявки waste еще на неделю (максимум одно продление)
 */
router.post('/:id/extend', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Получаем заявку
    const [requests] = await pool.execute(
      `SELECT id, category, status, created_by, expires_at, extended_count
       FROM requests 
       WHERE id = ?`,
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const request = requests[0];

    // Проверяем, что это waste заявка
    if (request.category !== 'wasteLocation') {
      return error(res, 'Extension available only for wasteLocation requests', 400);
    }

    // Проверяем, что заявка в статусе new
    if (request.status !== 'new') {
      return error(res, 'Extension available only for requests with status new', 400);
    }

    // Проверяем, что пользователь - создатель заявки
    if (request.created_by !== userId) {
      return error(res, 'Only the request creator can extend it', 403);
    }

    // Проверяем, что заявка еще не была продлена
    if (request.extended_count >= 1) {
      return error(res, 'Request was already extended. Maximum one extension.', 400);
    }

    // Проверяем, что заявка еще не истекла
    if (request.expires_at && new Date(request.expires_at) <= new Date()) {
      return error(res, 'Request has already expired and cannot be extended', 400);
    }

    // Продлеваем заявку на 7 дней (один раз), extended_count = 1
    const currentExpiresAt = request.expires_at 
      ? new Date(request.expires_at)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    const newExpiresAt = new Date(currentExpiresAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const newExpiresAtString = formatDateTimeForMySql(newExpiresAt);

    await pool.execute(
      `UPDATE requests 
       SET expires_at = ?, extended_count = ?, updated_at = NOW() 
       WHERE id = ?`,
      [newExpiresAtString, 1, id]
    );

    // Получаем обновленную заявку
    const [updatedRequests] = await pool.execute(
      `SELECT r.*
       FROM requests r
       WHERE r.id = ?`,
      [id]
    );

    const updatedRequest = updatedRequests[0];
    
    // Обработка JSON полей
    updatedRequest.photos_before = parseJsonArraySafe(updatedRequest.photos_before);
    updatedRequest.photos_after = parseJsonArraySafe(updatedRequest.photos_after);
    updatedRequest.photos = uniqueUrls([...(updatedRequest.photos_before || []), ...(updatedRequest.photos_after || [])]);

    updatedRequest.waste_types = parseJsonFieldSafe(updatedRequest.waste_types, []);
    updatedRequest.actual_participants = parseJsonFieldSafe(updatedRequest.actual_participants, []);
    updatedRequest.registered_participants = parseJsonFieldSafe(updatedRequest.registered_participants, []);

    // Получение донатов
    const [donations] = await pool.execute(
      'SELECT * FROM donations WHERE request_id = ? ORDER BY created_at DESC',
      [id]
    );
    updatedRequest.donations = donations;

    const normalizedRequest = normalizeDatesInObject(updatedRequest);

    success(res, normalizedRequest, 200);
  } catch (err) {
    error(res, 'Error extending request', 500, err);
  }
});

/**
 * POST /api/requests/:requestId/participant-completion
 * Закрытие работы участником
 */
router.post('/:requestId/participant-completion', authenticate, uploadRequestPhotos, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.userId;

    // Получаем заявку
    const [requests] = await pool.execute(
      `SELECT id, category, status, created_by, joined_user_id, registered_participants, start_date, name,
              latitude, longitude, photos_before, join_date, work_duration_minutes, participant_completions
       FROM requests WHERE id = ?`,
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const request = requests[0];

    // Проверка типа заявки
    if (request.category !== 'event' && request.category !== 'wasteLocation') {
      return error(res, 'This request type does not support closing by participant', 400);
    }

    // Проверка статуса заявки
    if (request.status !== 'inProgress') {
      return error(res, 'Request must be in status inProgress', 400);
    }

    // Проверка, что пользователь является участником
    let isParticipant = false;
    if (request.category === 'event') {
      let registeredParticipants = parseJsonFieldSafe(request.registered_participants, []);
      isParticipant = registeredParticipants.includes(userId);
    } else if (request.category === 'wasteLocation') {
      isParticipant = request.joined_user_id === userId;
    }

    if (!isParticipant) {
      return error(res, 'You are not a participant of this request', 403);
    }

    // Для event: проверка, что событие началось
    if (request.category === 'event' && request.start_date) {
      const startDate = new Date(request.start_date);
      const now = new Date();
      if (startDate > now) {
        return error(res, 'Event has not started yet', 400);
      }
    }

    // Получаем данные из формы
    const uploadedPhotosAfter = req.files?.photos_after || [];
    const completionComment = req.body.completion_comment || null;
    const completionLatitude = parseFloat(req.body.completion_latitude);
    const completionLongitude = parseFloat(req.body.completion_longitude);

    // Валидация
    if (uploadedPhotosAfter.length === 0) {
      return error(res, 'At least one photo is required', 400);
    }

    if (isNaN(completionLatitude) || isNaN(completionLongitude)) {
      return error(res, 'Coordinates are required', 400);
    }

    // Сохраняем фото и получаем URL
    const photosAfterUrls = uploadedPhotosAfter.map(file => getFileUrlFromPath(file.path));
    const photoFilesAfterPaths = uploadedPhotosAfter.map((f) => f.path);

    let workDurationMinutesPayload = {};
    if (
      req.body.work_duration_minutes !== undefined &&
      req.body.work_duration_minutes !== null &&
      req.body.work_duration_minutes !== ''
    ) {
      try {
        workDurationMinutesPayload.work_duration_minutes = parseWorkDurationMinutesInput(
          req.body.work_duration_minutes
        );
      } catch (e) {
        if (e.code === 'INVALID_WORK_DURATION') {
          return error(res, 'work_duration_minutes: ожидается целое от 0 до 10080', 400);
        }
        throw e;
      }
    }

    const { checkRequestIntegrity, normalizeLocale } = require('../services/requestIntegrity');
    const { integrityEnforceOrRespond } = require('../utils/integrityGate');
    const workMinutesForCheck =
      workDurationMinutesPayload.work_duration_minutes ?? request.work_duration_minutes;

    const blocked = await integrityEnforceOrRespond(
      req,
      res,
      () =>
        checkRequestIntegrity({
          phase: 'close',
          category: request.category,
          latitude: request.latitude,
          longitude: request.longitude,
          photosBefore: parseJsonArraySafe(request.photos_before),
          photosAfter: photosAfterUrls,
          photoFilesAfter: photoFilesAfterPaths,
          completionLatitude,
          completionLongitude,
          workDurationMinutes: workMinutesForCheck,
          joinDate: request.join_date,
          submittedForReviewAt: new Date().toISOString(),
          locale: normalizeLocale(req.body?.locale || req.query?.locale),
        }),
      { requestId }
    );
    if (blocked) return;

    const { clearCompletionIntegrityRejected } = require('../services/completionIntegrityPersist');
    await clearCompletionIntegrityRejected(requestId);

    // Обновляем participant_completions
    const { updateParticipantCompletion } = require('../utils/participantCompletions');
    await updateParticipantCompletion(requestId, userId, {
      status: 'pending',
      photos_after: photosAfterUrls,
      completion_comment: completionComment,
      completion_latitude: completionLatitude,
      completion_longitude: completionLongitude,
      completed_at: new Date().toISOString(),
      ...workDurationMinutesPayload
    });

    // Для wasteLocation: сразу меняем статус заявки на pending и отправляем уведомление админам
    // Для event: только обновляем participant_completions, статус заявки остается inProgress
    if (request.category === 'wasteLocation') {
      // Меняем статус заявки на pending (отправка на модерацию)
      await pool.execute(
        'UPDATE requests SET status = ?, submitted_for_review_at = NOW(), donation_window_started_at = COALESCE(donation_window_started_at, NOW()), updated_at = NOW() WHERE id = ?',
        ['pending', requestId]
      );

      // Получаем информацию о заявке для уведомления админам
      const [requestInfo] = await pool.execute(
        'SELECT r.name, u.display_name as creator_name FROM requests r LEFT JOIN users u ON r.created_by = u.id WHERE r.id = ?',
        [requestId]
      );

      notifyModeratorsNewPendingRequest({
        requestId: requestId,
        requestName: requestInfo[0]?.name || 'Unnamed Request',
        requestCategory: 'wasteLocation',
        creatorName: requestInfo[0]?.creator_name || 'Unknown User',
      });

      const { runIntegrityOnPending } = require('../services/requestIntegrityOnPending');
      runIntegrityOnPending(requestId, { locale: req.body?.locale || req.query?.locale }).catch((e) => {
        console.error('[requests] runIntegrityOnPending:', requestId, e?.message || e);
      });
    } else {
      // Для event: отправляем push-уведомление создателю
      const { sendRequestSubmittedNotification } = require('../services/pushNotification');
      if (request.created_by) {
        sendRequestSubmittedNotification({
          requestId: requestId,
          requestName: request.name || 'Request',
          requestCategory: request.category,
          creatorId: request.created_by,
          participantId: userId
        }).catch(() => {});
      }
    }

    // Получаем обновленную заявку
    const [updatedRequests] = await pool.execute(
      'SELECT * FROM requests WHERE id = ?',
      [requestId]
    );

    const updatedRequest = updatedRequests[0];
    // Обработка JSON полей
    updatedRequest.participant_completions = parseJsonFieldSafe(updatedRequest.participant_completions, {});
const successMessage = request.category === 'wasteLocation' 
      ? 'Request closed and sent for moderation' 
      : 'Work closed, awaiting approval';
    success(res, { request: normalizeDatesInObject(updatedRequest) }, successMessage);
  } catch (err) {
    error(res, 'Error closing work', 500, err);
  }
});

/**
 * PATCH /api/requests/:requestId/participant-completion/:userId
 * Одобрение/отклонение закрытия работы создателем
 */
router.patch('/:requestId/participant-completion/:userId', authenticate, async (req, res) => {
  try {
    const { requestId, userId } = req.params;
    const currentUserId = req.user.userId;
    const { action, rejection_reason } = req.body;

    // Валидация action
    if (!action || (action !== 'approve' && action !== 'reject')) {
      return error(res, 'Must specify action: approve or reject', 400);
    }

    if (action === 'reject' && !rejection_reason) {
      return error(res, 'rejection_reason is required when rejecting', 400);
    }

    // Получаем заявку
    const [requests] = await pool.execute(
      'SELECT id, category, created_by, participant_completions FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const request = requests[0];

    // Для wasteLocation: одобрение/отклонение недоступно
    if (request.category === 'wasteLocation') {
      return error(res, 'Approve/reject not available for wasteLocation requests', 403);
    }

    // Проверка прав доступа (только создатель может одобрять/отклонять)
    if (request.created_by !== currentUserId && !req.user.isAdmin) {
      return error(res, 'Access denied. Only request creator can approve/reject work closure', 403);
    }

    // Получаем participant_completions
    const { getParticipantCompletions, updateParticipantCompletion } = require('../utils/participantCompletions');
    const completions = await getParticipantCompletions(requestId);

    if (!completions[userId]) {
      return error(res, 'Participant not found in participant_completions', 404);
    }

    // Проверка статуса (должен быть pending)
    if (completions[userId].status !== 'pending') {
      return error(res, 'Participant status must be pending', 400);
    }

    // Обновляем статус
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const updateData = {
      status: newStatus
    };

    if (action === 'reject') {
      updateData.rejection_reason = rejection_reason;
    }

    await updateParticipantCompletion(requestId, userId, updateData);

    // Отправляем push-уведомление участнику
    const { sendRequestRejectedNotification, sendRequestApprovedNotification } = require('../services/pushNotification');
    if (action === 'reject') {
      const { resolveRejectionNotificationText } = require('../utils/rejectionNotificationText');
      const resolved = resolveRejectionNotificationText({
        rejectionMessage: rejection_reason,
        messageType: 'participant',
      });
      sendRequestRejectedNotification({
        userIds: [userId],
        requestId: requestId,
        messageType: 'participant',
        rejectionMessage: resolved.body,
        requestCategory: request.category,
        primaryCode: resolved.primaryCode,
        messageKey: resolved.messageKey,
      }).catch(() => {});
    } else {
      sendRequestApprovedNotification({
        userIds: [userId],
        requestId: requestId,
        requestCategory: request.category
      }).catch(() => {});
    }

    // Получаем обновленную заявку
    const [updatedRequests] = await pool.execute(
      'SELECT * FROM requests WHERE id = ?',
      [requestId]
    );

    const updatedRequest = updatedRequests[0];
    // Обработка JSON полей
    updatedRequest.participant_completions = parseJsonFieldSafe(updatedRequest.participant_completions, {});
success(res, { request: normalizeDatesInObject(updatedRequest) }, action === 'approve' ? 'Work closure approved' : 'Work closure rejected');
  } catch (err) {
    error(res, 'Error approving/rejecting work closure', 500, err);
  }
});

/**
 * POST /api/requests/:requestId/close-by-creator
 * Закрытие заявки создателем
 */
router.post('/:requestId/close-by-creator', authenticate, uploadRequestPhotos, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.userId;
    const { completion_comment } = req.body;

    // Получаем заявку
    const [requests] = await pool.execute(
      `SELECT id, category, status, created_by, latitude, longitude, registered_participants,
              participant_completions, photos_before
       FROM requests WHERE id = ?`,
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const request = requests[0];

    // Для wasteLocation: создатель не может закрывать заявку
    if (request.category === 'wasteLocation') {
      return error(res, 'Creator cannot close wasteLocation requests', 403);
    }

    // Проверка типа заявки
    if (request.category !== 'event') {
      return error(res, 'This request type does not support closing by creator', 400);
    }

    // Проверка прав доступа (только создатель может закрыть для event)
    // СТРОГАЯ ПРОВЕРКА: только создатель, админ не может закрывать заявку для этих типов
    if (request.created_by !== userId) {
      return error(res, 'Only the request creator can close the request', 403);
    }

    // Проверка статуса
    if (request.status !== 'inProgress') {
      return error(res, 'Request must be in status inProgress', 400);
    }

    let participantCompletions = parseJsonFieldSafe(request.participant_completions, {});
    const uploadedCreatorPhotos = (req.files?.photos_after || []).map((f) => getFileUrlFromPath(f.path));
    const creatorLat = parseFloat(req.body.completion_latitude);
    const creatorLng = parseFloat(req.body.completion_longitude);
    const completionsForCheck = { ...participantCompletions };
    if (uploadedCreatorPhotos.length > 0 || (!Number.isNaN(creatorLat) && !Number.isNaN(creatorLng))) {
      const prev = completionsForCheck[userId] || {};
      completionsForCheck[userId] = {
        ...prev,
        ...(uploadedCreatorPhotos.length > 0 ? { photos_after: uploadedCreatorPhotos } : {}),
        ...(!Number.isNaN(creatorLat) && !Number.isNaN(creatorLng)
          ? { completion_latitude: creatorLat, completion_longitude: creatorLng }
          : {}),
      };
    }

    const { checkRequestIntegrity, normalizeLocale } = require('../services/requestIntegrity');
    const { integrityEnforceOrRespond } = require('../utils/integrityGate');
    const blocked = await integrityEnforceOrRespond(
      req,
      res,
      () =>
        checkRequestIntegrity({
          phase: 'close',
          eventCloseAllParticipants: true,
          request,
          participantCompletions: completionsForCheck,
          locale: normalizeLocale(req.body?.locale || req.query?.locale),
        }),
      { requestId }
    );
    if (blocked) return;

    if (completionsForCheck[userId]) {
      const { updateParticipantCompletion } = require('../utils/participantCompletions');
      await updateParticipantCompletion(requestId, userId, completionsForCheck[userId]);
    }

    const { clearCompletionIntegrityRejected } = require('../services/completionIntegrityPersist');
    await clearCompletionIntegrityRejected(requestId);

    // Обновляем статус заявки на pending
    const updates = [
      'status = ?',
      'submitted_for_review_at = NOW()',
      'donation_window_started_at = COALESCE(donation_window_started_at, NOW())',
      'updated_at = NOW()'
    ];
    const params = ['pending'];

    if (completion_comment) {
      updates.push('completion_comment = ?');
      params.push(completion_comment);
    }

    await pool.execute(
      `UPDATE requests SET ${updates.join(', ')} WHERE id = ?`,
      [...params, requestId]
    );

    // Коины НЕ начисляются при закрытии создателем
    // Коины начисляются только при одобрении модератором (в handleWasteApproval/handleEventApproval)

    // Получаем обновленную заявку
    const [updatedRequests] = await pool.execute(
      'SELECT * FROM requests WHERE id = ?',
      [requestId]
    );

    const updatedRequest = updatedRequests[0];
    // Обработка JSON полей
    updatedRequest.participant_completions = parseJsonFieldSafe(updatedRequest.participant_completions, {});

    const [requestInfo] = await pool.execute(
      'SELECT r.name, u.display_name as creator_name FROM requests r LEFT JOIN users u ON r.created_by = u.id WHERE r.id = ?',
      [requestId]
    );
    notifyModeratorsNewPendingRequest({
      requestId,
      requestName: requestInfo[0]?.name || 'Unnamed Request',
      requestCategory: 'event',
      creatorName: requestInfo[0]?.creator_name || 'Unknown User',
    });

    const { runIntegrityOnPending } = require('../services/requestIntegrityOnPending');
    runIntegrityOnPending(requestId, { locale: req.body?.locale || req.query?.locale }).catch((e) => {
      console.error('[requests] runIntegrityOnPending:', requestId, e?.message || e);
    });

    success(res, { request: normalizeDatesInObject(updatedRequest) }, 'Request closed and sent for review');
  } catch (err) {
    error(res, 'Error closing request', 500, err);
  }
});

/**
 * POST /api/requests/create-with-payment
 * УДАЛЕН: Теперь все платежи идут через донаты
 * Создатель может сделать донат своей заявке через POST /api/donations после создания заявки
 * @deprecated Этот endpoint удален. Используйте POST /api/requests для создания заявки,
 *            затем POST /api/donations для создания доната от создателя.
 */
router.post('/create-with-payment', authenticate, async (req, res) => {
  return error(res, 'This endpoint is removed. All payments go through donations. Use POST /api/requests to create a request, then POST /api/donations to create a donation from creator.', 410, {
    deprecated: true,
    newApproach: {
      step1: 'POST /api/requests - create request',
      step2: 'POST /api/donations - create donation from creator (can be right after creating request)'
    }
  });
});

module.exports = router;
module.exports.buildRequestDetailForApi = buildRequestDetailForApi;
module.exports.handleRequestRejection = handleRequestRejection;
module.exports.handleWasteApproval = handleWasteApproval;
module.exports.handleEventApproval = handleEventApproval;
module.exports.handleSpeedCleanupApproval = handleSpeedCleanupApproval;
module.exports.payoutSpeedCleanupNewDonationsBeforeArchive = payoutSpeedCleanupNewDonationsBeforeArchive;
module.exports.refundDonationsForRequest = refundDonationsForRequest;
module.exports.archivePendingModerationTimeout = archivePendingModerationTimeout;
