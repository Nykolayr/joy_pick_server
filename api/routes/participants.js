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

    // Участники event теперь хранятся в actual_participants (JSON поле в requests)
    // Получаем actual_participants из заявки
    const [requests] = await pool.execute(
      'SELECT actual_participants FROM requests WHERE id = ?',
      [requestId]
    );

    let participants = [];
    if (requests.length > 0 && requests[0].actual_participants) {
      try {
        const participantIds = typeof requests[0].actual_participants === 'string' 
          ? JSON.parse(requests[0].actual_participants) 
          : requests[0].actual_participants;
        
        if (Array.isArray(participantIds) && participantIds.length > 0) {
          const placeholders = participantIds.map(() => '?').join(',');
          const [users] = await pool.execute(
            `SELECT id, display_name, photo_url, email
            FROM users
            WHERE id IN (${placeholders})`,
            participantIds
          );
          participants = users;
        }
      } catch (e) {
        console.error('Ошибка парсинга actual_participants:', e);
      }
    }

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

    // Вкладчики теперь хранятся только в таблице donations
    const [contributors] = await pool.execute(
      `SELECT d.user_id, SUM(d.amount) as amount, u.display_name, u.photo_url, u.email
      FROM donations d
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.request_id = ?
      GROUP BY d.user_id
      ORDER BY amount DESC`,
      [requestId]
    );

    success(res, { contributors });
  } catch (err) {
    console.error('Ошибка получения вкладчиков:', err);
    error(res, 'Ошибка при получении списка вкладчиков', 500);
  }
});

module.exports = router;

