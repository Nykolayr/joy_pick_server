const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendNotificationToUsers } = require('../services/pushNotification');
const { normalizeDatesInObject } = require('../utils/datetime');
const { generateId } = require('../utils/uuid');
const {
  resolveRequestIdFromSendPayload,
  isUuid,
} = require('../utils/adminNotificationSendContext');
const { buildRequestDetailForApi } = require('./requests');

const router = express.Router();

function mapAdminNotificationSendRow(row) {
  let payloadData = {};
  if (row.payload_json != null) {
    if (typeof row.payload_json === 'string') {
      try {
        payloadData = JSON.parse(row.payload_json);
      } catch (_) {
        payloadData = {};
      }
    } else if (typeof row.payload_json === 'object') {
      payloadData = { ...row.payload_json };
    }
  }

  return normalizeDatesInObject(
    {
      id: row.id,
      title: row.title,
      body: row.body,
      trigger: row.push_trigger ?? null,
      send_reason: row.send_reason ?? null,
      request_id: row.request_id ?? null,
      data: payloadData,
      sent_at: row.sent_at,
      recipient_count: row.recipient_count,
      success_count: row.success_count,
      failed_count: row.failed_count,
      sent_by_user_id: row.sent_by_user_id || undefined,
      image_url: row.image_url || undefined,
    },
    ['sent_at']
  );
}

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
 *   },
 *   "trigger": "admin_request_reminder", // Опционально: тип/источник триггера
 *   "send_reason": "Напоминание модератору", // Опционально; можно передать как "reason"
 *   "request_id": "uuid" // Опционально; иначе подставится из data (request_id, deeplink, parameterData)
 * }
 */
router.post('/send', authenticate, requireAdmin, [
  body('title').notEmpty().withMessage('Title is required'),
  body('body').notEmpty().withMessage('Notification body is required'),
  body('user_ids').isArray({ min: 1 }).withMessage('user_ids array is required and must not be empty'),
  body('user_ids.*').isUUID().withMessage('Each user ID must be a valid UUID'),
  body('image_url').optional().isURL().withMessage('Image URL must be valid'),
  body('sound').optional().isString(),
  body('data').optional().isObject(),
  body('trigger').optional().isString().isLength({ max: 255 }).withMessage('trigger must be at most 255 chars'),
  body('send_reason').optional().isString().isLength({ max: 8000 }).withMessage('send_reason too long'),
  body('reason').optional().isString().isLength({ max: 8000 }).withMessage('reason too long'),
  body('request_id').optional().isUUID().withMessage('request_id must be a valid UUID'),
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }

    const {
      title,
      body: bodyText,
      user_ids,
      image_url,
      sound,
      data,
      trigger,
      send_reason: sendReasonBody,
      reason,
      request_id: requestIdBody,
    } = req.body;

    const dataObj = data && typeof data === 'object' ? data : {};
    const sendReason = sendReasonBody || reason || null;
    const pushTrigger = trigger || null;
    const resolvedRequestId = resolveRequestIdFromSendPayload({
      request_id: requestIdBody,
      data: dataObj,
    });
    const payloadJson = JSON.stringify(dataObj);

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
      return error(res, result.errorMessage || 'Failed to send notifications', 400, {
        sent: result.successCount,
        failed: result.failureCount,
        total: user_ids.length,
        reason: result.reason || 'Unknown error',
      });
    }

    if (result.successCount === 0 && result.failureCount === 0) {
      // Если нет токенов или другие проблемы
      return error(res, result.errorMessage || 'Failed to send notifications: users have no FCM tokens', 400, {
        sent: 0,
        failed: user_ids.length,
        total: user_ids.length,
        reason: result.reason || 'Users have no FCM tokens',
      });
    }

    try {
      const rowId = generateId();
      await pool.execute(
        `INSERT INTO admin_notification_sends (
          id, title, body, push_trigger, send_reason, request_id, payload_json,
          image_url, sent_by_user_id,
          recipient_count, success_count, failed_count, sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, NOW())`,
        [
          rowId,
          title,
          bodyText,
          pushTrigger,
          sendReason,
          resolvedRequestId,
          payloadJson,
          image_url || null,
          req.user.userId || null,
          user_ids.length,
          result.successCount,
          result.failureCount,
        ]
      );
    } catch (logErr) {
      console.error('Ошибка записи истории admin_notification_sends:', logErr);
    }

    // Если хотя бы одно уведомление отправилось, возвращаем успех
    success(res, {
      sent: result.successCount,
      failed: result.failureCount,
      total: user_ids.length,
    }, `Отправлено ${result.successCount} из ${user_ids.length} уведомлений`);
  } catch (err) {
    console.error('Ошибка массовой рассылки уведомлений:', err);
    error(res, 'Error sending notifications', 500, err);
  }
});

/**
 * GET /api/notifications/admin/sent
 * История массовых рассылок из админки (успешные POST /send).
 */
router.get('/admin/sent', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const [[{ total: totalRaw }]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM admin_notification_sends'
    );
    const total = Number(totalRaw) || 0;

    const [rows] = await pool.execute(
      `SELECT id, title, body, push_trigger, send_reason, request_id, payload_json,
              image_url, sent_by_user_id,
              recipient_count, success_count, failed_count, sent_at
       FROM admin_notification_sends
       ORDER BY sent_at DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`
    );

    const items = rows.map((row) => mapAdminNotificationSendRow(row));

    success(res, {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      },
    });
  } catch (err) {
    console.error('Ошибка получения истории admin_notification_sends:', err);
    error(res, 'Error fetching notification send history', 500, err);
  }
});

/**
 * GET /api/notifications/admin/sent/:id
 * Одна запись истории рассылки + заявка (если есть request_id).
 */
router.get('/admin/sent/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return error(res, 'Invalid id', 400);
    }

    const [rows] = await pool.execute(
      `SELECT id, title, body, push_trigger, send_reason, request_id, payload_json,
              image_url, sent_by_user_id,
              recipient_count, success_count, failed_count, sent_at
       FROM admin_notification_sends WHERE id = ? LIMIT 1`,
      [id]
    );

    if (rows.length === 0) {
      return error(res, 'Notification send not found', 404);
    }

    const send = mapAdminNotificationSendRow(rows[0]);
    let request = null;
    if (send.request_id) {
      const detail = await buildRequestDetailForApi(pool, send.request_id);
      request = detail ? detail.request : null;
    }

    success(res, { send, request });
  } catch (err) {
    console.error('Ошибка получения записи admin_notification_sends:', err);
    error(res, 'Error fetching notification send', 500, err);
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
    error(res, 'Error fetching notifications list', 500, err);
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
      return error(res, 'Notification not found', 404);
    }

    // Отмечаем как прочитанное
    await pool.execute(
      'UPDATE push_notifications SET `read` = TRUE, updated_at = NOW() WHERE id = ?',
      [id]
    );

    success(res, null, 'Notification marked as read');
  } catch (err) {
    console.error('Ошибка отметки уведомления:', err);
    error(res, 'Error marking notification', 500, err);
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
    error(res, 'Error marking notifications', 500, err);
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
    error(res, 'Error fetching notifications count', 500, err);
  }
});

module.exports = router;

