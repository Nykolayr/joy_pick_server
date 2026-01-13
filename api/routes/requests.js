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
const { createGroupChatForRequest } = require('../utils/chatHelpers');
const stripe = require('../config/stripe');
const { deleteInactiveRequests, checkEventAfterStartDate } = require('../../scripts/cronTasks');

const router = express.Router();

/**
 * GET /api/requests
 * Получение списка заявок с фильтрацией
 */
router.get('/', async (req, res) => {
  // Перед возвратом списка - проверяем и удаляем просроченные заявки
  // Используем ту же логику, что и в крон-задачах
  try {
    await deleteInactiveRequests(); // Удаляет waste/speedCleanup через 2 суток
    await checkEventAfterStartDate(); // Удаляет event через 48 часов после start_date
  } catch (cleanupErr) {
    // Не прерываем запрос, если очистка не удалась
  }

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
    } else {
      // Исключаем архивные заявки из общего списка, если статус не указан явно
      conditions.push('r.status != ?');
      params.push('archived');
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
      
      // КРИТИЧЕСКИ ВАЖНО: Для event заявок создатель всегда должен быть в списке участников
      if (request.category === 'event' && request.created_by) {
        if (!result.registered_participants.includes(request.created_by)) {
          result.registered_participants.push(request.created_by);
        }
      }
      
      // Обработка participant_completions из JSON поля
      if (request.participant_completions) {
        try {
          result.participant_completions = typeof request.participant_completions === 'string' 
            ? JSON.parse(request.participant_completions) 
            : request.participant_completions;
        } catch (e) {
          result.participant_completions = {};
        }
      } else {
        result.participant_completions = {};
      }

      // Обработка group_chat_id
      if (request.group_chat_id) {
        result.group_chat_id = request.group_chat_id;
      } else {
        result.group_chat_id = null;
      }

      // Обработка private_chats из JSON поля (для event заявок)
      if (request.private_chats) {
        try {
          result.private_chats = typeof request.private_chats === 'string' 
            ? JSON.parse(request.private_chats) 
            : request.private_chats;
        } catch (e) {
          result.private_chats = [];
        }
      } else {
        result.private_chats = [];
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
    
    // Обработка participant_completions из JSON поля
    if (request.participant_completions) {
      try {
        request.participant_completions = typeof request.participant_completions === 'string' 
          ? JSON.parse(request.participant_completions) 
          : request.participant_completions;
      } catch (e) {
        request.participant_completions = {};
      }
    } else {
      request.participant_completions = {};
    }

    // Обработка group_chat_id
    if (request.group_chat_id) {
      request.group_chat_id = request.group_chat_id;
    } else {
      request.group_chat_id = null;
    }

    // Обработка private_chats из JSON поля (для event заявок)
    if (request.private_chats) {
      try {
        request.private_chats = typeof request.private_chats === 'string' 
          ? JSON.parse(request.private_chats) 
          : request.private_chats;
      } catch (e) {
        request.private_chats = [];
      }
    } else {
      request.private_chats = [];
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

    // Для event заявок инициализируем пустой массив приватных чатов
    let privateChats = null;
    if (category === 'event') {
      privateChats = JSON.stringify([]);
    }

    // КРИТИЧЕСКИ ВАЖНО: Сначала создаем заявку БЕЗ group_chat_id (NULL)
    // Потом создадим групповой чат и обновим заявку
    // Это нужно, чтобы избежать ошибки внешнего ключа (request_id должен существовать в таблице requests)
    await pool.execute(
      `INSERT INTO requests (
        id, user_id, category, name, description, latitude, longitude, city,
        garbage_size, only_foot, possible_by_car, cost, reward_amount, is_open,
        start_date, end_date, status, priority, assigned_to, notes, created_by,
        taken_by, total_contributed, target_amount, joined_user_id, join_date,
        payment_intent_id, completion_comment, plant_tree, trash_pickup_only,
        created_at, updated_at, rejection_reason, rejection_message, actual_participants,
        photos_before, photos_after, registered_participants, waste_types, expires_at,
        extended_count, participant_completions, group_chat_id, private_chats
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        true, // is_open по умолчанию true
        start_date || null,
        end_date || null,
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
        null, // payment_intent_id
        null, // completion_comment
        plant_tree,
        trash_pickup_only,
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
        privateChats
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
      return error(res, 'Ошибка при создании группового чата', 500, chatErr);
    }

    // Инициализация participant_completions для создателя event заявки
    // Создатель автоматически одобрен (не требует подтверждения от заказчика)
    if (category === 'event') {
      try {
        const { initializeParticipantCompletion } = require('../utils/participantCompletions');
        await initializeParticipantCompletion(requestId, userId, true); // true = isCreator
      } catch (completionErr) {
        // Передаем детали ошибки в ответ API
        return error(res, 'Ошибка инициализации participant_completion для создателя', 500, completionErr);
      }
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

    // Обработка group_chat_id и private_chats из БД
    if (request.group_chat_id) {
      request.group_chat_id = request.group_chat_id;
    } else {
      request.group_chat_id = null;
    }

    if (request.private_chats) {
      try {
        request.private_chats = typeof request.private_chats === 'string' 
          ? JSON.parse(request.private_chats) 
          : request.private_chats;
      } catch (e) {
        request.private_chats = [];
      }
    } else {
      request.private_chats = [];
    }

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
    }, 'Заявка создана', 201);
  } catch (err) {
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
        // КРИТИЧЕСКИ ВАЖНО: Для event и wasteLocation изменение статуса на pending разрешено ТОЛЬКО через /close-by-creator
        if (status === 'pending' && oldStatus !== 'pending') {
          if (requestCategory === 'event' || requestCategory === 'wasteLocation') {
            return error(res, 'Для заявок типа event и wasteLocation используйте POST /api/requests/:requestId/close-by-creator для закрытия заявки', 400);
          }
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
    let normalizedJoinedUserId = null;
    let executorUnjoined = false; // Флаг для отслеживания отсоединения исполнителя от waste заявки
    let unjoinedUserId = null; // ID пользователя, который отсоединился
    
    if (joined_user_id !== undefined) {
      // Приравниваем пустую строку к null
      normalizedJoinedUserId = (joined_user_id === '' || joined_user_id === null) ? null : joined_user_id;
      
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
          }).catch(() => {});

          // Отправляем пуш-уведомление всем модераторам
          sendModerationNotification({
            requestId: id,
            requestName: requestInfo.name || 'Unnamed Request',
            requestCategory: requestInfo.category || requestCategory,
            creatorName: requestInfo.creator_name || 'Unknown User',
          }).catch(() => {});
        }
      } catch (error) {
        // Игнорируем ошибки обработки отправки на рассмотрение
      }
    }

    // 2. Обработка одобрения заявки (approved)
    if (statusChangedToApproved) {
      try {
        if (requestCategory === 'wasteLocation') {
          // Для waste: начислить коины, перевести деньги исполнителю, отправить пуши, статус -> archived
          await handleWasteApproval(id, requestCreatedBy);
        } else if (requestCategory === 'event') {
          // Для event: начислить коины (только реальным участникам), перевести деньги заказчику, отправить пуши, статус -> archived
          await handleEventApproval(id, requestCreatedBy);
        } else if (requestCategory === 'speedCleanup') {
          // Для speedCleanup: начислить коин создателю (если >= 20 минут), отправить пуш, статус остается approved
          await handleSpeedCleanupApproval(id, requestCreatedBy, speedCleanupEarnedCoin);
        }
      } catch (error) {
        // Игнорируем ошибки обработки одобрения заявки
      }
    }

    // 3. Обработка отклонения заявки (rejected)
    if (statusChangedToRejected) {
      try {
        await handleRequestRejection(id, requestCategory, requestCreatedBy, rejection_reason, rejection_message);
      } catch (error) {
        // Игнорируем ошибки обработки отклонения заявки
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
    
    // Обработка participant_completions из JSON поля
    if (request.participant_completions) {
      try {
        request.participant_completions = typeof request.participant_completions === 'string' 
          ? JSON.parse(request.participant_completions) 
          : request.participant_completions;
      } catch (e) {
        request.participant_completions = {};
      }
    } else {
      request.participant_completions = {};
    }

    // Нормализация дат в UTC
    const normalizedRequest = normalizeDatesInObject(request);

    success(res, { request: normalizedRequest }, 'Заявка обновлена');
  } catch (err) {
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

    // Получаем все PaymentIntent для заявки (основной платеж и донаты)
    const [requestData] = await pool.execute(
      'SELECT payment_intent_id FROM requests WHERE id = ?',
      [id]
    );
    
    const [donations] = await pool.execute(
      'SELECT payment_intent_id FROM donations WHERE request_id = ?',
      [id]
    );

    // Также ищем PaymentIntent в таблице payment_intents (на случай, если не сохранен в requests)
    const [paymentIntents] = await pool.execute(
      'SELECT payment_intent_id FROM payment_intents WHERE request_id = ? AND type = ?',
      [id, 'request_payment']
    );

    // Собираем все PaymentIntent ID для отмены
    const paymentIntentIds = [];
    if (requestData[0]?.payment_intent_id) {
      paymentIntentIds.push(requestData[0].payment_intent_id);
    }
    donations.forEach(d => {
      if (d.payment_intent_id && !paymentIntentIds.includes(d.payment_intent_id)) {
        paymentIntentIds.push(d.payment_intent_id);
      }
    });
    paymentIntents.forEach(pi => {
      if (pi.payment_intent_id && !paymentIntentIds.includes(pi.payment_intent_id)) {
        paymentIntentIds.push(pi.payment_intent_id);
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
        ? 'Заявка удалена, деньги возвращены на карты'
        : 'Заявка удалена, замороженные средства возвращены';
      
      success(res, response, message);
    } else {
      success(res, null, 'Заявка удалена');
    }
  } catch (err) {
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

    // Проверка статуса заявки
    // Можно присоединиться к заявкам со статусом 'new'
    // Для платных заявок: если статус 'pending_payment', проверяем оплату в Stripe
    // (webhook может еще не обработаться, но оплата уже прошла)
    const [currentRequest] = await pool.execute(
      'SELECT status, payment_intent_id FROM requests WHERE id = ?',
      [id]
    );
    if (currentRequest.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }
    
    const requestStatus = currentRequest[0].status;
    const paymentIntentId = currentRequest[0].payment_intent_id;
    
    // Если статус не 'new' и не 'pending_payment' - нельзя присоединиться
    if (requestStatus !== 'new' && requestStatus !== 'pending_payment') {
      return error(res, 'К этой заявке нельзя присоединиться', 400);
    }
    
    // Если статус 'pending_payment' - проверяем оплату в Stripe
    if (requestStatus === 'pending_payment') {
      if (!paymentIntentId) {
        return error(res, 'Заявка ожидает оплаты', 400);
      }
      
      // Проверяем статус PaymentIntent в Stripe напрямую
      // (webhook мог еще не обработаться, но оплата уже прошла)
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        // Если оплата не прошла - нельзя присоединиться
        if (paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'requires_capture') {
          return error(res, 'Заявка ожидает оплаты. Пожалуйста, завершите оплату.', 400, {
            paymentStatus: paymentIntent.status,
            paymentIntentId: paymentIntentId,
            note: 'Оплата еще не завершена в Stripe'
          });
        }
        
        // Оплата прошла! Обновляем статус заявки на 'new'
        // (webhook обработается позже, но мы не хотим заставлять пользователя ждать)
        await pool.execute(
          'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
          ['new', id]
        );
      } catch (stripeErr) {
        return error(res, 'Ошибка проверки оплаты', 500, {
          errorMessage: stripeErr.message,
          paymentIntentId: paymentIntentId,
          note: 'Не удалось проверить статус оплаты в Stripe'
        });
      }
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

    // Инициализация participant_completions для присоединившегося участника
    try {
      const { initializeParticipantCompletion } = require('../utils/participantCompletions');
      await initializeParticipantCompletion(id, userId);
    } catch (completionErr) {
      // Передаем детали ошибки в ответ API
      return error(res, 'Ошибка инициализации participant_completion', 500, completionErr);
    }

    // Добавление присоединившегося в групповой чат заявки (СИНХРОННО - важно для корректной работы)
    try {
      const { addUserToGroupChatByRequest } = require('../utils/chatHelpers');
      await addUserToGroupChatByRequest(id, userId);
    } catch (chatErr) {
      // Передаем детали ошибки в ответ API
      return error(res, 'Ошибка добавления в групповой чат', 500, chatErr);
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

    success(res, null, 'Вы присоединились к заявке');
  } catch (err) {
    error(res, 'Ошибка при присоединении к заявке', 500, err);
  }
});

/**
 * PUT /api/requests/:id/close-event
 * @deprecated Используйте POST /api/requests/:requestId/close-by-creator
 * Этот эндпоинт отключен в пользу новой системы participant_completions
 * Для закрытия event и waste заявок используйте POST /api/requests/:requestId/close-by-creator
 */
router.put('/:id/close-event', authenticate, uploadRequestPhotos, async (req, res) => {
  return error(res, 'Этот эндпоинт отключен. Используйте POST /api/requests/:requestId/close-by-creator для закрытия заявок типа event и wasteLocation', 410);
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
        return error(res, 'Ошибка инициализации participant_completion', 500, completionErr);
      }
    }

    // Добавление участника события в групповой чат заявки (СИНХРОННО - важно для корректной работы)
    // Выполняем всегда, даже если пользователь уже участник (на случай, если он был удален из чата)
    try {
      const { addUserToGroupChatByRequest } = require('../utils/chatHelpers');
      await addUserToGroupChatByRequest(id, userId);
    } catch (chatErr) {
      // Передаем детали ошибки в ответ API
      return error(res, 'Ошибка добавления в групповой чат', 500, chatErr);
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
                  return error(res, 'Не удалось создать приватный чат', 500, {
                    errorMessage: 'Чат уже существует, но не удалось его найти',
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
      return error(res, 'Ошибка создания приватного чата', 500, privateChatErr);
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
      ? 'Вы уже участвуете в этом событии' 
      : 'Вы присоединились к событию';
    success(res, null, message);
  } catch (err) {
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
      'SELECT id, category, created_by, registered_participants FROM requests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    if (request.category !== 'event') {
      return error(res, 'Это не событие', 400);
    }

    // КРИТИЧЕСКИ ВАЖНО: Создатель не может отменить участие (он всегда остается участником)
    if (request.created_by === userId) {
      return error(res, 'Создатель события не может отменить участие', 400);
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

    success(res, null, 'Участие отменено');
  } catch (err) {
    error(res, 'Ошибка при отмене участия', 500, err);
  }
});

/**
 * Обработка одобрения заявки типа wasteLocation
 */
async function handleWasteApproval(requestId, creatorId) {
  const coinsToAward = 1;
  const awardedUserIds = new Set();

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

  // 4. Переводим деньги исполнителю (cost + donations - комиссия)
  // TODO: Реализовать перевод денег через платежную систему
  const [requestData] = await pool.execute(
    'SELECT cost FROM requests WHERE id = ?',
    [requestId]
  );
  // MySQL возвращает decimal как строки, поэтому используем parseFloat
  const totalDonations = donations.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
  const totalAmount = parseFloat(requestData[0]?.cost || 0) + totalDonations;
  const commission = totalAmount * 0.1; // 10% комиссия
  const amountToTransfer = totalAmount - commission;

  // 5. Отправляем push-уведомления
  if (creatorId) {
    sendRequestApprovedNotification({ userIds: [creatorId], requestId, messageType: 'creator', requestCategory: 'wasteLocation' }).catch(() => {});
  }
  if (executorUserIds.length > 0) {
    sendRequestApprovedNotification({ userIds: executorUserIds, requestId, messageType: 'executor', requestCategory: 'wasteLocation' }).catch(() => {});
  }
  if (donorUserIds.length > 0) {
    sendRequestApprovedNotification({ userIds: donorUserIds, requestId, messageType: 'donor', requestCategory: 'wasteLocation' }).catch(() => {});
  }

  // 6. Удаляем групповой чат заявки (асинхронно, не блокируем выполнение)
  const { deleteGroupChatForRequest } = require('../utils/chatHelpers');
  deleteGroupChatForRequest(requestId).catch(() => {});

  // 7. Меняем статус на archived
  await pool.execute(
    'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
    ['archived', requestId]
  );
}

/**
 * Обработка одобрения заявки типа event
 */
async function handleEventApproval(requestId, creatorId) {
  const coinsToAward = 1;
  const awardedUserIds = new Set();

  // 1. Получаем cost из заявки
  const [requestData] = await pool.execute(
    'SELECT cost FROM requests WHERE id = ?',
    [requestId]
  );

  // 2. Начисляем коины заказчику (создателю заявки)
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

  // 5. Переводим деньги заказчику (cost + donations - комиссия)
  // TODO: Реализовать перевод денег через платежную систему
  // MySQL возвращает decimal как строки, поэтому используем parseFloat
  const totalDonations = donations.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
  const totalAmount = parseFloat(requestData[0]?.cost || 0) + totalDonations;
  const commission = totalAmount * 0.1; // 10% комиссия
  const amountToTransfer = totalAmount - commission;

  // 6. Отправляем push-уведомления
  if (creatorId) {
    sendRequestApprovedNotification({ userIds: [creatorId], requestId, messageType: 'creator', requestCategory: 'event' }).catch(() => {});
  }
  if (participantUserIds.length > 0) {
    sendRequestApprovedNotification({ userIds: participantUserIds, requestId, messageType: 'participant', requestCategory: 'event' }).catch(() => {});
  }
  if (donorUserIds.length > 0) {
    sendRequestApprovedNotification({ userIds: donorUserIds, requestId, messageType: 'donor', requestCategory: 'event' }).catch(() => {});
  }

  // 7. Удаляем групповой чат заявки (асинхронно, не блокируем выполнение)
  const { deleteGroupChatForRequest } = require('../utils/chatHelpers');
  deleteGroupChatForRequest(requestId).catch(() => {});

  // 8. Меняем статус на archived
  await pool.execute(
    'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
    ['archived', requestId]
  );
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
  }

  // 2. Отправляем push-уведомление создателю
  if (creatorId) {
    sendSpeedCleanupNotification({
      userIds: [creatorId],
      earnedCoin: earnedCoin,
    }).catch(() => {});
  }

  // 3. Статус остается approved (не меняем на completed)
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
    }).catch(() => {});
  }
  if (donorUserIds.length > 0) {
    sendRequestRejectedNotification({
      userIds: donorUserIds,
      requestId,
      messageType: 'donor',
      rejectionMessage: finalMessage,
      requestCategory: category,
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
      'SELECT id, category, status, created_by, joined_user_id, registered_participants, start_date FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    // Проверка типа заявки
    if (request.category !== 'event' && request.category !== 'wasteLocation') {
      return error(res, 'Этот тип заявки не поддерживает закрытие работы участником', 400);
    }

    // Проверка статуса заявки
    if (request.status !== 'inProgress') {
      return error(res, 'Заявка должна быть в статусе inProgress', 400);
    }

    // Проверка, что пользователь является участником
    let isParticipant = false;
    if (request.category === 'event') {
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
      isParticipant = registeredParticipants.includes(userId);
    } else if (request.category === 'wasteLocation') {
      isParticipant = request.joined_user_id === userId;
    }

    if (!isParticipant) {
      return error(res, 'Вы не являетесь участником этой заявки', 403);
    }

    // Для event: проверка, что событие началось
    if (request.category === 'event' && request.start_date) {
      const startDate = new Date(request.start_date);
      const now = new Date();
      if (startDate > now) {
        return error(res, 'Событие еще не началось', 400);
      }
    }

    // Получаем данные из формы
    const uploadedPhotosAfter = req.files?.photos_after || [];
    const completionComment = req.body.completion_comment || null;
    const completionLatitude = parseFloat(req.body.completion_latitude);
    const completionLongitude = parseFloat(req.body.completion_longitude);

    // Валидация
    if (uploadedPhotosAfter.length === 0) {
      return error(res, 'Необходимо загрузить минимум одно фото', 400);
    }

    if (isNaN(completionLatitude) || isNaN(completionLongitude)) {
      return error(res, 'Необходимо указать координаты', 400);
    }

    // Сохраняем фото и получаем URL
    const photosAfterUrls = uploadedPhotosAfter.map(file => getFileUrlFromPath(file.path));

    // Обновляем participant_completions
    const { updateParticipantCompletion } = require('../utils/participantCompletions');
    await updateParticipantCompletion(requestId, userId, {
      status: 'pending',
      photos_after: photosAfterUrls,
      completion_comment: completionComment,
      completion_latitude: completionLatitude,
      completion_longitude: completionLongitude,
      completed_at: new Date().toISOString()
    });

    // Для wasteLocation: сразу меняем статус заявки на pending и отправляем уведомление админам
    // Для event: только обновляем participant_completions, статус заявки остается inProgress
    if (request.category === 'wasteLocation') {
      // Меняем статус заявки на pending (отправка на модерацию)
      await pool.execute(
        'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
        ['pending', requestId]
      );

      // Получаем информацию о заявке для уведомления админам
      const [requestInfo] = await pool.execute(
        'SELECT r.name, u.display_name as creator_name FROM requests r LEFT JOIN users u ON r.created_by = u.id WHERE r.id = ?',
        [requestId]
      );

      // Отправляем push-уведомление админам о новой заявке на модерации
      const { sendModerationNotification } = require('../services/pushNotification');
      sendModerationNotification({
        requestId: requestId,
        requestName: requestInfo[0]?.name || 'Unnamed Request',
        requestCategory: 'wasteLocation',
        creatorName: requestInfo[0]?.creator_name || 'Unknown User',
      }).catch(() => {});
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
    if (updatedRequest.participant_completions) {
      try {
        updatedRequest.participant_completions = typeof updatedRequest.participant_completions === 'string'
          ? JSON.parse(updatedRequest.participant_completions)
          : updatedRequest.participant_completions;
      } catch (e) {
        updatedRequest.participant_completions = {};
      }
    } else {
      updatedRequest.participant_completions = {};
    }

    const successMessage = request.category === 'wasteLocation' 
      ? 'Заявка закрыта и отправлена на модерацию' 
      : 'Работа закрыта, ожидает одобрения';
    success(res, { request: normalizeDatesInObject(updatedRequest) }, successMessage);
  } catch (err) {
    error(res, 'Ошибка при закрытии работы', 500, err);
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
      return error(res, 'Необходимо указать action: approve или reject', 400);
    }

    if (action === 'reject' && !rejection_reason) {
      return error(res, 'При отклонении необходимо указать rejection_reason', 400);
    }

    // Получаем заявку
    const [requests] = await pool.execute(
      'SELECT id, category, created_by, participant_completions FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    // Для wasteLocation: одобрение/отклонение недоступно
    if (request.category === 'wasteLocation') {
      return error(res, 'Для заявок типа wasteLocation одобрение/отклонение недоступно', 403);
    }

    // Проверка прав доступа (только создатель может одобрять/отклонять)
    if (request.created_by !== currentUserId && !req.user.isAdmin) {
      return error(res, 'Доступ запрещен. Только создатель заявки может одобрять/отклонять закрытие работы', 403);
    }

    // Получаем participant_completions
    const { getParticipantCompletions, updateParticipantCompletion } = require('../utils/participantCompletions');
    const completions = await getParticipantCompletions(requestId);

    if (!completions[userId]) {
      return error(res, 'Участник не найден в participant_completions', 404);
    }

    // Проверка статуса (должен быть pending)
    if (completions[userId].status !== 'pending') {
      return error(res, 'Статус участника должен быть pending', 400);
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
      sendRequestRejectedNotification({
        userIds: [userId],
        requestId: requestId,
        messageType: 'participant',
        rejectionMessage: `Ваше закрытие работы отклонено. Причина: ${rejection_reason}`,
        requestCategory: request.category
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
    if (updatedRequest.participant_completions) {
      try {
        updatedRequest.participant_completions = typeof updatedRequest.participant_completions === 'string'
          ? JSON.parse(updatedRequest.participant_completions)
          : updatedRequest.participant_completions;
      } catch (e) {
        updatedRequest.participant_completions = {};
      }
    } else {
      updatedRequest.participant_completions = {};
    }

    success(res, { request: normalizeDatesInObject(updatedRequest) }, action === 'approve' ? 'Закрытие работы одобрено' : 'Закрытие работы отклонено');
  } catch (err) {
    error(res, 'Ошибка при одобрении/отклонении закрытия работы', 500, err);
  }
});

/**
 * POST /api/requests/:requestId/close-by-creator
 * Закрытие заявки создателем
 */
router.post('/:requestId/close-by-creator', authenticate, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.userId;
    const { completion_comment } = req.body;

    // Получаем заявку
    const [requests] = await pool.execute(
      'SELECT id, category, status, created_by FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    // Для wasteLocation: создатель не может закрывать заявку
    if (request.category === 'wasteLocation') {
      return error(res, 'Для заявок типа wasteLocation создатель не может закрывать заявку', 403);
    }

    // Проверка типа заявки
    if (request.category !== 'event') {
      return error(res, 'Этот тип заявки не поддерживает закрытие создателем', 400);
    }

    // Проверка прав доступа (только создатель может закрыть для event)
    // СТРОГАЯ ПРОВЕРКА: только создатель, админ не может закрывать заявку для этих типов
    if (request.created_by !== userId) {
      return error(res, 'Только создатель заявки может закрыть заявку', 403);
    }

    // Проверка статуса
    if (request.status !== 'inProgress') {
      return error(res, 'Заявка должна быть в статусе inProgress', 400);
    }

    // Обновляем статус заявки на pending
    const updates = ['status = ?', 'updated_at = NOW()'];
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
    if (updatedRequest.participant_completions) {
      try {
        updatedRequest.participant_completions = typeof updatedRequest.participant_completions === 'string'
          ? JSON.parse(updatedRequest.participant_completions)
          : updatedRequest.participant_completions;
      } catch (e) {
        updatedRequest.participant_completions = {};
      }
    } else {
      updatedRequest.participant_completions = {};
    }

    success(res, { request: normalizeDatesInObject(updatedRequest) }, 'Заявка закрыта и отправлена на рассмотрение');
  } catch (err) {
    error(res, 'Ошибка при закрытии заявки', 500, err);
  }
});

/**
 * POST /api/requests/create-with-payment
 * Атомарное создание заявки с платежом
 * Создает заявку и PaymentIntent в одной транзакции
 */
router.post('/create-with-payment', authenticate, uploadRequestPhotos, [
  body('category').isIn(['wasteLocation', 'speedCleanup', 'event']).withMessage('Некорректная категория'),
  body('name').notEmpty().withMessage('Название обязательно'),
  body('description').optional().isString(),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('city').optional().isString(),
  body('require_payment').optional().isBoolean(),
  body('request_category').optional().isString()
], async (req, res) => {
  let connection = null;
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    // Обработка загруженных файлов
    const uploadedPhotosBefore = [];
    const uploadedPhotosAfter = [];

    if (req.files) {
      if (req.files.photos_before && Array.isArray(req.files.photos_before)) {
        for (const file of req.files.photos_before) {
          const fileUrl = getFileUrlFromPath(file.path);
          if (fileUrl) uploadedPhotosBefore.push(fileUrl);
        }
      }

      if (req.files.photos_after && Array.isArray(req.files.photos_after)) {
        for (const file of req.files.photos_after) {
          const fileUrl = getFileUrlFromPath(file.path);
          if (fileUrl) uploadedPhotosAfter.push(fileUrl);
        }
      }
    }

    // Парсим данные
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
      cost,
      reward_amount,
      start_date,
      end_date,
      status,
      priority = 'medium',
      waste_types = [],
      target_amount,
      plant_tree = false,
      trash_pickup_only = false,
      require_payment = false,
      request_category
    } = bodyData;

    // Обработка waste_types
    let processedWasteTypes = [];
    if (waste_types) {
      if (Array.isArray(waste_types)) {
        processedWasteTypes = waste_types;
      } else if (typeof waste_types === 'string') {
        try {
          processedWasteTypes = JSON.parse(waste_types);
        } catch (e) {
          processedWasteTypes = waste_types.split(',').map(t => t.trim()).filter(t => t);
        }
      }
    }

    const requestId = generateId();
    const userId = req.user.userId;

    // Определяем сумму для платежа
    // ВАЖНО: cost всегда в долларах (decimal), как и возвращается на фронт
    let paymentAmountCents = null;
    
    if (require_payment) {
      if (!cost || cost <= 0) {
        return error(res, 'Если require_payment = true, необходимо указать cost > 0', 400);
      }
      
      // Конвертируем cost (в долларах) в центы для PaymentIntent
      paymentAmountCents = Math.round(parseFloat(cost) * 100);

      if (paymentAmountCents < 50) {
        return error(res, 'Минимум 50 центов (требование Stripe)', 400);
      }
    }

    // Определяем статус заявки
    let requestStatus;
    if (require_payment && paymentAmountCents > 0) {
      requestStatus = 'pending_payment';
    } else {
      // Стандартная логика по категории
      if (category === 'wasteLocation' || category === 'speedCleanup') {
        requestStatus = status || 'new';
      } else if (category === 'event') {
        requestStatus = 'inProgress';
      } else {
        requestStatus = 'new';
      }
    }

    // Начинаем транзакцию
    connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Для event: создатель автоматически становится участником
      let registeredParticipants = null;
      if (category === 'event') {
        registeredParticipants = JSON.stringify([userId]);
      }

      const expiresAt = category === 'wasteLocation' 
        ? new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
        : null;

      let privateChats = null;
      if (category === 'event') {
        privateChats = JSON.stringify([]);
      }

      // Создаем заявку в БД (пока без group_chat_id и payment_intent_id)
      await connection.execute(
        `INSERT INTO requests (
          id, user_id, category, name, description, latitude, longitude, city,
          garbage_size, only_foot, possible_by_car, cost, reward_amount, is_open,
          start_date, end_date, status, priority, assigned_to, notes, created_by,
          taken_by, total_contributed, target_amount, joined_user_id, join_date,
          payment_intent_id, completion_comment, plant_tree, trash_pickup_only,
          created_at, updated_at, rejection_reason, rejection_message, actual_participants,
          photos_before, photos_after, registered_participants, waste_types, expires_at,
          extended_count, participant_completions, group_chat_id, private_chats
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          true, // is_open
          start_date || null,
          end_date || null,
          requestStatus,
          priority,
          null, // assigned_to
          null, // notes
          userId, // created_by
          null, // taken_by
          null, // total_contributed
          target_amount || null,
          null, // joined_user_id
          null, // join_date
          null, // payment_intent_id (обновим после создания PaymentIntent)
          null, // completion_comment
          plant_tree,
          trash_pickup_only,
          null, // rejection_reason
          null, // rejection_message
          null, // actual_participants
          uploadedPhotosBefore.length > 0 ? JSON.stringify(uploadedPhotosBefore) : null,
          uploadedPhotosAfter.length > 0 ? JSON.stringify(uploadedPhotosAfter) : null,
          registeredParticipants,
          processedWasteTypes.length > 0 ? JSON.stringify(processedWasteTypes) : null,
          expiresAt,
          0, // extended_count
          null, // participant_completions
          null, // group_chat_id (обновим после создания чата)
          privateChats
        ]
      );

      // Создаем PaymentIntent если требуется
      let paymentIntent = null;
      let clientSecret = null;
      let stripePaymentIntentId = null;

      if (require_payment && paymentAmountCents > 0) {
        // Проверяем, что Stripe API ключ настроен
        if (!process.env.STRIPE_SECRET_KEY) {
          await connection.rollback();
          connection.release();
          return error(res, 'Stripe не настроен на сервере', 500, {
            requestId: requestId,
            userId: userId,
            amountCents: paymentAmountCents,
            note: 'STRIPE_SECRET_KEY не найден в переменных окружения'
          });
        }

        try {
          // Создаем PaymentIntent с таймаутом
          const stripePaymentIntent = await Promise.race([
            stripe.paymentIntents.create({
              amount: paymentAmountCents,
              currency: 'usd',
              payment_method_types: ['card'],
              capture_method: 'manual',
              metadata: {
                request_id: requestId,
                user_id: userId,
                request_category: request_category || category,
                type: 'request_payment'
              }
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Stripe API timeout: создание PaymentIntent заняло больше 15 секунд')), 15000)
            )
          ]);

          // КРИТИЧЕСКИ ВАЖНО: Проверяем что Stripe вернул корректный ответ
          if (!stripePaymentIntent) {
            throw new Error('Stripe вернул пустой ответ (null или undefined)');
          }

          if (!stripePaymentIntent.id) {
            throw new Error('Stripe не вернул payment_intent_id в ответе');
          }

          if (!stripePaymentIntent.client_secret) {
            throw new Error('Stripe не вернул client_secret в ответе. PaymentIntent ID: ' + stripePaymentIntent.id);
          }

          stripePaymentIntentId = stripePaymentIntent.id;
          clientSecret = stripePaymentIntent.client_secret;

          // Обновляем заявку с payment_intent_id
          await connection.execute(
            'UPDATE requests SET payment_intent_id = ? WHERE id = ?',
            [stripePaymentIntentId, requestId]
          );

          // Сохраняем PaymentIntent в БД
          const paymentIntentId = generateId();
          await connection.execute(
            `INSERT INTO payment_intents (id, payment_intent_id, user_id, request_id, amount_cents, currency, status, type, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              paymentIntentId,
              stripePaymentIntentId,
              userId,
              requestId,
              paymentAmountCents,
              'usd',
              stripePaymentIntent.status,
              'request_payment',
              JSON.stringify({
                request_id: requestId,
                user_id: userId,
                request_category: request_category || category,
                type: 'request_payment'
              })
            ]
          );

          paymentIntent = {
            payment_intent_id: stripePaymentIntentId,
            client_secret: clientSecret
          };
        } catch (stripeErr) {
          // Если ошибка при создании PaymentIntent, откатываем транзакцию
          await connection.rollback();
          connection.release();
          
          // Возвращаем детальную ошибку в ответе API с МАКСИМУМ информации
          return error(res, 'Ошибка при создании PaymentIntent в Stripe', 500, {
            errorMessage: stripeErr.message || 'Неизвестная ошибка',
            errorType: stripeErr.type || 'StripeError',
            errorCode: stripeErr.code || 'STRIPE_ERROR',
            statusCode: stripeErr.statusCode || 500,
            requestId: requestId,
            userId: userId,
            amountCents: paymentAmountCents,
            amountDollars: parseFloat(cost),
            category: category,
            requestCategory: request_category,
            stripeRaw: stripeErr.raw || null,
            stripeDeclineCode: stripeErr.decline_code || null,
            stripeParam: stripeErr.param || null,
            stack: process.env.NODE_ENV === 'development' ? stripeErr.stack : undefined
          });
        }
      }

      // Создаем групповой чат с таймаутом (не блокируем создание заявки)
      let groupChatId = null;
      try {
        groupChatId = await Promise.race([
          createGroupChatForRequest(requestId, userId, category),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Таймаут создания группового чата: операция заняла больше 5 секунд')), 5000)
          )
        ]);
        
        // Обновляем заявку с group_chat_id
        await connection.execute(
          'UPDATE requests SET group_chat_id = ? WHERE id = ?',
          [groupChatId, requestId]
        );
      } catch (chatErr) {
        // КРИТИЧЕСКИ ВАЖНО: НЕ откатываем транзакцию, если не удалось создать чат
        // Заявка уже создана, чат можно создать позже или асинхронно
        // Просто логируем ошибку и продолжаем
        const chatError = {
          message: chatErr.message || 'Неизвестная ошибка при создании группового чата',
          requestId: requestId,
          userId: userId,
          category: category,
          note: 'Заявка создана, но чат не создан. Чат можно создать позже через отдельный endpoint.'
        };
        
        // Сохраняем информацию об ошибке для последующего создания чата
        // Можно создать чат асинхронно после коммита транзакции
      }

      // Фиксируем транзакцию
      await connection.commit();
      connection.release();
      connection = null;
      
      // Инициализация participant_completions для создателя event заявки
      // ВАЖНО: Делаем ПОСЛЕ коммита транзакции, чтобы не блокировать создание заявки
      if (category === 'event') {
        // Выполняем асинхронно, не блокируем ответ
        const { initializeParticipantCompletion } = require('../utils/participantCompletions');
        initializeParticipantCompletion(requestId, userId, true)
          .catch((completionErr) => {
            // Логируем ошибку, но не прерываем выполнение
            console.error('Ошибка инициализации participant_completion для создателя event:', completionErr);
          });
      }
      
      // Если чат не был создан, пытаемся создать его асинхронно (не блокируем ответ)
      if (!groupChatId) {
        // Создаем чат асинхронно, не ждем результата
        createGroupChatForRequest(requestId, userId, category)
          .then(async (asyncChatId) => {
            // Обновляем заявку с group_chat_id
            try {
              await pool.execute(
                'UPDATE requests SET group_chat_id = ? WHERE id = ?',
                [asyncChatId, requestId]
              );
            } catch (updateErr) {
              // Игнорируем ошибки обновления - чат создан, но не привязан к заявке
            }
          })
          .catch((asyncChatErr) => {
            // Игнорируем ошибки асинхронного создания - заявка уже создана
          });
      }

      // Получаем созданную заявку
      const [requests] = await pool.execute(
        `SELECT r.* FROM requests r WHERE r.id = ?`,
        [requestId]
      );

      if (requests.length === 0) {
        return error(res, 'Заявка не найдена после создания', 500);
      }

      const request = requests[0];
      
      // Обработка JSON полей
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

      if (request.private_chats) {
        try {
          request.private_chats = typeof request.private_chats === 'string' 
            ? JSON.parse(request.private_chats) 
            : request.private_chats;
        } catch (e) {
          request.private_chats = [];
        }
      } else {
        request.private_chats = [];
      }

      request.participants = [];
      request.contributors = [];
      request.contributions = {};
      request.donations = [];

      // Нормализация дат
      const normalizedRequest = normalizeDatesInObject(request);

      // КРИТИЧЕСКИ ВАЖНО: Финальная проверка - если требовался платеж, проверяем что paymentIntent корректен
      if (require_payment && paymentAmountCents > 0) {
        if (!paymentIntent) {
          return error(res, 'Критическая ошибка: заявка создана, но объект paymentIntent равен null', 500, {
            requestId: requestId,
            userId: userId,
            amountCents: paymentAmountCents,
            note: 'Заявка сохранена в БД с payment_intent_id, но объект paymentIntent не был создан в коде. Это баг сервера.'
          });
        }

        if (!paymentIntent.client_secret) {
          return error(res, 'Критическая ошибка: заявка создана, но client_secret отсутствует', 500, {
            requestId: requestId,
            userId: userId,
            paymentIntentId: paymentIntent.payment_intent_id || 'undefined',
            amountCents: paymentAmountCents,
            paymentIntentObject: paymentIntent,
            note: 'Stripe вернул PaymentIntent, но без client_secret. Возможно проблема с аккаунтом Stripe или API ключом.'
          });
        }

        if (!paymentIntent.payment_intent_id) {
          return error(res, 'Критическая ошибка: заявка создана, но payment_intent_id отсутствует', 500, {
            requestId: requestId,
            userId: userId,
            clientSecret: paymentIntent.client_secret ? 'присутствует' : 'отсутствует',
            amountCents: paymentAmountCents,
            paymentIntentObject: paymentIntent,
            note: 'Объект paymentIntent создан, но payment_intent_id отсутствует'
          });
        }
      }

      // Отправка push-уведомлений (асинхронно)
      if (latitude && longitude) {
        sendRequestCreatedNotification({
          id: requestId,
          category,
          name,
          created_by: userId,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          photos: [...uploadedPhotosBefore, ...uploadedPhotosAfter],
        }).catch(err => {
          // Игнорируем ошибки уведомлений
        });
      }

      return success(res, {
        request: normalizedRequest,
        payment: paymentIntent
      }, 'Заявка создана успешно', 201);

    } catch (transactionErr) {
      // Откатываем транзакцию при любой ошибке
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      throw transactionErr;
    }

  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
        connection.release();
      } catch (rollbackErr) {
        // Игнорируем ошибки отката, но добавляем в детали основной ошибки
        err.rollbackError = rollbackErr.message;
      }
    }
    
    // ВСЕГДА возвращаем детальную ошибку в ответе API
    // Если err уже Error объект, используем его, иначе создаем новый
    const errorObj = err instanceof Error ? err : new Error(err.message || 'Неизвестная ошибка при создании заявки с платежом');
    
    // Добавляем все доступные детали
    if (err.sqlMessage) errorObj.sqlMessage = err.sqlMessage;
    if (err.sql) errorObj.sql = err.sql;
    if (err.errno) errorObj.errno = err.errno;
    if (err.sqlState) errorObj.sqlState = err.sqlState;
    if (err.rollbackError) errorObj.rollbackError = err.rollbackError;
    if (err.code) errorObj.code = err.code;
    if (process.env.NODE_ENV !== 'production' && err.stack) {
      errorObj.stack = err.stack;
    }
    
    return error(res, 'Ошибка при создании заявки с платежом', 500, errorObj);
  }
});

module.exports = router;

