const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { uploadRequestPhotos, getFileUrlFromPath } = require('../middleware/upload');
const { normalizeDatesInObject } = require('../utils/datetime');
const { 
  sendRequestCreatedNotification, 
  sendJoinNotification, 
  sendSpeedCleanupNotification,
  sendRequestSubmittedNotification,
  sendRequestApprovedNotification,
  sendRequestRejectedNotification,
  sendModerationNotification
} = require('../services/pushNotification');
const { createGroupChatForRequest, deleteChatsForRequest, addParticipantToGroupChat } = require('../utils/chats');

const router = express.Router();

/**
 * GET /api/requests
 * Получение списка заявок с фильтрацией
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
      takenBy
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
      params.push(status);
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

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Используем прямой ввод чисел для LIMIT и OFFSET (безопасно, так как значения валидированы)
    query += ` ORDER BY r.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

    const [requests] = await pool.execute(query, params);

    // Обработка результатов
    const processedRequests = requests.map(request => {
      const result = Object.assign({}, request);
      
      // Обработка photos_before из JSON поля
      if (request.photos_before) {
        try {
          result.photos_before = typeof request.photos_before === 'string' 
            ? JSON.parse(request.photos_before) 
            : request.photos_before;
        } catch (e) {
          result.photos_before = [];
        }
      } else {
        result.photos_before = [];
      }
      
      // Обработка photos_after из JSON поля
      if (request.photos_after) {
        try {
          result.photos_after = typeof request.photos_after === 'string' 
            ? JSON.parse(request.photos_after) 
            : request.photos_after;
        } catch (e) {
          result.photos_after = [];
        }
      } else {
        result.photos_after = [];
      }
      // Обработка waste_types из JSON поля
      if (request.waste_types) {
        try {
          result.waste_types = typeof request.waste_types === 'string' 
            ? JSON.parse(request.waste_types) 
            : request.waste_types;
        } catch (e) {
          result.waste_types = [];
        }
      } else {
        result.waste_types = [];
      }
      // Обработка actual_participants из JSON поля
      if (request.actual_participants) {
        try {
          result.actual_participants = typeof request.actual_participants === 'string' 
            ? JSON.parse(request.actual_participants) 
            : request.actual_participants;
        } catch (e) {
          result.actual_participants = [];
        }
      } else {
        result.actual_participants = [];
      }
      
      // Обработка registered_participants из JSON поля (для event)
      if (request.registered_participants) {
        try {
          result.registered_participants = typeof request.registered_participants === 'string' 
            ? JSON.parse(request.registered_participants) 
            : request.registered_participants;
        } catch (e) {
          result.registered_participants = [];
        }
      } else {
        result.registered_participants = [];
      }
      
      // Преобразование булевых значений
      result.only_foot = Boolean(result.only_foot);
      result.possible_by_car = Boolean(result.possible_by_car);
      result.is_open = Boolean(result.is_open);
      result.plant_tree = Boolean(result.plant_tree);
      result.trash_pickup_only = Boolean(result.trash_pickup_only);
      
      // Нормализация дат в UTC
      return normalizeDatesInObject(result);
    });

    // Получение общего количества
    let countQuery = 'SELECT COUNT(DISTINCT r.id) as total FROM requests r';
    const countParams = [];
    const countConditions = [];
    
    // Строим условия для COUNT запроса, исключая условие радиуса
    if (conditions.length > 0) {
      let paramIndex = 0;
      for (let i = 0; i < conditions.length; i++) {
        const condition = conditions[i];
        // Пропускаем условие радиуса (оно содержит '6371000')
        if (!condition.includes('6371000')) {
          countConditions.push(condition);
          // Добавляем соответствующий параметр
          countParams.push(params[paramIndex]);
          paramIndex++;
        } else {
          // Условие радиуса использует 4 параметра (latitude, longitude, latitude, radius)
          // Пропускаем их все
          paramIndex += 4;
        }
      }
      
      if (countConditions.length > 0) {
        countQuery += ' WHERE ' + countConditions.join(' AND ');
      }
    }
    
    const [countResult] = await pool.execute(countQuery, countParams);
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
    console.error('Ошибка получения заявок:', err);
    error(res, 'Ошибка при получении списка заявок', 500, err);
  }
});

/**
 * GET /api/requests/:id
 * Получение заявки по ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [requests] = await pool.execute(
      `SELECT r.*
      FROM requests r
      WHERE r.id = ?`,
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
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

    // Обработка данных
    // photos_before и photos_after теперь JSON массивы, а не строки
    if (request.photos_before) {
      try {
        request.photos_before = typeof request.photos_before === 'string' 
          ? JSON.parse(request.photos_before) 
          : request.photos_before;
      } catch (e) {
        request.photos_before = [];
      }
    } else {
      request.photos_before = [];
    }
    
    if (request.photos_after) {
      try {
        request.photos_after = typeof request.photos_after === 'string' 
          ? JSON.parse(request.photos_after) 
          : request.photos_after;
      } catch (e) {
        request.photos_after = [];
      }
    } else {
      request.photos_after = [];
    }
    
    // Обработка waste_types из JSON поля
    if (request.waste_types) {
      try {
        request.waste_types = typeof request.waste_types === 'string' 
          ? JSON.parse(request.waste_types) 
          : request.waste_types;
      } catch (e) {
        request.waste_types = [];
      }
    } else {
      request.waste_types = [];
    }
    // Обработка actual_participants из JSON поля
    if (request.actual_participants) {
      try {
        request.actual_participants = typeof request.actual_participants === 'string' 
          ? JSON.parse(request.actual_participants) 
          : request.actual_participants;
      } catch (e) {
        request.actual_participants = [];
      }
    } else {
      request.actual_participants = [];
    }
    
    // Обработка registered_participants из JSON поля (для event)
    if (request.registered_participants) {
      try {
        request.registered_participants = typeof request.registered_participants === 'string' 
          ? JSON.parse(request.registered_participants) 
          : request.registered_participants;
      } catch (e) {
        request.registered_participants = [];
      }
    } else {
      request.registered_participants = [];
    }
    
    request.only_foot = Boolean(request.only_foot);
    request.possible_by_car = Boolean(request.possible_by_car);
    request.is_open = Boolean(request.is_open);
    request.plant_tree = Boolean(request.plant_tree);
    request.trash_pickup_only = Boolean(request.trash_pickup_only);

    // Нормализация дат в UTC
    const normalizedRequest = normalizeDatesInObject(request);
    
    // Нормализация дат в донатах
    if (normalizedRequest.donations && Array.isArray(normalizedRequest.donations)) {
      normalizedRequest.donations = normalizedRequest.donations.map(donation => 
        normalizeDatesInObject(donation)
      );
    }

    success(res, { request: normalizedRequest });
  } catch (err) {
    error(res, 'Ошибка при получении заявки', 500, err);
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
  body('category').isIn(['wasteLocation', 'speedCleanup', 'event']).withMessage('Некорректная категория'),
  body('name').notEmpty().withMessage('Название обязательно'),
  body('description').optional().isString(),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('city').optional().isString()
], async (req, res, next) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
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

    // Логируем входящие данные для отладки
    console.log('📥 Данные запроса на создание заявки:', {
      category: bodyData.category,
      name: bodyData.name,
      hasFiles: !!req.files,
      filesCount: req.files ? Object.keys(req.files).length : 0,
      bodyKeys: Object.keys(bodyData)
    });

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
      cost,
      reward_amount,
      start_date,
      end_date,
      status, // Статус может быть передан явно (для speedCleanup при переходе на страницу выполнения)
      priority = 'medium',
      waste_types = [],
      target_amount,
      plant_tree = false,
      trash_pickup_only = false
    } = bodyData;

    // Обработка waste_types - может быть массивом или строкой
    let processedWasteTypes = [];
    if (waste_types) {
      if (Array.isArray(waste_types)) {
        processedWasteTypes = waste_types;
      } else if (typeof waste_types === 'string') {
        try {
          processedWasteTypes = JSON.parse(waste_types);
        } catch (e) {
          // Если не JSON, разбиваем по запятой
          processedWasteTypes = waste_types.split(',').map(t => t.trim()).filter(t => t);
        }
      }
    }

    // Используем только загруженные файлы (URL не принимаем)
    const finalPhotosBefore = uploadedPhotosBefore;
    const finalPhotosAfter = uploadedPhotosAfter;

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

    // TODO: После проверки вернуть на 7 дней (сейчас 1 день для тестирования)
    // Для waste заявок устанавливаем expires_at = created_at + 1 день (для проверки, потом вернуть на 7 дней)
    const expiresAt = category === 'wasteLocation' 
      ? new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    // Создание заявки с фото в JSON полях
    await pool.execute(
      `INSERT INTO requests (
        id, user_id, category, name, description, latitude, longitude, city,
        garbage_size, only_foot, possible_by_car, cost, reward_amount,
        start_date, end_date, status, priority, created_by, target_amount,
        plant_tree, trash_pickup_only, photos_before, photos_after, waste_types, registered_participants, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
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
        only_foot,
        possible_by_car,
        cost || null,
        reward_amount || null,
        start_date || null,
        end_date || null,
        defaultStatus,
        priority,
        userId, // created_by использует тот же userId
        target_amount || null,
        plant_tree,
        trash_pickup_only,
        finalPhotosBefore.length > 0 ? JSON.stringify(finalPhotosBefore) : null,
        finalPhotosAfter.length > 0 ? JSON.stringify(finalPhotosAfter) : null,
        processedWasteTypes.length > 0 ? JSON.stringify(processedWasteTypes) : null,
        registeredParticipants,
        expiresAt
      ]
    );

    // Создаем групповой чат для заявки
    try {
      await createGroupChatForRequest(requestId, userId);
    } catch (chatError) {
      console.error('Ошибка при создании группового чата:', chatError);
      // Не прерываем создание заявки, если не удалось создать чат
    }

    // Получение созданной заявки
    const [requests] = await pool.execute(
      `SELECT r.*
      FROM requests r
      WHERE r.id = ?`,
      [requestId]
    );

    const request = requests[0];
    
    // Обработка photos_before из JSON поля
    if (request.photos_before) {
      try {
        request.photos_before = typeof request.photos_before === 'string' 
          ? JSON.parse(request.photos_before) 
          : request.photos_before;
      } catch (e) {
        request.photos_before = [];
      }
    } else {
      request.photos_before = [];
    }
    
    // Обработка photos_after из JSON поля
    if (request.photos_after) {
      try {
        request.photos_after = typeof request.photos_after === 'string' 
          ? JSON.parse(request.photos_after) 
          : request.photos_after;
      } catch (e) {
        request.photos_after = [];
      }
    } else {
      request.photos_after = [];
    }
    
    // Обработка waste_types из JSON поля
    if (request.waste_types) {
      try {
        request.waste_types = typeof request.waste_types === 'string' 
          ? JSON.parse(request.waste_types) 
          : request.waste_types;
      } catch (e) {
        request.waste_types = [];
      }
    } else {
      request.waste_types = [];
    }
    // Обработка actual_participants из JSON поля
    if (request.actual_participants) {
      try {
        request.actual_participants = typeof request.actual_participants === 'string' 
          ? JSON.parse(request.actual_participants) 
          : request.actual_participants;
      } catch (e) {
        request.actual_participants = [];
      }
    } else {
      request.actual_participants = [];
    }
    request.participants = [];
    request.contributors = [];
    request.contributions = {};
    request.donations = [];

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
        console.error('❌ Ошибка отправки push-уведомлений при создании заявки:', err);
        // Не прерываем выполнение, просто логируем ошибку
      });
    }

    success(res, { request: normalizedRequest }, 'Заявка создана', 201);
  } catch (err) {
    console.error('❌ Ошибка создания заявки:', err);
    console.error('❌ Stack trace:', err.stack);
    // Возвращаем детальную ошибку клиенту
    error(res, 'Ошибка при создании заявки', 500, err);
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
      'SELECT created_by FROM requests WHERE id = ?',
      [id]
    );

    if (existingRequests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    // Только создатель или админ может обновлять
    if (existingRequests[0].created_by !== userId && !req.user.isAdmin) {
      return error(res, 'Доступ запрещен', 403);
    }

    // Парсим данные из multipart/form-data
    // В form-data все значения приходят как строки, нужно их правильно обработать
    let bodyData = req.body;
    
    // Обработка waste_types - может быть массивом в form-data (waste_types[])
    let wasteTypesArray = [];
    if (bodyData['waste_types[]']) {
      // Если пришел массив из form-data
      if (Array.isArray(bodyData['waste_types[]'])) {
        wasteTypesArray = bodyData['waste_types[]'];
      } else {
        wasteTypesArray = [bodyData['waste_types[]']];
      }
    } else if (bodyData.waste_types) {
      // Если пришел как обычное поле
      if (Array.isArray(bodyData.waste_types)) {
        wasteTypesArray = bodyData.waste_types;
      } else if (typeof bodyData.waste_types === 'string') {
        try {
          wasteTypesArray = JSON.parse(bodyData.waste_types);
        } catch (e) {
          wasteTypesArray = bodyData.waste_types.split(',').map(t => t.trim()).filter(t => t);
        }
      }
    }

    // Преобразуем строковые значения в нужные типы
    const parseValue = (value, type) => {
      if (value === undefined || value === null || value === '') return undefined;
      if (type === 'boolean') {
        if (typeof value === 'string') {
          return value === 'true' || value === '1';
        }
        return Boolean(value);
      }
      if (type === 'number') {
        const num = parseFloat(value);
        return isNaN(num) ? undefined : num;
      }
      return value;
    };

    const {
      name,
      description,
      latitude,
      longitude,
      city,
      garbage_size,
      only_foot,
      possible_by_car,
      cost,
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
      params.push(parseValue(latitude, 'number'));
    }
    if (longitude !== undefined && longitude !== null && longitude !== '') {
      updates.push('longitude = ?');
      params.push(parseValue(longitude, 'number'));
    }
    if (city !== undefined && city !== null && city !== '') {
      updates.push('city = ?');
      params.push(city);
    }
    if (garbage_size !== undefined && garbage_size !== null && garbage_size !== '') {
      updates.push('garbage_size = ?');
      params.push(parseValue(garbage_size, 'number'));
    }
    if (only_foot !== undefined && only_foot !== null && only_foot !== '') {
      updates.push('only_foot = ?');
      params.push(parseValue(only_foot, 'boolean'));
    }
    if (possible_by_car !== undefined && possible_by_car !== null && possible_by_car !== '') {
      updates.push('possible_by_car = ?');
      params.push(parseValue(possible_by_car, 'boolean'));
    }
    if (cost !== undefined && cost !== null && cost !== '') {
      updates.push('cost = ?');
      params.push(parseValue(cost, 'number'));
    }
    if (reward_amount !== undefined && reward_amount !== null && reward_amount !== '') {
      updates.push('reward_amount = ?');
      params.push(parseValue(reward_amount, 'number'));
    }
    if (start_date !== undefined) {
      updates.push('start_date = ?');
      params.push(start_date);
    }
    if (end_date !== undefined) {
      updates.push('end_date = ?');
      params.push(end_date);
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

        // Проверяем изменение статуса на pending (отправка на рассмотрение)
        if (status === 'pending' && oldStatus !== 'pending') {
          statusChangedToPending = true;
        }

        // Проверяем изменение статуса на approved (одобрение)
        if (status === 'approved' && oldStatus !== 'approved') {
          statusChangedToApproved = true;
          
          // Для speedCleanup проверяем разницу между start_date и end_date
          if (requestCategory === 'speedCleanup') {
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
        if (status === 'rejected' && oldStatus !== 'rejected') {
          statusChangedToRejected = true;
        }
      }

      updates.push('status = ?');
      params.push(status);
    }
    if (priority !== undefined && priority !== null && priority !== '') {
      updates.push('priority = ?');
      params.push(priority);
    }
    if (is_open !== undefined) {
      updates.push('is_open = ?');
      params.push(is_open);
    }
    if (target_amount !== undefined && target_amount !== null && target_amount !== '') {
      updates.push('target_amount = ?');
      params.push(parseValue(target_amount, 'number'));
    }
    if (plant_tree !== undefined && plant_tree !== null && plant_tree !== '') {
      updates.push('plant_tree = ?');
      params.push(parseValue(plant_tree, 'boolean'));
    }
    if (trash_pickup_only !== undefined && trash_pickup_only !== null && trash_pickup_only !== '') {
      updates.push('trash_pickup_only = ?');
      params.push(parseValue(trash_pickup_only, 'boolean'));
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
          return error(res, `actual_participants содержит невалидный ID: ${participantId}. Все ID должны быть UUID из базы данных (поле id из таблицы users).`, 400);
        }
      }
    }
    
    // Обработка отсоединения от заявки (joined_user_id и join_date = null)
    // Пустые строки приравниваются к null
    if (joined_user_id !== undefined) {
      // Приравниваем пустую строку к null
      const normalizedJoinedUserId = (joined_user_id === '' || joined_user_id === null) ? null : joined_user_id;
      
      // Валидация: joined_user_id должен быть UUID из БД (поле id) или null
      // НЕ принимаем Firebase UID - только UUID из базы данных
      if (normalizedJoinedUserId !== null && !normalizedJoinedUserId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        return error(res, 'joined_user_id должен быть UUID из базы данных (поле id из таблицы users). Firebase UID не поддерживается. Используйте id пользователя из БД.', 400);
      }
      
      // Проверка существования пользователя в БД (если не null)
      if (normalizedJoinedUserId) {
        const [users] = await pool.execute(
          'SELECT id FROM users WHERE id = ?',
          [normalizedJoinedUserId]
        );
        
        if (users.length === 0) {
          return error(res, 'Пользователь с указанным ID не найден в базе данных', 404);
        }
      }
      
      updates.push('joined_user_id = ?');
      params.push(normalizedJoinedUserId);
    }
    if (join_date !== undefined) {
      // Приравниваем пустую строку к null
      const normalizedJoinDate = (join_date === '' || join_date === null) ? null : join_date;
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

    if (updates.length === 0) {
      return error(res, 'Нет данных для обновления', 400);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await pool.execute(
      `UPDATE requests SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

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
          }).catch(err => {
            console.error('❌ Ошибка отправки push-уведомления при отправке на рассмотрение:', err);
          });

          // Отправляем пуш-уведомление всем модераторам
          sendModerationNotification({
            requestId: id,
            requestName: requestInfo.name || 'Unnamed Request',
            requestCategory: requestInfo.category || requestCategory,
            creatorName: requestInfo.creator_name || 'Unknown User',
          }).catch(err => {
            console.error('❌ Ошибка отправки push-уведомления модераторам:', err);
          });
        }
      } catch (error) {
        console.error('❌ Ошибка обработки отправки на рассмотрение:', error);
      }
    }

    // 2. Обработка одобрения заявки (approved)
    if (statusChangedToApproved) {
      try {
        if (requestCategory === 'wasteLocation') {
          // Для waste: начислить коины, перевести деньги исполнителю, отправить пуши, статус -> completed
          await handleWasteApproval(id, requestCreatedBy, requestJoinedUserId);
        } else if (requestCategory === 'event') {
          // Для event: начислить коины (только реальным участникам), перевести деньги заказчику, отправить пуши, статус -> completed
          await handleEventApproval(id, requestCreatedBy);
        } else if (requestCategory === 'speedCleanup') {
          // Для speedCleanup: начислить коин создателю (если >= 20 минут), отправить пуш, статус остается approved
          await handleSpeedCleanupApproval(id, requestCreatedBy, speedCleanupEarnedCoin);
        }
      } catch (error) {
        console.error('❌ Ошибка обработки одобрения заявки:', error);
      }
    }

    // 3. Обработка отклонения заявки (rejected)
    if (statusChangedToRejected) {
      try {
        await handleRequestRejection(id, requestCategory, requestCreatedBy, rejection_reason, rejection_message);
      } catch (error) {
        console.error('❌ Ошибка обработки отклонения заявки:', error);
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
    
    // Обработка photos_before из JSON поля
    if (request.photos_before) {
      try {
        request.photos_before = typeof request.photos_before === 'string' 
          ? JSON.parse(request.photos_before) 
          : request.photos_before;
      } catch (e) {
        request.photos_before = [];
      }
    } else {
      request.photos_before = [];
    }
    
    // Обработка photos_after из JSON поля
    if (request.photos_after) {
      try {
        request.photos_after = typeof request.photos_after === 'string' 
          ? JSON.parse(request.photos_after) 
          : request.photos_after;
      } catch (e) {
        request.photos_after = [];
      }
    } else {
      request.photos_after = [];
    }
    // Обработка waste_types из JSON поля
    if (request.waste_types) {
      try {
        request.waste_types = typeof request.waste_types === 'string' 
          ? JSON.parse(request.waste_types) 
          : request.waste_types;
      } catch (e) {
        request.waste_types = [];
      }
    } else {
      request.waste_types = [];
    }
    // Обработка actual_participants из JSON поля
    if (request.actual_participants) {
      try {
        request.actual_participants = typeof request.actual_participants === 'string' 
          ? JSON.parse(request.actual_participants) 
          : request.actual_participants;
      } catch (e) {
        request.actual_participants = [];
      }
    } else {
      request.actual_participants = [];
    }

    // Нормализация дат в UTC
    const normalizedRequest = normalizeDatesInObject(request);

    success(res, { request: normalizedRequest }, 'Заявка обновлена');
  } catch (err) {
    console.error('Ошибка обновления заявки:', err);
    error(res, 'Ошибка при обновлении заявки', 500, err);
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
      return error(res, 'Заявка не найдена', 404);
    }

    // Только создатель или админ может удалять
    if (existingRequests[0].created_by !== userId && !req.user.isAdmin) {
      return error(res, 'Доступ запрещен', 403);
    }

    // Удаляем все связанные чаты перед удалением заявки
    try {
      await deleteChatsForRequest(id);
    } catch (chatError) {
      console.error('Ошибка при удалении чатов для заявки:', chatError);
      // Продолжаем удаление заявки даже если не удалось удалить чаты
    }

    await pool.execute('DELETE FROM requests WHERE id = ?', [id]);

    success(res, null, 'Заявка удалена');
  } catch (err) {
    console.error('Ошибка удаления заявки:', err);
    error(res, 'Ошибка при удалении заявки', 500, err);
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
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    // Проверка типа заявки
    if (request.category !== 'wasteLocation') {
      return error(res, 'К этому типу заявки нельзя присоединиться', 400);
    }

    // Проверка статуса заявки (можно присоединиться только к заявкам со статусом 'new')
    const [currentRequest] = await pool.execute(
      'SELECT status FROM requests WHERE id = ?',
      [id]
    );
    if (currentRequest.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }
    if (currentRequest[0].status !== 'new') {
      return error(res, 'К этой заявке нельзя присоединиться', 400);
    }

    // Проверка, не присоединился ли уже кто-то
    if (request.joined_user_id && request.joined_user_id !== userId) {
      // Проверка истечения срока (1 день)
      const joinDate = new Date(request.join_date);
      const now = new Date();
      const oneDayLater = new Date(joinDate.getTime() + 24 * 60 * 60 * 1000);

      if (now < oneDayLater) {
        return error(res, 'К заявке уже присоединился другой пользователь', 409);
      }
    }

    // Присоединение: меняем статус на 'inProgress' и сохраняем joined_user_id
    await pool.execute(
      'UPDATE requests SET joined_user_id = ?, join_date = NOW(), status = ?, updated_at = NOW() WHERE id = ?',
      [userId, 'inProgress', id]
    );

    // Добавляем участника в групповой чат заявки
    try {
      await addParticipantToGroupChat(id, userId);
    } catch (chatError) {
      console.error('Ошибка при добавлении участника в групповой чат:', chatError);
      // Не прерываем присоединение, если не удалось добавить в чат
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
        console.error('❌ Ошибка отправки push-уведомления при присоединении:', err);
      });
    }

    success(res, null, 'Вы присоединились к заявке');
  } catch (err) {
    console.error('Ошибка присоединения к заявке:', err);
    error(res, 'Ошибка при присоединении к заявке', 500, err);
  }
});

/**
 * PUT /api/requests/:id/close-event
 * Закрытие события (для event)
 * Принимает photos_after и actual_participants, меняет статус на pending
 */
router.put('/:id/close-event', authenticate, uploadRequestPhotos, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Проверка существования заявки
    const [requests] = await pool.execute(
      'SELECT id, category, status, created_by, start_date FROM requests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    // Проверка типа заявки
    if (request.category !== 'event') {
      return error(res, 'Это не событие', 400);
    }

    // Проверка прав доступа (только создатель может закрыть)
    if (request.created_by !== userId && !req.user.isAdmin) {
      return error(res, 'Доступ запрещен', 403);
    }

    // Проверка статуса
    if (request.status !== 'inProgress') {
      return error(res, 'Событие уже закрыто или не началось', 400);
    }

    // Проверка времени (событие должно начаться)
    if (request.start_date) {
      const startDate = new Date(request.start_date);
      const now = new Date();
      if (now < startDate) {
        return error(res, 'Событие еще не началось', 400);
      }
    }

    const { actual_participants } = req.body;

    // Обработка загруженных файлов photos_after (только файлы, URL не принимаем)
    const uploadedPhotosAfter = [];
    if (req.files && req.files.photos_after && Array.isArray(req.files.photos_after)) {
      for (const file of req.files.photos_after) {
        const fileUrl = getFileUrlFromPath(file.path);
        if (fileUrl) uploadedPhotosAfter.push(fileUrl);
      }
    }

    // Сохраняем actual_participants и photos_after в JSON поля
    const updates = [];
    const params = [];
    
    if (actual_participants !== undefined) {
      // Валидация: все ID в actual_participants должны быть UUID из БД
      if (Array.isArray(actual_participants)) {
        for (const participantId of actual_participants) {
          if (participantId && !participantId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            return error(res, `actual_participants содержит невалидный ID: ${participantId}. Все ID должны быть UUID из базы данных (поле id из таблицы users).`, 400);
          }
        }
      }
      updates.push('actual_participants = ?');
      params.push(Array.isArray(actual_participants) ? JSON.stringify(actual_participants) : null);
    }
    
    // Сохраняем photos_after в JSON поле (только если загружены файлы)
    if (uploadedPhotosAfter.length > 0) {
      updates.push('photos_after = ?');
      params.push(JSON.stringify(uploadedPhotosAfter));
    }

    // Меняем статус на pending
    updates.push('status = ?');
    params.push('pending');
    updates.push('updated_at = NOW()');
    params.push(id);

    await pool.execute(
      `UPDATE requests SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    success(res, null, 'Событие отправлено на рассмотрение');
  } catch (err) {
    console.error('Ошибка закрытия события:', err);
    error(res, 'Ошибка при закрытии события', 500, err);
  }
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
      'SELECT id, category, name, created_by FROM requests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    if (request.category !== 'event') {
      return error(res, 'Это не событие', 400);
    }

    // Проверка, не является ли пользователь создателем
    if (request.created_by === userId) {
      return error(res, 'Вы уже являетесь создателем события', 409);
    }

    // Получаем текущий список зарегистрированных участников
    let registeredParticipants = [];
    if (request.registered_participants) {
      try {
        registeredParticipants = typeof request.registered_participants === 'string'
          ? JSON.parse(request.registered_participants)
          : request.registered_participants;
      } catch (e) {
        registeredParticipants = [];
      }
    }

    // Проверка, не участвует ли уже
    if (registeredParticipants.includes(userId)) {
      return error(res, 'Вы уже участвуете в этом событии', 409);
    }

    // Добавляем пользователя в список участников
    registeredParticipants.push(userId);
    await pool.execute(
      'UPDATE requests SET registered_participants = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(registeredParticipants), id]
    );

    // Отправка push-уведомления создателю заявки (асинхронно)
    if (request.created_by) {
      sendJoinNotification({
        requestId: id,
        requestName: request.name || 'Event',
        requestCategory: request.category,
        creatorId: request.created_by,
        actionUserId: userId,
        actionType: 'participated',
      }).catch(err => {
        console.error('❌ Ошибка отправки push-уведомления при участии:', err);
      });
    }

    success(res, null, 'Вы присоединились к событию');
  } catch (err) {
    console.error('Ошибка участия в событии:', err);
    error(res, 'Ошибка при участии в событии', 500, err);
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
      'SELECT id, category, registered_participants FROM requests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    if (request.category !== 'event') {
      return error(res, 'Это не событие', 400);
    }

    // Получаем текущий список участников
    let registeredParticipants = [];
    if (request.registered_participants) {
      try {
        registeredParticipants = typeof request.registered_participants === 'string'
          ? JSON.parse(request.registered_participants)
          : request.registered_participants;
      } catch (e) {
        registeredParticipants = [];
      }
    }

    // Удаляем пользователя из списка участников
    registeredParticipants = registeredParticipants.filter(p => p !== userId);
    await pool.execute(
      'UPDATE requests SET registered_participants = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(registeredParticipants), id]
    );

    success(res, null, 'Участие отменено');
  } catch (err) {
    console.error('Ошибка отмены участия:', err);
    error(res, 'Ошибка при отмене участия', 500, err);
  }
});

/**
 * Обработка одобрения заявки типа wasteLocation
 */
async function handleWasteApproval(requestId, creatorId, executorId) {
  const coinsToAward = 1;
  const awardedUserIds = new Set();

  // 1. Начисляем коины создателю
  if (creatorId) {
    await pool.execute(
      'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_created = COALESCE(coins_from_created, 0) + ?, updated_at = NOW() WHERE id = ?',
      [coinsToAward, coinsToAward, creatorId]
    );
    awardedUserIds.add(creatorId);
    console.log(`✅ Начислено ${coinsToAward} коин создателю заявки ${requestId}`);
  }

  // 2. Начисляем коины исполнителю
  if (executorId && !awardedUserIds.has(executorId)) {
    await pool.execute(
      'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
      [coinsToAward, coinsToAward, executorId]
    );
    awardedUserIds.add(executorId);
    console.log(`✅ Начислено ${coinsToAward} коин исполнителю заявки ${requestId}`);
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
      console.log(`✅ Начислено ${coinsToAward} коин донатеру ${donation.user_id} за заявку ${requestId}`);
    }
  }

  // 4. Переводим деньги исполнителю (cost + donations - комиссия)
  // TODO: Реализовать перевод денег через платежную систему
  const [requestData] = await pool.execute(
    'SELECT cost FROM requests WHERE id = ?',
    [requestId]
  );
  const totalDonations = donations.reduce((sum, d) => sum + (d.amount || 0), 0);
  const totalAmount = (requestData[0]?.cost || 0) + totalDonations;
  const commission = totalAmount * 0.1; // 10% комиссия
  const amountToTransfer = totalAmount - commission;
  console.log(`💰 Переведено ${amountToTransfer} исполнителю заявки ${requestId} (из ${totalAmount}, комиссия ${commission})`);

  // 5. Отправляем push-уведомления
  if (creatorId) {
    sendRequestApprovedNotification({ userIds: [creatorId], requestId, messageType: 'creator', requestCategory: 'wasteLocation' }).catch(console.error);
  }
  if (executorId) {
    sendRequestApprovedNotification({ userIds: [executorId], requestId, messageType: 'executor', requestCategory: 'wasteLocation' }).catch(console.error);
  }
  if (donorUserIds.length > 0) {
    sendRequestApprovedNotification({ userIds: donorUserIds, requestId, messageType: 'donor', requestCategory: 'wasteLocation' }).catch(console.error);
  }

  // 6. Меняем статус на completed
  await pool.execute(
    'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
    ['completed', requestId]
  );
  console.log(`✅ Заявка ${requestId} переведена в статус completed`);

  // 7. Удаляем все связанные чаты
  try {
    await deleteChatsForRequest(requestId);
    console.log(`✅ Удалены чаты для заявки ${requestId}`);
  } catch (chatError) {
    console.error('❌ Ошибка при удалении чатов для заявки:', chatError);
  }
}

/**
 * Обработка одобрения заявки типа event
 */
async function handleEventApproval(requestId, creatorId) {
  const coinsToAward = 1;
  const awardedUserIds = new Set();

  // 1. Получаем actual_participants из заявки
  const [requestData] = await pool.execute(
    'SELECT actual_participants, cost FROM requests WHERE id = ?',
    [requestId]
  );
  let actualParticipants = [];
  if (requestData[0]?.actual_participants) {
    try {
      actualParticipants = typeof requestData[0].actual_participants === 'string'
        ? JSON.parse(requestData[0].actual_participants)
        : requestData[0].actual_participants;
    } catch (e) {
      console.error('Ошибка парсинга actual_participants:', e);
    }
  }

  // 2. Начисляем коины заказчику
  if (creatorId) {
    await pool.execute(
      'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_created = COALESCE(coins_from_created, 0) + ?, updated_at = NOW() WHERE id = ?',
      [coinsToAward, coinsToAward, creatorId]
    );
    awardedUserIds.add(creatorId);
    console.log(`✅ Начислено ${coinsToAward} коин заказчику заявки ${requestId}`);
  }

  // 3. Начисляем коины реальным участникам (только из actual_participants)
  const participantUserIds = [];
  for (const participantId of actualParticipants) {
    if (participantId && !awardedUserIds.has(participantId)) {
      await pool.execute(
        'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
        [coinsToAward, coinsToAward, participantId]
      );
      awardedUserIds.add(participantId);
      participantUserIds.push(participantId);
      console.log(`✅ Начислено ${coinsToAward} коин участнику ${participantId} за заявку ${requestId}`);
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
      console.log(`✅ Начислено ${coinsToAward} коин донатеру ${donation.user_id} за заявку ${requestId}`);
    }
  }

  // 5. Переводим деньги заказчику (cost + donations - комиссия)
  // TODO: Реализовать перевод денег через платежную систему
  const totalDonations = donations.reduce((sum, d) => sum + (d.amount || 0), 0);
  const totalAmount = (requestData[0]?.cost || 0) + totalDonations;
  const commission = totalAmount * 0.1; // 10% комиссия
  const amountToTransfer = totalAmount - commission;
  console.log(`💰 Переведено ${amountToTransfer} заказчику заявки ${requestId} (из ${totalAmount}, комиссия ${commission})`);

  // 6. Отправляем push-уведомления
  if (creatorId) {
    sendRequestApprovedNotification({ userIds: [creatorId], requestId, messageType: 'creator', requestCategory: 'event' }).catch(console.error);
  }
  if (participantUserIds.length > 0) {
    sendRequestApprovedNotification({ userIds: participantUserIds, requestId, messageType: 'participant', requestCategory: 'event' }).catch(console.error);
  }
  if (donorUserIds.length > 0) {
    sendRequestApprovedNotification({ userIds: donorUserIds, requestId, messageType: 'donor', requestCategory: 'event' }).catch(console.error);
  }

  // 7. Меняем статус на completed
  await pool.execute(
    'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
    ['completed', requestId]
  );
  console.log(`✅ Заявка ${requestId} переведена в статус completed`);

  // 8. Удаляем все связанные чаты
  try {
    await deleteChatsForRequest(requestId);
    console.log(`✅ Удалены чаты для заявки ${requestId}`);
  } catch (chatError) {
    console.error('❌ Ошибка при удалении чатов для заявки:', chatError);
  }
}

/**
 * Обработка одобрения заявки типа speedCleanup
 */
async function handleSpeedCleanupApproval(requestId, creatorId, earnedCoin) {
  // 1. Начисляем коин создателю только если >= 20 минут
  if (earnedCoin && creatorId) {
    const coinsToAward = 1;
    await pool.execute(
      'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_created = COALESCE(coins_from_created, 0) + ?, updated_at = NOW() WHERE id = ?',
      [coinsToAward, coinsToAward, creatorId]
    );
    console.log(`✅ Начислено ${coinsToAward} коин создателю заявки ${requestId}`);
  }

  // 2. Отправляем push-уведомление создателю
  if (creatorId) {
    sendSpeedCleanupNotification({
      userIds: [creatorId],
      earnedCoin: earnedCoin,
    }).catch(console.error);
  }

  // 3. Статус остается approved (не меняем на completed)
  console.log(`✅ Заявка ${requestId} одобрена, статус остается approved`);
}

/**
 * Обработка отклонения заявки
 */
async function handleRequestRejection(requestId, category, creatorId, rejectionReason, rejectionMessage) {
  // 1. Определяем сообщение об отклонении
  const finalMessage = rejectionMessage || rejectionReason || 'Request was rejected by moderator';

  // 2. Возвращаем деньги создателю (если была платная заявка)
  const [requestData] = await pool.execute(
    'SELECT cost FROM requests WHERE id = ?',
    [requestId]
  );
  if (requestData[0]?.cost && requestData[0].cost > 0) {
    // TODO: Реализовать возврат денег через платежную систему
    console.log(`💰 Возвращено ${requestData[0].cost} создателю заявки ${requestId}`);
  }

  // 3. Возвращаем деньги донатерам
  const [donations] = await pool.execute(
    'SELECT DISTINCT user_id, amount FROM donations WHERE request_id = ?',
    [requestId]
  );
  const donorUserIds = [];
  for (const donation of donations) {
    if (donation.amount && donation.amount > 0) {
      // TODO: Реализовать возврат денег через платежную систему
      console.log(`💰 Возвращено ${donation.amount} донатеру ${donation.user_id} заявки ${requestId}`);
      donorUserIds.push(donation.user_id);
    }
  }

  // 4. Отправляем push-уведомления
  if (creatorId) {
    sendRequestRejectedNotification({
      userIds: [creatorId],
      requestId,
      messageType: 'creator',
      rejectionMessage: finalMessage,
      requestCategory: category,
    }).catch(console.error);
  }
  if (donorUserIds.length > 0) {
    sendRequestRejectedNotification({
      userIds: donorUserIds,
      requestId,
      messageType: 'donor',
      rejectionMessage: finalMessage,
      requestCategory: category,
    }).catch(console.error);
  }

  console.log(`✅ Заявка ${requestId} отклонена`);
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
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    // Проверяем, что это waste заявка
    if (request.category !== 'wasteLocation') {
      return error(res, 'Продление доступно только для заявок типа wasteLocation', 400);
    }

    // Проверяем, что заявка в статусе new
    if (request.status !== 'new') {
      return error(res, 'Продление доступно только для заявок со статусом new', 400);
    }

    // Проверяем, что пользователь - создатель заявки
    if (request.created_by !== userId) {
      return error(res, 'Только создатель заявки может продлить ее', 403);
    }

    // Проверяем, что заявка еще не была продлена
    if (request.extended_count >= 1) {
      return error(res, 'Заявка уже была продлена. Максимум одно продление.', 400);
    }

    // Проверяем, что заявка еще не истекла
    if (request.expires_at && new Date(request.expires_at) <= new Date()) {
      return error(res, 'Заявка уже истекла и не может быть продлена', 400);
    }

    // TODO: После проверки вернуть на 7 дней (сейчас 1 день для тестирования)
    // Продлеваем заявку: expires_at += 1 день (для проверки, потом вернуть на 7 дней), extended_count = 1
    const currentExpiresAt = request.expires_at 
      ? new Date(request.expires_at)
      : new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    
    const newExpiresAt = new Date(currentExpiresAt.getTime() + 1 * 24 * 60 * 60 * 1000);
    const newExpiresAtString = newExpiresAt.toISOString().slice(0, 19).replace('T', ' ');

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
    if (updatedRequest.photos_before) {
      try {
        updatedRequest.photos_before = typeof updatedRequest.photos_before === 'string' 
          ? JSON.parse(updatedRequest.photos_before) 
          : updatedRequest.photos_before;
      } catch (e) {
        updatedRequest.photos_before = [];
      }
    } else {
      updatedRequest.photos_before = [];
    }
    
    if (updatedRequest.photos_after) {
      try {
        updatedRequest.photos_after = typeof updatedRequest.photos_after === 'string' 
          ? JSON.parse(updatedRequest.photos_after) 
          : updatedRequest.photos_after;
      } catch (e) {
        updatedRequest.photos_after = [];
      }
    } else {
      updatedRequest.photos_after = [];
    }

    if (updatedRequest.waste_types) {
      try {
        updatedRequest.waste_types = typeof updatedRequest.waste_types === 'string' 
          ? JSON.parse(updatedRequest.waste_types) 
          : updatedRequest.waste_types;
      } catch (e) {
        updatedRequest.waste_types = [];
      }
    } else {
      updatedRequest.waste_types = [];
    }

    if (updatedRequest.actual_participants) {
      try {
        updatedRequest.actual_participants = typeof updatedRequest.actual_participants === 'string' 
          ? JSON.parse(updatedRequest.actual_participants) 
          : updatedRequest.actual_participants;
      } catch (e) {
        updatedRequest.actual_participants = [];
      }
    } else {
      updatedRequest.actual_participants = [];
    }

    if (updatedRequest.registered_participants) {
      try {
        updatedRequest.registered_participants = typeof updatedRequest.registered_participants === 'string' 
          ? JSON.parse(updatedRequest.registered_participants) 
          : updatedRequest.registered_participants;
      } catch (e) {
        updatedRequest.registered_participants = [];
      }
    } else {
      updatedRequest.registered_participants = [];
    }

    // Получение донатов
    const [donations] = await pool.execute(
      'SELECT * FROM donations WHERE request_id = ? ORDER BY created_at DESC',
      [id]
    );
    updatedRequest.donations = donations;

    // Нормализация дат
    const { normalizeDatesInObject } = require('../utils/datetime');
    const normalizedRequest = normalizeDatesInObject(updatedRequest);

    success(res, normalizedRequest, 200);
  } catch (err) {
    error(res, 'Ошибка при продлении заявки', 500, err);
  }
});

module.exports = router;

