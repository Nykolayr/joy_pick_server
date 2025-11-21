const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');

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

    const offset = (page - 1) * limit;
    let query = `
      SELECT r.*,
       GROUP_CONCAT(DISTINCT rp.photo_url ORDER BY rp.photo_type, rp.created_at) as photos,
       GROUP_CONCAT(DISTINCT rpb.photo_url ORDER BY rpb.created_at) as photos_before,
       GROUP_CONCAT(DISTINCT rpa.photo_url ORDER BY rpa.created_at) as photos_after,
       GROUP_CONCAT(DISTINCT rwt.waste_type) as waste_types
      FROM requests r
      LEFT JOIN request_photos rp ON r.id = rp.request_id AND rp.photo_type = 'photo'
      LEFT JOIN request_photos rpb ON r.id = rpb.request_id AND rpb.photo_type = 'photo_before'
      LEFT JOIN request_photos rpa ON r.id = rpa.request_id AND rpa.photo_type = 'photo_after'
      LEFT JOIN request_waste_types rwt ON r.id = rwt.request_id
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

    query += ' GROUP BY r.id ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [requests] = await pool.execute(query, params);

    // Обработка результатов
    const processedRequests = requests.map(request => {
      const result = Object.assign({}, request);
      
      // Преобразование фотографий
      result.photos = request.photos ? request.photos.split(',') : [];
      result.photos_before = request.photos_before ? request.photos_before.split(',') : [];
      result.photos_after = request.photos_after ? request.photos_after.split(',') : [];
      result.waste_types = request.waste_types ? request.waste_types.split(',') : [];
      
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
    
    if (conditions.length > 0) {
      // Убираем условие радиуса для подсчета
      const countConditions = conditions.filter((c, i) => {
        const paramIndex = Math.floor(i / 2);
        return !c.includes('6371000');
      });
      
      if (countConditions.length > 0) {
        countQuery += ' WHERE ' + countConditions.join(' AND ');
        // Добавляем параметры без радиуса
        params.slice(0, -2).forEach((p, i) => {
          if (!conditions[i].includes('6371000')) {
            countParams.push(p);
          }
        });
      }
    }
    
    const [countResult] = await pool.execute(countQuery, countParams.length > 0 ? countParams : []);
    const total = countResult[0].total;

    success(res, {
      requests: processedRequests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Ошибка получения заявок:', err);
    error(res, 'Ошибка при получении списка заявок', 500);
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
       GROUP_CONCAT(DISTINCT rpa.photo_url ORDER BY rpa.created_at) as photos_after,
       GROUP_CONCAT(DISTINCT rwt.waste_type) as waste_types
      FROM requests r
      LEFT JOIN request_photos rp ON r.id = rp.request_id AND rp.photo_type = 'photo'
      LEFT JOIN request_photos rpb ON r.id = rpb.request_id AND rpb.photo_type = 'photo_before'
      LEFT JOIN request_photos rpa ON r.id = rpa.request_id AND rpa.photo_type = 'photo_after'
      LEFT JOIN request_waste_types rwt ON r.id = rwt.request_id
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
    request.waste_types = request.waste_types ? request.waste_types.split(',') : [];
    request.only_foot = Boolean(request.only_foot);
    request.possible_by_car = Boolean(request.possible_by_car);
    request.is_open = Boolean(request.is_open);
    request.plant_tree = Boolean(request.plant_tree);
    request.trash_pickup_only = Boolean(request.trash_pickup_only);

    success(res, { request });
  } catch (err) {
    console.error('Ошибка получения заявки:', err);
    error(res, 'Ошибка при получении заявки', 500);
  }
});

/**
 * POST /api/requests
 * Создание новой заявки
 */
router.post('/', authenticate, [
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

    const {
      category,
      name,
      description,
      latitude,
      longitude,
      city,
      garbageSize,
      onlyFoot = false,
      possibleByCar = false,
      cost,
      rewardAmount,
      startDate,
      endDate,
      status = 'pending',
      priority = 'medium',
      wasteTypes = [],
      photos = [],
      photosBefore = [],
      photosAfter = [],
      targetAmount,
      plantTree = false,
      trashPickupOnly = false
    } = req.body;

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
        garbageSize || null,
        onlyFoot,
        possibleByCar,
        cost || null,
        rewardAmount || null,
        startDate || null,
        endDate || null,
        status,
        priority,
        userId, // created_by использует тот же userId
        targetAmount || null,
        plantTree,
        trashPickupOnly
      ]
    );

    // Добавление фотографий
    if (photos.length > 0) {
      for (const photoUrl of photos) {
        await pool.execute(
          'INSERT INTO request_photos (id, request_id, photo_url, photo_type) VALUES (?, ?, ?, ?)',
          [generateId(), requestId, photoUrl, 'photo']
        );
      }
    }

    if (photosBefore.length > 0) {
      for (const photoUrl of photosBefore) {
        await pool.execute(
          'INSERT INTO request_photos (id, request_id, photo_url, photo_type) VALUES (?, ?, ?, ?)',
          [generateId(), requestId, photoUrl, 'photo_before']
        );
      }
    }

    if (photosAfter.length > 0) {
      for (const photoUrl of photosAfter) {
        await pool.execute(
          'INSERT INTO request_photos (id, request_id, photo_url, photo_type) VALUES (?, ?, ?, ?)',
          [generateId(), requestId, photoUrl, 'photo_after']
        );
      }
    }

    // Добавление типов отходов
    if (wasteTypes.length > 0) {
      for (const wasteType of wasteTypes) {
        await pool.execute(
          'INSERT INTO request_waste_types (id, request_id, waste_type) VALUES (?, ?, ?)',
          [generateId(), requestId, wasteType]
        );
      }
    }

    // Получение созданной заявки
    const [requests] = await pool.execute(
      `SELECT r.*,
       GROUP_CONCAT(DISTINCT rp.photo_url ORDER BY rp.photo_type, rp.created_at) as photos,
       GROUP_CONCAT(DISTINCT rpb.photo_url ORDER BY rpb.created_at) as photos_before,
       GROUP_CONCAT(DISTINCT rpa.photo_url ORDER BY rpa.created_at) as photos_after,
       GROUP_CONCAT(DISTINCT rwt.waste_type) as waste_types
      FROM requests r
      LEFT JOIN request_photos rp ON r.id = rp.request_id AND rp.photo_type = 'photo'
      LEFT JOIN request_photos rpb ON r.id = rpb.request_id AND rpb.photo_type = 'photo_before'
      LEFT JOIN request_photos rpa ON r.id = rpa.request_id AND rpa.photo_type = 'photo_after'
      LEFT JOIN request_waste_types rwt ON r.id = rwt.request_id
      WHERE r.id = ?
      GROUP BY r.id`,
      [requestId]
    );

    const request = requests[0];
    request.photos = request.photos ? request.photos.split(',') : [];
    request.photos_before = request.photos_before ? request.photos_before.split(',') : [];
    request.photos_after = request.photos_after ? request.photos_after.split(',') : [];
    request.waste_types = request.waste_types ? request.waste_types.split(',') : [];
    request.participants = [];
    request.contributors = [];
    request.contributions = {};
    request.donations = [];

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
      garbageSize,
      onlyFoot,
      possibleByCar,
      cost,
      rewardAmount,
      startDate,
      endDate,
      status,
      priority,
      isOpen,
      targetAmount,
      plantTree,
      trashPickupOnly,
      completionComment
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
    if (garbageSize !== undefined) {
      updates.push('garbage_size = ?');
      params.push(garbageSize);
    }
    if (onlyFoot !== undefined) {
      updates.push('only_foot = ?');
      params.push(onlyFoot);
    }
    if (possibleByCar !== undefined) {
      updates.push('possible_by_car = ?');
      params.push(possibleByCar);
    }
    if (cost !== undefined) {
      updates.push('cost = ?');
      params.push(cost);
    }
    if (rewardAmount !== undefined) {
      updates.push('reward_amount = ?');
      params.push(rewardAmount);
    }
    if (startDate !== undefined) {
      updates.push('start_date = ?');
      params.push(startDate);
    }
    if (endDate !== undefined) {
      updates.push('end_date = ?');
      params.push(endDate);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    if (priority !== undefined) {
      updates.push('priority = ?');
      params.push(priority);
    }
    if (isOpen !== undefined) {
      updates.push('is_open = ?');
      params.push(isOpen);
    }
    if (targetAmount !== undefined) {
      updates.push('target_amount = ?');
      params.push(targetAmount);
    }
    if (plantTree !== undefined) {
      updates.push('plant_tree = ?');
      params.push(plantTree);
    }
    if (trashPickupOnly !== undefined) {
      updates.push('trash_pickup_only = ?');
      params.push(trashPickupOnly);
    }
    if (completionComment !== undefined) {
      updates.push('completion_comment = ?');
      params.push(completionComment);
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

    // Получение обновленной заявки
    const [requests] = await pool.execute(
      `SELECT r.*,
       GROUP_CONCAT(DISTINCT rp.photo_url ORDER BY rp.photo_type, rp.created_at) as photos,
       GROUP_CONCAT(DISTINCT rpb.photo_url ORDER BY rpb.created_at) as photos_before,
       GROUP_CONCAT(DISTINCT rpa.photo_url ORDER BY rpa.created_at) as photos_after,
       GROUP_CONCAT(DISTINCT rwt.waste_type) as waste_types
      FROM requests r
      LEFT JOIN request_photos rp ON r.id = rp.request_id AND rp.photo_type = 'photo'
      LEFT JOIN request_photos rpb ON r.id = rpb.request_id AND rpb.photo_type = 'photo_before'
      LEFT JOIN request_photos rpa ON r.id = rpa.request_id AND rpa.photo_type = 'photo_after'
      LEFT JOIN request_waste_types rwt ON r.id = rwt.request_id
      WHERE r.id = ?
      GROUP BY r.id`,
      [id]
    );

    const request = requests[0];
    request.photos = request.photos ? request.photos.split(',') : [];
    request.photos_before = request.photos_before ? request.photos_before.split(',') : [];
    request.photos_after = request.photos_after ? request.photos_after.split(',') : [];
    request.waste_types = request.waste_types ? request.waste_types.split(',') : [];

    success(res, { request }, 'Заявка обновлена');
  } catch (err) {
    console.error('Ошибка обновления заявки:', err);
    error(res, 'Ошибка при обновлении заявки', 500);
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
    error(res, 'Ошибка при удалении заявки', 500);
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
      'SELECT category, joined_user_id, join_date FROM requests WHERE id = ?',
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

    success(res, null, 'Вы присоединились к заявке');
  } catch (err) {
    console.error('Ошибка присоединения к заявке:', err);
    error(res, 'Ошибка при присоединении к заявке', 500);
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
      'SELECT category FROM requests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    if (requests[0].category !== 'event') {
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

    success(res, null, 'Вы присоединились к событию');
  } catch (err) {
    console.error('Ошибка участия в событии:', err);
    error(res, 'Ошибка при участии в событии', 500);
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
    error(res, 'Ошибка при отмене участия', 500);
  }
});

module.exports = router;

