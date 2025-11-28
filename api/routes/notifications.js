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

module.exports = router;

