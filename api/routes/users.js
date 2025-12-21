const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { uploadUserAvatar, getFileUrlFromPath } = require('../middleware/upload');

const router = express.Router();

/**
 * GET /api/users
 * Получение списка пользователей (только для админов)
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    
    // Валидация и преобразование параметров пагинации
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20)); // Максимум 100 на странице
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT id, email, display_name, photo_url, uid, phone_number, city,
       first_name, second_name, country, gender, count_performed, count_orders,
       jcoins, coins_from_created, coins_from_participation, stripe_id, score,
       admin, fcm_token, auth_type, latitude, longitude, created_time
       FROM users
    `;
    const params = [];

    if (search) {
      query += ` WHERE email LIKE ? OR display_name LIKE ? OR first_name LIKE ? OR second_name LIKE ?`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Используем прямой ввод чисел для LIMIT и OFFSET (безопасно, так как значения валидированы)
    query += ` ORDER BY created_time DESC LIMIT ${limitNum} OFFSET ${offset}`;

    const [users] = await pool.execute(query, params);

    // Получение общего количества
    let countQuery = 'SELECT COUNT(*) as total FROM users';
    const countParams = [];
    if (search) {
      countQuery += ` WHERE email LIKE ? OR display_name LIKE ? OR first_name LIKE ? OR second_name LIKE ?`;
      const searchPattern = `%${search}%`;
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    success(res, {
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error('Ошибка получения пользователей:', err);
    error(res, 'Ошибка при получении списка пользователей', 500, err);
  }
});

/**
 * GET /api/users/all
 * Получение всех пользователей сразу списком (без пагинации, только для админов)
 */
router.get('/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const { search = '' } = req.query;

    let query = `
      SELECT id, email, display_name, photo_url, uid, phone_number, city,
       first_name, second_name, country, gender, count_performed, count_orders,
       jcoins, coins_from_created, coins_from_participation, stripe_id, score,
       admin, fcm_token, auth_type, latitude, longitude, created_time
       FROM users
    `;
    const params = [];

    if (search) {
      query += ` WHERE email LIKE ? OR display_name LIKE ? OR first_name LIKE ? OR second_name LIKE ?`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    query += ` ORDER BY created_time DESC`;

    const [users] = await pool.execute(query, params);

    success(res, { users, total: users.length });
  } catch (err) {
    error(res, 'Ошибка при получении списка всех пользователей', 500, err);
  }
});

/**
 * GET /api/users/:id
 * Получение данных пользователя по ID
 * Любой авторизованный пользователь может получить данные другого пользователя
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.userId;
    const isAdmin = req.user.isAdmin;
    const isOwnProfile = currentUserId === id;

    const [users] = await pool.execute(
      `SELECT id, email, display_name, photo_url, uid, phone_number, city,
       first_name, second_name, country, gender, count_performed, count_orders,
       jcoins, coins_from_created, coins_from_participation, stripe_id, score,
       admin, fcm_token, auth_type, latitude, longitude, created_time
       FROM users WHERE id = ?`,
      [id]
    );

    if (users.length === 0) {
      return error(res, 'Пользователь не найден', 404);
    }

    const user = users[0];

    // Если пользователь запрашивает не свой профиль и не админ, скрываем чувствительные данные
    if (!isOwnProfile && !isAdmin) {
      // Удаляем чувствительные поля
      delete user.fcm_token;
      delete user.admin;
      delete user.stripe_id;
      // Можно также скрыть email и phone_number, если нужно
      // delete user.email;
      // delete user.phone_number;
    }

    success(res, { user });
  } catch (err) {
    console.error('Ошибка получения пользователя:', err);
    error(res, 'Ошибка при получении данных пользователя', 500, err);
  }
});

/**
 * PUT /api/users/:id
 * Обновление данных пользователя
 * Поддерживает загрузку аватара через multipart/form-data:
 * - photo: файл аватара пользователя
 * 
 * Также поддерживает отправку photoUrl через JSON (для обратной совместимости)
 */
router.put('/:id', authenticate, uploadUserAvatar, [
  body('display_name').optional().isString(),
  body('first_name').optional().isString(),
  body('second_name').optional().isString(),
  body('phone_number').optional().isString(),
  body('city').optional().isString(),
  body('country').optional().isString(),
  body('gender').optional().isString(),
  body('photo_url').optional().isURL(),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('fcm_token').optional().isString()
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { id } = req.params;

    // Пользователь может обновлять только свои данные, если он не админ
    if (req.user.userId !== id && !req.user.isAdmin) {
      return error(res, 'Доступ запрещен', 403);
    }

    // Обработка загруженного файла аватара
    let finalPhotoUrl = null;
    if (req.file) {
      finalPhotoUrl = getFileUrlFromPath(req.file.path);
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
      display_name,
      first_name,
      second_name,
      phone_number,
      city,
      country,
      gender,
      photo_url,
      latitude,
      longitude,
      fcm_token
    } = bodyData;

    // Используем загруженный файл, если есть, иначе используем photo_url из JSON
    const photoUrlToUse = finalPhotoUrl || photo_url;

    // Проверка существования пользователя
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      return error(res, 'Пользователь не найден', 404);
    }

    // Формирование запроса обновления
    const updates = [];
    const params = [];

    if (display_name !== undefined) {
      updates.push('display_name = ?');
      params.push(display_name);
    }
    if (first_name !== undefined) {
      updates.push('first_name = ?');
      params.push(first_name);
    }
    if (second_name !== undefined) {
      updates.push('second_name = ?');
      params.push(second_name);
    }
    if (phone_number !== undefined) {
      updates.push('phone_number = ?');
      params.push(phone_number);
    }
    if (city !== undefined) {
      updates.push('city = ?');
      params.push(city);
    }
    if (country !== undefined) {
      updates.push('country = ?');
      params.push(country);
    }
    if (gender !== undefined) {
      updates.push('gender = ?');
      params.push(gender);
    }
    if (photoUrlToUse !== undefined && photoUrlToUse !== null) {
      updates.push('photo_url = ?');
      params.push(photoUrlToUse);
    }
    if (latitude !== undefined) {
      updates.push('latitude = ?');
      params.push(latitude);
    }
    if (longitude !== undefined) {
      updates.push('longitude = ?');
      params.push(longitude);
    }
    if (fcm_token !== undefined) {
      updates.push('fcm_token = ?');
      params.push(fcm_token);
    }

    if (updates.length === 0) {
      return error(res, 'Нет данных для обновления', 400);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await pool.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Получение обновленных данных
    const [users] = await pool.execute(
      `SELECT id, email, display_name, photo_url, uid, phone_number, city,
       first_name, second_name, country, gender, count_performed, count_orders,
       jcoins, coins_from_created, coins_from_participation, stripe_id, score,
       admin, fcm_token, auth_type, latitude, longitude, created_time
       FROM users WHERE id = ?`,
      [id]
    );

    success(res, { user: users[0] }, 'Данные пользователя обновлены');
  } catch (err) {
    console.error('Ошибка обновления пользователя:', err);
    error(res, 'Ошибка при обновлении данных пользователя', 500, err);
  }
});

/**
 * PUT /api/users/:id/jcoins
 * Обновление количества Joycoins (только для админов)
 */
router.put('/:id/jcoins', authenticate, requireAdmin, [
  body('jcoins').isInt().withMessage('jcoins должен быть числом'),
  body('operation').optional().isIn(['set', 'add', 'subtract']).withMessage('Операция должна быть set, add или subtract')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { id } = req.params;
    const { jcoins, operation = 'set' } = req.body;

    // Проверка существования пользователя
    const [existingUsers] = await pool.execute(
      'SELECT jcoins FROM users WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      return error(res, 'Пользователь не найден', 404);
    }

    const currentJcoins = existingUsers[0].jcoins || 0;
    let newJcoins;

    switch (operation) {
      case 'add':
        newJcoins = currentJcoins + jcoins;
        break;
      case 'subtract':
        newJcoins = Math.max(0, currentJcoins - jcoins);
        break;
      case 'set':
      default:
        newJcoins = jcoins;
        break;
    }

    await pool.execute(
      'UPDATE users SET jcoins = ?, updated_at = NOW() WHERE id = ?',
      [newJcoins, id]
    );

    success(res, { jcoins: newJcoins }, 'Joycoins обновлены');
  } catch (err) {
    console.error('Ошибка обновления Joycoins:', err);
    error(res, 'Ошибка при обновлении Joycoins', 500, err);
  }
});

/**
 * DELETE /api/users/:id
 * Удаление пользователя (только для админов)
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Проверка существования пользователя
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      return error(res, 'Пользователь не найден', 404);
    }

    await pool.execute('DELETE FROM users WHERE id = ?', [id]);

    success(res, null, 'Пользователь удален');
  } catch (err) {
    console.error('Ошибка удаления пользователя:', err);
    error(res, 'Ошибка при удалении пользователя', 500, err);
  }
});

module.exports = router;

