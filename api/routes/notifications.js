const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendNotificationToUsers } = require('../services/pushNotification');
const { normalizeDatesInObject } = require('../utils/datetime');

const router = express.Router();

/**
 * POST /api/notifications/send
 * Массовая рассылка push-уведомлений пользователям
 * Только для админов
 * 
 * Body:
 * {
 *   "title": "Заголовок уведомления",
 *   "body": "Текст уведомления",
 *   "user_ids": ["uuid1", "uuid2", ...], // Массив ID пользователей
 *   "image_url": "https://example.com/image.jpg", // Опционально
 *   "sound": "default", // Опционально
 *   "data": { // Опционально, дополнительные данные
 *     "initialPageName": "SomePage",
 *     "parameterData": "{\"key\":\"value\"}",
 *     "deeplink": "https://..."
 *   }
 * }
 */
router.post('/send', authenticate, requireAdmin, [
  body('title').notEmpty().withMessage('Заголовок обязателен'),
  body('body').notEmpty().withMessage('Текст уведомления обязателен'),
  body('user_ids').isArray({ min: 1 }).withMessage('Массив ID пользователей обязателен и не должен быть пустым'),
  body('user_ids.*').isUUID().withMessage('Каждый ID пользователя должен быть валидным UUID'),
  body('image_url').optional().isURL().withMessage('URL изображения должен быть валидным'),
  body('sound').optional().isString(),
  body('data').optional().isObject(),
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { title, body: bodyText, user_ids, image_url, sound, data } = req.body;

    // Отправляем уведомления
    const result = await sendNotificationToUsers({
      title,
      body: bodyText,
      userIds: user_ids,
      imageUrl: image_url || null,
      sound: sound || 'default',
      data: data || {},
    });

    // Проверяем результат отправки
    if (result.successCount === 0 && result.failureCount > 0) {
      // Если ничего не отправилось, возвращаем ошибку
      return error(res, result.errorMessage || 'Не удалось отправить уведомления', 400, {
        sent: result.successCount,
        failed: result.failureCount,
        total: user_ids.length,
        reason: result.reason || 'Неизвестная ошибка',
      });
    }

    if (result.successCount === 0 && result.failureCount === 0) {
      // Если нет токенов или другие проблемы
      return error(res, result.errorMessage || 'Не удалось отправить уведомления: у пользователей нет FCM токенов', 400, {
        sent: 0,
        failed: user_ids.length,
        total: user_ids.length,
        reason: result.reason || 'У пользователей отсутствуют FCM токены',
      });
    }

    // Если хотя бы одно уведомление отправилось, возвращаем успех
    success(res, {
      sent: result.successCount,
      failed: result.failureCount,
      total: user_ids.length,
    }, `Отправлено ${result.successCount} из ${user_ids.length} уведомлений`);
  } catch (err) {
    console.error('Ошибка массовой рассылки уведомлений:', err);
    error(res, 'Ошибка при отправке уведомлений', 500, err);
  }
});

/**
 * GET /api/notifications
 * Получение списка push-уведомлений текущего пользователя
 * Требует аутентификации
 * 
 * Query параметры:
 * - page (int, default: 1) - номер страницы
 * - limit (int, default: 20) - количество на странице
 * - read (boolean, опционально) - фильтр по прочитанности (true - только прочитанные, false - только непрочитанные)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      page = 1,
      limit = 20,
      read
    } = req.query;

    // Валидация и преобразование параметров пагинации
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20)); // Максимум 100 на странице
    const offset = (pageNum - 1) * limitNum;

    let query = 'SELECT * FROM push_notifications WHERE user_id = ?';
    const params = [userId];

    // Фильтр по прочитанности
    if (read !== undefined) {
      query += ' AND `read` = ?';
      params.push(read === 'true');
    }

    // Сортировка по дате создания (новые сначала)
    // LIMIT и OFFSET должны быть числами, а не параметрами
    query += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

    const [notifications] = await pool.execute(query, params);

    // Обработка JSON поля data и нормализация дат
    const processedNotifications = notifications.map(notification => {
      const result = Object.assign({}, notification);
      if (notification.data) {
        try {
          result.data = typeof notification.data === 'string' 
            ? JSON.parse(notification.data) 
            : notification.data;
        } catch (e) {
          result.data = {};
        }
      } else {
        result.data = {};
      }
      result.read = Boolean(notification.read);
      // Нормализация дат в UTC
      return normalizeDatesInObject(result, ['created_at', 'updated_at']);
    });

    // Получение общего количества
    let countQuery = 'SELECT COUNT(*) as total FROM push_notifications WHERE user_id = ?';
    const countParams = [userId];
    if (read !== undefined) {
      countQuery += ' AND `read` = ?';
      countParams.push(read === 'true');
    }
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    success(res, {
      notifications: processedNotifications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error('Ошибка получения уведомлений:', err);
    error(res, 'Ошибка при получении списка уведомлений', 500, err);
  }
});

/**
 * PUT /api/notifications/:id/read
 * Отметить уведомление как прочитанное
 * Требует аутентификации
 */
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Проверка существования уведомления и принадлежности пользователю
    const [notifications] = await pool.execute(
      'SELECT id FROM push_notifications WHERE id = ? AND user_id = ?',
      [id, userId]
    );

    if (notifications.length === 0) {
      return error(res, 'Уведомление не найдено', 404);
    }

    // Отмечаем как прочитанное
    await pool.execute(
      'UPDATE push_notifications SET `read` = TRUE, updated_at = NOW() WHERE id = ?',
      [id]
    );

    success(res, null, 'Уведомление отмечено как прочитанное');
  } catch (err) {
    console.error('Ошибка отметки уведомления:', err);
    error(res, 'Ошибка при отметке уведомления', 500, err);
  }
});

/**
 * PUT /api/notifications/read-all
 * Отметить все уведомления пользователя как прочитанные
 * Требует аутентификации
 */
router.put('/read-all', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Отмечаем все уведомления как прочитанные
    const [result] = await pool.execute(
      'UPDATE push_notifications SET `read` = TRUE, updated_at = NOW() WHERE user_id = ? AND `read` = FALSE',
      [userId]
    );

    success(res, {
      updated: result.affectedRows
    }, `Отмечено ${result.affectedRows} уведомлений как прочитанных`);
  } catch (err) {
    console.error('Ошибка отметки всех уведомлений:', err);
    error(res, 'Ошибка при отметке уведомлений', 500, err);
  }
});

/**
 * GET /api/notifications/unread-count
 * Получить количество непрочитанных уведомлений
 * Требует аутентификации
 */
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [result] = await pool.execute(
      'SELECT COUNT(*) as count FROM push_notifications WHERE user_id = ? AND `read` = FALSE',
      [userId]
    );

    success(res, {
      unreadCount: result[0].count
    });
  } catch (err) {
    console.error('Ошибка получения количества непрочитанных уведомлений:', err);
    error(res, 'Ошибка при получении количества уведомлений', 500, err);
  }
});

module.exports = router;

