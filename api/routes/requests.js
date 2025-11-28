const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { uploadRequestPhotos, getFileUrlFromPath } = require('../middleware/upload');
const { sendRequestCreatedNotification, sendJoinNotification } = require('../services/pushNotification');

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
      SELECT r.*,
       GROUP_CONCAT(DISTINCT rp.photo_url ORDER BY rp.photo_type, rp.created_at) as photos,
       GROUP_CONCAT(DISTINCT rpb.photo_url ORDER BY rpb.created_at) as photos_before,
       GROUP_CONCAT(DISTINCT rpa.photo_url ORDER BY rpa.created_at) as photos_after
      FROM requests r
      LEFT JOIN request_photos rp ON r.id = rp.request_id AND rp.photo_type = 'photo'
      LEFT JOIN request_photos rpb ON r.id = rpb.request_id AND rpb.photo_type = 'photo_before'
      LEFT JOIN request_photos rpa ON r.id = rpa.request_id AND rpa.photo_type = 'photo_after'
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
    query += ` GROUP BY r.id ORDER BY r.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

    const [requests] = await pool.execute(query, params);

    // Обработка результатов
    const processedRequests = requests.map(request => {
      const result = Object.assign({}, request);
      
      // Преобразование фотографий
      result.photos = request.photos ? request.photos.split(',') : [];
      result.photos_before = request.photos_before ? request.photos_before.split(',') : [];
      result.photos_after = request.photos_after ? request.photos_after.split(',') : [];
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
      
      // Преобразование булевых значений
      result.only_foot = Boolean(result.only_foot);
      result.possible_by_car = Boolean(result.possible_by_car);
      result.is_open = Boolean(result.is_open);
      result.plant_tree = Boolean(result.plant_tree);
      result.trash_pickup_only = Boolean(result.trash_pickup_only);
      
      return result;
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
      `SELECT r.*,
       GROUP_CONCAT(DISTINCT rp.photo_url ORDER BY rp.photo_type, rp.created_at) as photos,
       GROUP_CONCAT(DISTINCT rpb.photo_url ORDER BY rpb.created_at) as photos_before,
       GROUP_CONCAT(DISTINCT rpa.photo_url ORDER BY rpa.created_at) as photos_after
      FROM requests r
      LEFT JOIN request_photos rp ON r.id = rp.request_id AND rp.photo_type = 'photo'
      LEFT JOIN request_photos rpb ON r.id = rpb.request_id AND rpb.photo_type = 'photo_before'
      LEFT JOIN request_photos rpa ON r.id = rpa.request_id AND rpa.photo_type = 'photo_after'
      WHERE r.id = ?
      GROUP BY r.id`,
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];
    
    // Получение участников
    const [participants] = await pool.execute(
      'SELECT user_id FROM request_participants WHERE request_id = ?',
      [id]
    );
    request.participants = participants.map(p => p.user_id);

    // Получение вкладчиков
    const [contributors] = await pool.execute(
      'SELECT user_id, amount FROM request_contributors WHERE request_id = ?',
      [id]
    );
    request.contributors = contributors.map(c => c.user_id);
    request.contributions = {};
    contributors.forEach(c => {
      request.contributions[c.user_id] = c.amount;
    });

    // Получение донатов
    const [donations] = await pool.execute(
      'SELECT * FROM donations WHERE request_id = ? ORDER BY created_at DESC',
      [id]
    );
    request.donations = donations;

    // Обработка данных
    request.photos = request.photos ? request.photos.split(',') : [];
    request.photos_before = request.photos_before ? request.photos_before.split(',') : [];
    request.photos_after = request.photos_after ? request.photos_after.split(',') : [];
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
    request.only_foot = Boolean(request.only_foot);
    request.possible_by_car = Boolean(request.possible_by_car);
    request.is_open = Boolean(request.is_open);
    request.plant_tree = Boolean(request.plant_tree);
    request.trash_pickup_only = Boolean(request.trash_pickup_only);

    success(res, { request });
  } catch (err) {
    console.error('Ошибка получения заявки:', err);
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

    // Обработка загруженных файлов
    const uploadedPhotos = [];
    const uploadedPhotosBefore = [];
    const uploadedPhotosAfter = [];

    if (req.files) {
      // Обрабатываем основные фото
      if (req.files.photos && Array.isArray(req.files.photos)) {
        for (const file of req.files.photos) {
          const fileUrl = getFileUrlFromPath(file.path);
          if (fileUrl) uploadedPhotos.push(fileUrl);
        }
      }

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
      status = 'pending',
      priority = 'medium',
      waste_types = [],
      photos = [],
      photos_before = [],
      photos_after = [],
      target_amount,
      plant_tree = false,
      trash_pickup_only = false
    } = bodyData;

    // Объединяем загруженные файлы с URL из JSON (приоритет у загруженных файлов)
    const finalPhotos = uploadedPhotos.length > 0 ? uploadedPhotos : (Array.isArray(photos) ? photos : []);
    const finalPhotosBefore = uploadedPhotosBefore.length > 0 ? uploadedPhotosBefore : (Array.isArray(photos_before) ? photos_before : []);
    const finalPhotosAfter = uploadedPhotosAfter.length > 0 ? uploadedPhotosAfter : (Array.isArray(photos_after) ? photos_after : []);

    const requestId = generateId();
    const userId = req.user.userId;

    // Создание заявки
    await pool.execute(
      `INSERT INTO requests (
        id, user_id, category, name, description, latitude, longitude, city,
        garbage_size, only_foot, possible_by_car, cost, reward_amount,
        start_date, end_date, status, priority, created_by, target_amount,
        plant_tree, trash_pickup_only, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
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
        status,
        priority,
        userId, // created_by использует тот же userId
        target_amount || null,
        plant_tree,
        trash_pickup_only
      ]
    );

    // Добавление фотографий
    if (finalPhotos.length > 0) {
      for (const photoUrl of finalPhotos) {
        await pool.execute(
          'INSERT INTO request_photos (id, request_id, photo_url, photo_type) VALUES (?, ?, ?, ?)',
          [generateId(), requestId, photoUrl, 'photo']
        );
      }
    }

    if (finalPhotosBefore.length > 0) {
      for (const photoUrl of finalPhotosBefore) {
        await pool.execute(
          'INSERT INTO request_photos (id, request_id, photo_url, photo_type) VALUES (?, ?, ?, ?)',
          [generateId(), requestId, photoUrl, 'photo_before']
        );
      }
    }

    if (finalPhotosAfter.length > 0) {
      for (const photoUrl of finalPhotosAfter) {
        await pool.execute(
          'INSERT INTO request_photos (id, request_id, photo_url, photo_type) VALUES (?, ?, ?, ?)',
          [generateId(), requestId, photoUrl, 'photo_after']
        );
      }
    }

    // Сохранение типов отходов как JSON массив названий
    if (waste_types && Array.isArray(waste_types) && waste_types.length > 0) {
      await pool.execute(
        'UPDATE requests SET waste_types = ? WHERE id = ?',
        [JSON.stringify(waste_types), requestId]
      );
    }

    // Получение созданной заявки
    const [requests] = await pool.execute(
      `SELECT r.*,
       GROUP_CONCAT(DISTINCT rp.photo_url ORDER BY rp.photo_type, rp.created_at) as photos,
       GROUP_CONCAT(DISTINCT rpb.photo_url ORDER BY rpb.created_at) as photos_before,
       GROUP_CONCAT(DISTINCT rpa.photo_url ORDER BY rpa.created_at) as photos_after
      FROM requests r
      LEFT JOIN request_photos rp ON r.id = rp.request_id AND rp.photo_type = 'photo'
      LEFT JOIN request_photos rpb ON r.id = rpb.request_id AND rpb.photo_type = 'photo_before'
      LEFT JOIN request_photos rpa ON r.id = rpa.request_id AND rpa.photo_type = 'photo_after'
      WHERE r.id = ?
      GROUP BY r.id`,
      [requestId]
    );

    const request = requests[0];
    request.photos = request.photos ? request.photos.split(',') : [];
    request.photos_before = request.photos_before ? request.photos_before.split(',') : [];
    request.photos_after = request.photos_after ? request.photos_after.split(',') : [];
    
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
    request.participants = [];
    request.contributors = [];
    request.contributions = {};
    request.donations = [];

    // Отправка push-уведомлений пользователям рядом (асинхронно, не блокируем ответ)
    if (latitude && longitude) {
      sendRequestCreatedNotification({
        id: requestId,
        category,
        name,
        created_by: userId,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        photos: finalPhotos,
      }).catch(err => {
        console.error('❌ Ошибка отправки push-уведомлений при создании заявки:', err);
        // Не прерываем выполнение, просто логируем ошибку
      });
    }

    success(res, { request }, 'Заявка создана', 201);
  } catch (err) {
    console.error('Ошибка создания заявки:', err);
    // Передаем ошибку дальше для детальной обработки
    next(err);
  }
});

/**
 * PUT /api/requests/:id
 * Обновление заявки
 */
router.put('/:id', authenticate, async (req, res) => {
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

    // Только создатель или админ может обновлять
    if (existingRequests[0].created_by !== userId && !req.user.isAdmin) {
      return error(res, 'Доступ запрещен', 403);
    }

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
      waste_types
    } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (latitude !== undefined) {
      updates.push('latitude = ?');
      params.push(latitude);
    }
    if (longitude !== undefined) {
      updates.push('longitude = ?');
      params.push(longitude);
    }
    if (city !== undefined) {
      updates.push('city = ?');
      params.push(city);
    }
    if (garbage_size !== undefined) {
      updates.push('garbage_size = ?');
      params.push(garbage_size);
    }
    if (only_foot !== undefined) {
      updates.push('only_foot = ?');
      params.push(only_foot);
    }
    if (possible_by_car !== undefined) {
      updates.push('possible_by_car = ?');
      params.push(possible_by_car);
    }
    if (cost !== undefined) {
      updates.push('cost = ?');
      params.push(cost);
    }
    if (reward_amount !== undefined) {
      updates.push('reward_amount = ?');
      params.push(reward_amount);
    }
    if (start_date !== undefined) {
      updates.push('start_date = ?');
      params.push(start_date);
    }
    if (end_date !== undefined) {
      updates.push('end_date = ?');
      params.push(end_date);
    }
    // Проверка изменения статуса на approved для speedCleanup
    let shouldAwardCoins = false;
    // Проверка изменения статуса на completed для всех категорий кроме speedCleanup
    let shouldAwardCoinsForCompleted = false;
    let requestCategory = null;
    let requestCreatedBy = null;
    let requestRewardAmount = null;
    let oldStatus = null;

    if (status !== undefined) {
      // Получаем текущие данные заявки перед обновлением
      const [currentRequest] = await pool.execute(
        'SELECT category, status, created_by, reward_amount FROM requests WHERE id = ?',
        [id]
      );

      if (currentRequest.length > 0) {
        requestCategory = currentRequest[0].category;
        oldStatus = currentRequest[0].status;
        requestCreatedBy = currentRequest[0].created_by;
        requestRewardAmount = currentRequest[0].reward_amount;

        // Проверяем, меняется ли статус на approved для speedCleanup
        if (status === 'approved' && oldStatus !== 'approved' && requestCategory === 'speedCleanup') {
          shouldAwardCoins = true;
          // Автоматически переводим в completed после одобрения
          status = 'completed';
        }

        // Проверяем, меняется ли статус на completed для всех категорий кроме speedCleanup
        if (status === 'completed' && oldStatus !== 'completed' && requestCategory !== 'speedCleanup') {
          shouldAwardCoinsForCompleted = true;
        }
      }

      updates.push('status = ?');
      params.push(status);
    }
    if (priority !== undefined) {
      updates.push('priority = ?');
      params.push(priority);
    }
    if (is_open !== undefined) {
      updates.push('is_open = ?');
      params.push(is_open);
    }
    if (target_amount !== undefined) {
      updates.push('target_amount = ?');
      params.push(target_amount);
    }
    if (plant_tree !== undefined) {
      updates.push('plant_tree = ?');
      params.push(plant_tree);
    }
    if (trash_pickup_only !== undefined) {
      updates.push('trash_pickup_only = ?');
      params.push(trash_pickup_only);
    }
    if (completion_comment !== undefined) {
      updates.push('completion_comment = ?');
      params.push(completion_comment);
    }
    if (waste_types !== undefined) {
      updates.push('waste_types = ?');
      params.push(Array.isArray(waste_types) ? JSON.stringify(waste_types) : null);
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

    // Начисление коинов при одобрении speedCleanup заявки
    if (shouldAwardCoins && requestCreatedBy) {
      try {
        const coinsToAward = 1; // Всем по 1 коину

        // Начисляем коины создателю
        await pool.execute(
          'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_created = COALESCE(coins_from_created, 0) + ?, updated_at = NOW() WHERE id = ?',
          [coinsToAward, coinsToAward, requestCreatedBy]
        );
        console.log(`✅ Начислено ${coinsToAward} коин создателю заявки ${id}`);

        // Получаем всех донатеров для этой заявки
        const [donations] = await pool.execute(
          'SELECT DISTINCT user_id, SUM(amount) as total_amount FROM donations WHERE request_id = ? GROUP BY user_id',
          [id]
        );

        // Начисляем коины донатерам (по 1 коину каждому)
        if (donations.length > 0) {
          for (const donation of donations) {
            if (donation.user_id && donation.user_id !== requestCreatedBy) {
              await pool.execute(
                'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
                [coinsToAward, coinsToAward, donation.user_id]
              );
              console.log(`✅ Начислено ${coinsToAward} коин донатеру ${donation.user_id} за заявку ${id}`);
            }
          }
        }
      } catch (coinError) {
        console.error('❌ Ошибка начисления коинов при одобрении заявки:', coinError);
        // Не прерываем выполнение, только логируем ошибку
      }
    }

    // Начисление коинов при завершении заявки (completed) для всех категорий кроме speedCleanup
    if (shouldAwardCoinsForCompleted && requestCreatedBy) {
      try {
        const coinsToAward = 1; // Всем по 1 коину

        // Начисляем коины создателю
        await pool.execute(
          'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_created = COALESCE(coins_from_created, 0) + ?, updated_at = NOW() WHERE id = ?',
          [coinsToAward, coinsToAward, requestCreatedBy]
        );
        console.log(`✅ Начислено ${coinsToAward} коин создателю заявки ${id} (completed)`);

        // Получаем всех донатеров для этой заявки
        const [donations] = await pool.execute(
          'SELECT DISTINCT user_id, SUM(amount) as total_amount FROM donations WHERE request_id = ? GROUP BY user_id',
          [id]
        );

        // Начисляем коины донатерам (по 1 коину каждому)
        const awardedUserIds = new Set([requestCreatedBy]); // Чтобы не начислять дважды
        if (donations.length > 0) {
          for (const donation of donations) {
            if (donation.user_id && !awardedUserIds.has(donation.user_id)) {
              await pool.execute(
                'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
                [coinsToAward, coinsToAward, donation.user_id]
              );
              awardedUserIds.add(donation.user_id);
              console.log(`✅ Начислено ${coinsToAward} коин донатеру ${donation.user_id} за заявку ${id} (completed)`);
            }
          }
        }

        // Получаем участников в зависимости от типа заявки
        if (requestCategory === 'wasteLocation') {
          // Для wasteLocation - получаем joined_user_id
          const [joinedUser] = await pool.execute(
            'SELECT joined_user_id FROM requests WHERE id = ? AND joined_user_id IS NOT NULL',
            [id]
          );
          if (joinedUser.length > 0 && joinedUser[0].joined_user_id && !awardedUserIds.has(joinedUser[0].joined_user_id)) {
            await pool.execute(
              'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
              [coinsToAward, coinsToAward, joinedUser[0].joined_user_id]
            );
            awardedUserIds.add(joinedUser[0].joined_user_id);
            console.log(`✅ Начислено ${coinsToAward} коин присоединившемуся пользователю ${joinedUser[0].joined_user_id} за заявку ${id} (completed)`);
          }
        } else if (requestCategory === 'event') {
          // Для event - получаем всех участников из request_participants
          const [participants] = await pool.execute(
            'SELECT user_id FROM request_participants WHERE request_id = ?',
            [id]
          );
          for (const participant of participants) {
            if (participant.user_id && !awardedUserIds.has(participant.user_id)) {
              await pool.execute(
                'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
                [coinsToAward, coinsToAward, participant.user_id]
              );
              awardedUserIds.add(participant.user_id);
              console.log(`✅ Начислено ${coinsToAward} коин участнику ${participant.user_id} за заявку ${id} (completed)`);
            }
          }
        }
      } catch (coinError) {
        console.error('❌ Ошибка начисления коинов при завершении заявки:', coinError);
        // Не прерываем выполнение, только логируем ошибку
      }
    }

    // Получение обновленной заявки
    const [requests] = await pool.execute(
      `SELECT r.*,
       GROUP_CONCAT(DISTINCT rp.photo_url ORDER BY rp.photo_type, rp.created_at) as photos,
       GROUP_CONCAT(DISTINCT rpb.photo_url ORDER BY rpb.created_at) as photos_before,
       GROUP_CONCAT(DISTINCT rpa.photo_url ORDER BY rpa.created_at) as photos_after
      FROM requests r
      LEFT JOIN request_photos rp ON r.id = rp.request_id AND rp.photo_type = 'photo'
      LEFT JOIN request_photos rpb ON r.id = rpb.request_id AND rpb.photo_type = 'photo_before'
      LEFT JOIN request_photos rpa ON r.id = rpa.request_id AND rpa.photo_type = 'photo_after'
      WHERE r.id = ?
      GROUP BY r.id`,
      [id]
    );

    const request = requests[0];
    request.photos = request.photos ? request.photos.split(',') : [];
    request.photos_before = request.photos_before ? request.photos_before.split(',') : [];
    request.photos_after = request.photos_after ? request.photos_after.split(',') : [];
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

    success(res, { request }, 'Заявка обновлена');
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

    // Присоединение
    await pool.execute(
      'UPDATE requests SET joined_user_id = ?, join_date = NOW(), updated_at = NOW() WHERE id = ?',
      [userId, id]
    );

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

    // Проверка, не участвует ли уже
    const [existing] = await pool.execute(
      'SELECT id FROM request_participants WHERE request_id = ? AND user_id = ?',
      [id, userId]
    );

    if (existing.length > 0) {
      return error(res, 'Вы уже участвуете в этом событии', 409);
    }

    // Добавление участника
    await pool.execute(
      'INSERT INTO request_participants (id, request_id, user_id) VALUES (?, ?, ?)',
      [generateId(), id, userId]
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

    await pool.execute(
      'DELETE FROM request_participants WHERE request_id = ? AND user_id = ?',
      [id, userId]
    );

    success(res, null, 'Вы отменили участие в событии');
  } catch (err) {
    console.error('Ошибка отмены участия:', err);
    error(res, 'Ошибка при отмене участия', 500, err);
  }
});

module.exports = router;

