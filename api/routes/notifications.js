const express = require('express');
const { body, validationResult } = require('express-validator');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendNotificationToUsers } = require('../services/pushNotification');

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

module.exports = router;

