const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { uploadUserAvatar, getFileUrlFromPath } = require('../middleware/upload');
const stripeRouter = require('./stripe.js');
const { getCreditedWorkDurationItemsForUser } = require('../utils/workDurationStats');
const { normalizeDatesInObject } = require('../utils/datetime');
const {
  PAYOUT_RAILS,
  normalizeManualPayoutDetailsInput,
  buildPayoutProfileSummary,
  inferPayoutRail,
} = require('../services/donationRailResolver');

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
       admin, super_admin, fcm_token, auth_type, latitude, longitude, created_time,
       about, social_links, lang
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
    error(res, 'Error fetching users list', 500, err);
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
       admin, super_admin, fcm_token, auth_type, latitude, longitude, created_time,
       about, social_links, lang
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
    error(res, 'Error fetching all users list', 500, err);
  }
});

/**
 * GET /api/users/me/work-duration
 * Список заявок с засчитанными work_duration_minutes и общая сумма (только approved/archived по правилам бэка).
 * Query: page, limit (по умолчанию 1 и 20, макс. limit 100).
 */
router.get('/me/work-duration', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const allItems = await getCreditedWorkDurationItemsForUser(pool, userId);
    const total = allItems.length;
    const totalWorkDurationMinutes = allItems.reduce((s, it) => s + it.work_duration_minutes, 0);
    const offset = (pageNum - 1) * limitNum;
    const pageItems = allItems.slice(offset, offset + limitNum).map((it) => normalizeDatesInObject(it));
    success(res, {
      items: pageItems,
      total_work_duration_minutes: totalWorkDurationMinutes,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 0
      }
    });
  } catch (err) {
    console.error('Ошибка work-duration:', err);
    error(res, 'Error fetching work duration summary', 500, err);
  }
});

/**
 * GET /api/users/:id
 * Получение данных пользователя по ID.
 * При наличии Stripe-аккаунта у запрашиваемого пользователя статус обновляется из Stripe API.
 * Любой авторизованный пользователь может получить данные другого пользователя
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.userId;
    const isAdmin = req.user.isAdmin;
    const isOwnProfile = currentUserId === id;

    await stripeRouter.refreshUserStripeStatusIfNeeded(id);

    const [users] = await pool.execute(
      `SELECT id, email, display_name, photo_url, uid, phone_number, city,
       first_name, second_name, country, gender, count_performed, count_orders,
       jcoins, coins_from_created, coins_from_participation, stripe_id, score,
       admin, super_admin, fcm_token, auth_type, latitude, longitude, created_time,
       about, social_links, lang,
       stripe_account_status, stripe_status_label, can_donate, can_receive_payouts, stripe_status_updated_at,
       payout_rail, manual_payout_details, manual_payout_verified_at
       FROM users WHERE id = ?`,
      [id]
    );

    if (users.length === 0) {
      return error(res, 'User not found', 404);
    }

    const user = users[0];
    const [sumRows] = await pool.execute(
      'SELECT COALESCE(SUM(coins_spent), 0) AS total FROM partner_coin_redemptions WHERE user_id = ?',
      [id]
    );
    user.jcoins_spent = Number(sumRows[0]?.total ?? 0);

    // Парсим social_links из JSON если это строка
    if (user.social_links) {
      try {
        user.social_links = typeof user.social_links === 'string' 
          ? JSON.parse(user.social_links) 
          : user.social_links;
      } catch (e) {
        user.social_links = [];
      }
    } else {
      user.social_links = [];
    }

    if (user.manual_payout_details && typeof user.manual_payout_details === 'string') {
      try {
        user.manual_payout_details = JSON.parse(user.manual_payout_details);
      } catch {
        user.manual_payout_details = { instructions: String(user.manual_payout_details) };
      }
    }

    const [stripeAccountRows] = await pool.execute(
      'SELECT user_id FROM stripe_accounts WHERE user_id = ? LIMIT 1',
      [id]
    );
    user.payout_profile = buildPayoutProfileSummary(user, {
      hasStripeAccount: stripeAccountRows.length > 0,
    });

    if (!isOwnProfile && !isAdmin) {
      delete user.manual_payout_details;
      delete user.manual_payout_verified_at;
      delete user.payout_rail;
    }

    // Если пользователь запрашивает не свой профиль и не админ, скрываем чувствительные данные
    if (!isOwnProfile && !isAdmin) {
      // Удаляем чувствительные поля
      delete user.fcm_token;
      delete user.admin;
      delete user.super_admin;
      delete user.stripe_id;
      // Можно также скрыть email и phone_number, если нужно
      // delete user.email;
      // delete user.phone_number;
    }

    success(res, { user });
  } catch (err) {
    console.error('Ошибка получения пользователя:', err);
    error(res, 'Error fetching user data', 500, err);
  }
});

/**
 * PUT /api/users/:id/payout-profile
 * Настройка рельса выплат (stripe | manual).
 */
router.put('/:id/payout-profile', authenticate, [
  body('payout_rail').optional().isIn(['stripe', 'manual', 'crypto', 'psp']),
  body('manual_payout_details').optional(),
  body('clear_manual_payout_details').optional().isBoolean(),
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }

    const { id } = req.params;
    if (req.user.userId !== id && !req.user.isAdmin) {
      return error(res, 'Access denied', 403);
    }

    const { payout_rail, manual_payout_details, clear_manual_payout_details } = req.body;

    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );
    if (existingUsers.length === 0) {
      return error(res, 'User not found', 404);
    }

    const updates = [];
    const params = [];

    if (payout_rail !== undefined) {
      updates.push('payout_rail = ?');
      params.push(String(payout_rail).toLowerCase());
    }

    if (clear_manual_payout_details === true) {
      updates.push('manual_payout_details = NULL');
      updates.push('manual_payout_verified_at = NULL');
    } else if (manual_payout_details !== undefined) {
      const normalized = normalizeManualPayoutDetailsInput(manual_payout_details);
      if (!normalized) {
        return error(res, 'manual_payout_details must contain instructions', 400);
      }
      updates.push('manual_payout_details = ?');
      params.push(JSON.stringify(normalized));
      updates.push('manual_payout_verified_at = NULL');
      if (payout_rail === undefined) {
        updates.push('payout_rail = ?');
        params.push(PAYOUT_RAILS.MANUAL);
      }
    }

    if (payout_rail === PAYOUT_RAILS.STRIPE && manual_payout_details === undefined && clear_manual_payout_details !== true) {
      // stripe primary — manual details optional, not cleared automatically
    }

    if (updates.length === 0) {
      return error(res, 'No payout profile fields to update', 400);
    }

    updates.push('updated_at = NOW()');
    params.push(id);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const [users] = await pool.execute(
      `SELECT id, payout_rail, manual_payout_details, manual_payout_verified_at,
              stripe_account_status, can_receive_payouts
       FROM users WHERE id = ?`,
      [id]
    );
    const user = users[0];
    if (user.manual_payout_details && typeof user.manual_payout_details === 'string') {
      try {
        user.manual_payout_details = JSON.parse(user.manual_payout_details);
      } catch {
        user.manual_payout_details = { instructions: String(user.manual_payout_details) };
      }
    }
    const [stripeAccountRows] = await pool.execute(
      'SELECT user_id FROM stripe_accounts WHERE user_id = ? LIMIT 1',
      [id]
    );
    const payout_profile = buildPayoutProfileSummary(user, {
      hasStripeAccount: stripeAccountRows.length > 0,
    });

    success(res, {
      payout_profile,
      manual_payout_details: user.manual_payout_details || null,
      payout_rail: inferPayoutRail(user, { hasStripeAccount: stripeAccountRows.length > 0 }),
    }, 'Payout profile updated');
  } catch (err) {
    console.error('payout-profile update:', err);
    error(res, 'Error updating payout profile', 500, err);
  }
});

/**
 * PUT /api/users/:id
 * Обновление данных пользователя
 * Поддерживает загрузку аватара через multipart/form-data:
 * - photo: файл аватара пользователя
 * 
 * Также поддерживает отправку photoUrl через JSON (для обратной совместимости).
 * Multer подключаем только для multipart, чтобы при JSON (например только { lang }) req.body не терялся.
 */
router.put('/:id', authenticate, (req, res, next) => {
  const isMultipart = req.is('multipart/form-data');
  if (isMultipart) {
    return uploadUserAvatar(req, res, next);
  }
  next();
}, [
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
  body('fcm_token').optional().isString(),
  body('admin').optional().isBoolean(),
  body('super_admin').optional().isBoolean(),
  body('about').optional().isString(),
  body('social_links').optional().isArray(),
  body('lang').optional().isString().isLength({ max: 10 })
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }

    const { id } = req.params;

    // Пользователь может обновлять только свои данные, если он не админ
    if (req.user.userId !== id && !req.user.isAdmin) {
      return error(res, 'Access denied', 403);
    }

    // Обработка загруженного файла аватара
    let finalPhotoUrl = null;
    if (req.file) {
      finalPhotoUrl = getFileUrlFromPath(req.file.path);
    }

    // Парсим JSON данные (если отправлены как JSON). Для JSON-only запросов req.body уже заполнен express.json().
    let bodyData = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (typeof req.body === 'string') {
      try {
        bodyData = JSON.parse(req.body);
      } catch (e) {
        bodyData = {};
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
      fcm_token,
      admin,
      super_admin,
      about,
      social_links,
      lang: langFromBody
    } = bodyData;
    // Явно берём lang из bodyData или req.body (на случай если клиент шлёт только { lang } и body парсится по-разному)
    const lang = langFromBody !== undefined ? langFromBody : (req.body && req.body.lang);

    // Используем загруженный файл, если есть, иначе используем photo_url из JSON
    const photoUrlToUse = finalPhotoUrl || photo_url;

    // Проверка существования пользователя
    const [existingUsers] = await pool.execute(
      'SELECT id, admin, super_admin FROM users WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      return error(res, 'User not found', 404);
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
    if (about !== undefined) {
      updates.push('about = ?');
      params.push(about || null);
    }
    if (social_links !== undefined) {
      // Валидация массива social_links
      if (Array.isArray(social_links)) {
        // Проверяем, что все элементы - строки (URL)
        const allStrings = social_links.every(link => typeof link === 'string');
        if (!allStrings) {
          return error(res, 'social_links must be an array of strings (URLs)', 400);
        }
        updates.push('social_links = ?');
        params.push(JSON.stringify(social_links));
      } else {
        return error(res, 'social_links must be an array', 400);
      }
    }
    if (lang !== undefined) {
      updates.push('lang = ?');
      params.push(lang && String(lang).trim() ? String(lang).trim() : null);
    }

    // Если ни одного поля не собрано — пробуем взять lang напрямую из req.body (клиент мог отправить только { lang })
    if (updates.length === 0 && req.body && req.body.lang !== undefined) {
      const rawLang = req.body.lang;
      const langVal = rawLang != null && String(rawLang).trim() ? String(rawLang).trim() : null;
      if (langVal === null || langVal.length <= 10) {
        updates.push('lang = ?');
        params.push(langVal);
      }
    }

    // Обработка admin и super_admin (только для суперадминов)
    if (req.user.isSuperAdmin) {
      // Нельзя снять права суперадмина у самого себя
      if (req.user.userId === id && super_admin === false) {
        return error(res, 'Cannot revoke super admin rights from yourself', 400);
      }

      if (admin !== undefined) {
        updates.push('admin = ?');
        params.push(admin ? 1 : 0);
        
        // Если убираем admin, автоматически убираем super_admin
        if (admin === false) {
          updates.push('super_admin = ?');
          params.push(0);
        }
      }

      if (super_admin !== undefined) {
        updates.push('super_admin = ?');
        params.push(super_admin ? 1 : 0);
        
        // Если назначаем super_admin, автоматически делаем его admin
        if (super_admin === true && admin === undefined) {
          updates.push('admin = ?');
          params.push(1);
        }
      }
    } else if (admin !== undefined || super_admin !== undefined) {
      // Если не суперадмин пытается изменить admin/super_admin
      return error(res, 'Only super admin can change admin rights', 403);
    }

    if (updates.length === 0) {
      return error(res, 'No data to update. Send JSON (Content-Type: application/json), e.g. { "lang": "en" }.', 400);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await pool.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    await stripeRouter.refreshUserStripeStatusIfNeeded(id);

    // Получение обновленных данных (включая актуальный статус Stripe)
    const [users] = await pool.execute(
      `SELECT id, email, display_name, photo_url, uid, phone_number, city,
       first_name, second_name, country, gender, count_performed, count_orders,
       jcoins, coins_from_created, coins_from_participation, stripe_id, score,
       admin, super_admin, fcm_token, auth_type, latitude, longitude, created_time,
       about, social_links, lang,
       stripe_account_status, stripe_status_label, can_donate, can_receive_payouts, stripe_status_updated_at,
       payout_rail, manual_payout_details, manual_payout_verified_at
       FROM users WHERE id = ?`,
      [id]
    );

    const updatedUser = users[0];

    // Парсим social_links из JSON если это строка
    if (updatedUser.social_links) {
      try {
        updatedUser.social_links = typeof updatedUser.social_links === 'string' 
          ? JSON.parse(updatedUser.social_links) 
          : updatedUser.social_links;
      } catch (e) {
        updatedUser.social_links = [];
      }
    } else {
      updatedUser.social_links = [];
    }

    success(res, { user: updatedUser }, 'User data updated');
  } catch (err) {
    console.error('Ошибка обновления пользователя:', err);
    error(res, 'Error updating user data', 500, err);
  }
});

/**
 * PUT /api/users/:id/jcoins
 * Обновление количества Joycoins (только для админов)
 */
router.put('/:id/jcoins', authenticate, requireAdmin, [
  body('jcoins').isInt().withMessage('jcoins must be a number'),
  body('operation').optional().isIn(['set', 'add', 'subtract']).withMessage('Operation must be set, add or subtract')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }

    const { id } = req.params;
    const { jcoins, operation = 'set' } = req.body;

    // Проверка существования пользователя
    const [existingUsers] = await pool.execute(
      'SELECT jcoins FROM users WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      return error(res, 'User not found', 404);
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

    success(res, { jcoins: newJcoins }, 'Joycoins updated');
  } catch (err) {
    console.error('Ошибка обновления Joycoins:', err);
    error(res, 'Error updating Joycoins', 500, err);
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
      return error(res, 'User not found', 404);
    }

    await pool.execute('DELETE FROM users WHERE id = ?', [id]);

    success(res, null, 'User deleted');
  } catch (err) {
    console.error('Ошибка удаления пользователя:', err);
    error(res, 'Error deleting user', 500, err);
  }
});

/**
 * PUT /api/users/:id/admin
 * Назначение/снятие прав администратора (только для суперадмина)
 */
router.put('/:id/admin', authenticate, requireSuperAdmin, [
  body('admin').isBoolean().withMessage('admin must be boolean'),
  body('super_admin').optional().isBoolean().withMessage('super_admin must be boolean')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }

    const { id } = req.params;
    const { admin, super_admin } = req.body;

    // Нельзя снять права суперадмина у самого себя
    if (req.user.userId === id && super_admin === false) {
      return error(res, 'Cannot revoke super admin rights from yourself', 400);
    }

    // Проверка существования пользователя
    const [existingUsers] = await pool.execute(
      'SELECT id, email, admin, super_admin FROM users WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      return error(res, 'User not found', 404);
    }

    const existingUser = existingUsers[0];

    // Формирование запроса обновления
    const updates = [];
    const params = [];

    if (admin !== undefined) {
      updates.push('admin = ?');
      params.push(admin ? 1 : 0);
      
      // Если убираем admin, автоматически убираем super_admin
      if (admin === false) {
        updates.push('super_admin = ?');
        params.push(0);
      }
    }

    // Только суперадмин может назначать суперадмина
    if (super_admin !== undefined) {
      updates.push('super_admin = ?');
      params.push(super_admin ? 1 : 0);
      
      // Если назначаем суперадмина, автоматически делаем его админом
      if (super_admin === true && admin === undefined) {
        updates.push('admin = ?');
        params.push(1);
      }
    }

    if (updates.length === 0) {
      return error(res, 'No data to update', 400);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await pool.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Получение обновленных данных
    const [updatedUsers] = await pool.execute(
      'SELECT id, email, display_name, admin, super_admin FROM users WHERE id = ?',
      [id]
    );

    success(res, { user: updatedUsers[0] }, 'Admin rights updated');
  } catch (err) {
    return error(res, 'Error updating admin rights', 500, err);
  }
});

module.exports = router;

