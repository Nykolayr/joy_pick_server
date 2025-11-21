const express = require('express');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/participants
 * Получение списка участников заявки
 */
router.get('/', async (req, res) => {
  try {
    const { requestId } = req.query;

    if (!requestId) {
      return error(res, 'ID заявки обязателен', 400);
    }

    const [participants] = await pool.execute(
      `SELECT rp.*, u.display_name, u.photo_url, u.email
      FROM request_participants rp
      LEFT JOIN users u ON rp.user_id = u.id
      WHERE rp.request_id = ?
      ORDER BY rp.created_at DESC`,
      [requestId]
    );

    success(res, { participants });
  } catch (err) {
    console.error('Ошибка получения участников:', err);
    error(res, 'Ошибка при получении списка участников', 500);
  }
});

/**
 * GET /api/participants/contributors
 * Получение списка вкладчиков заявки
 */
router.get('/contributors', async (req, res) => {
  try {
    const { requestId } = req.query;

    if (!requestId) {
      return error(res, 'ID заявки обязателен', 400);
    }

    const [contributors] = await pool.execute(
      `SELECT rc.*, u.display_name, u.photo_url, u.email
      FROM request_contributors rc
      LEFT JOIN users u ON rc.user_id = u.id
      WHERE rc.request_id = ?
      ORDER BY rc.amount DESC, rc.created_at DESC`,
      [requestId]
    );

    success(res, { contributors });
  } catch (err) {
    console.error('Ошибка получения вкладчиков:', err);
    error(res, 'Ошибка при получении списка вкладчиков', 500);
  }
});

module.exports = router;

