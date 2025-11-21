const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');

const router = express.Router();

/**
 * GET /api/donations
 * Получение списка донатов
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20, requestId, userId } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT d.*, u.display_name as user_name, u.email as user_email,
       r.name as request_name
      FROM donations d
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN requests r ON d.request_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (requestId) {
      query += ' AND d.request_id = ?';
      params.push(requestId);
    }

    if (userId) {
      query += ' AND d.user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY d.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [donations] = await pool.execute(query, params);

    // Получение общего количества
    let countQuery = 'SELECT COUNT(*) as total FROM donations WHERE 1=1';
    const countParams = [];
    
    if (requestId) {
      countQuery += ' AND request_id = ?';
      countParams.push(requestId);
    }
    if (userId) {
      countQuery += ' AND user_id = ?';
      countParams.push(userId);
    }
    
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    success(res, {
      donations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Ошибка получения донатов:', err);
    error(res, 'Ошибка при получении списка донатов', 500);
  }
});

/**
 * GET /api/donations/:id
 * Получение доната по ID
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const [donations] = await pool.execute(
      `SELECT d.*, u.display_name as user_name, u.email as user_email,
       r.name as request_name
      FROM donations d
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN requests r ON d.request_id = r.id
      WHERE d.id = ?`,
      [id]
    );

    if (donations.length === 0) {
      return error(res, 'Донат не найден', 404);
    }

    success(res, { donation: donations[0] });
  } catch (err) {
    console.error('Ошибка получения доната:', err);
    error(res, 'Ошибка при получении доната', 500);
  }
});

/**
 * POST /api/donations
 * Создание доната
 */
router.post('/', authenticate, [
  body('requestId').notEmpty().withMessage('ID заявки обязателен'),
  body('amount').isInt({ min: 1 }).withMessage('Сумма должна быть положительным числом'),
  body('paymentIntentId').notEmpty().withMessage('ID PaymentIntent обязателен')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { requestId, amount, paymentIntentId } = req.body;
    const userId = req.user.userId;

    // Проверка существования заявки
    const [requests] = await pool.execute(
      'SELECT id, total_contributed FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const donationId = generateId();

    // Создание доната
    await pool.execute(
      'INSERT INTO donations (id, request_id, user_id, amount, payment_intent_id) VALUES (?, ?, ?, ?, ?)',
      [donationId, requestId, userId, amount, paymentIntentId]
    );

    // Обновление суммы вкладов в заявке
    const newTotalContributed = (requests[0].total_contributed || 0) + amount;
    await pool.execute(
      'UPDATE requests SET total_contributed = ?, updated_at = NOW() WHERE id = ?',
      [newTotalContributed, requestId]
    );

    // Добавление вкладчика, если его еще нет
    const [existingContributor] = await pool.execute(
      'SELECT id FROM request_contributors WHERE request_id = ? AND user_id = ?',
      [requestId, userId]
    );

    if (existingContributor.length === 0) {
      await pool.execute(
        'INSERT INTO request_contributors (id, request_id, user_id, amount) VALUES (?, ?, ?, ?)',
        [generateId(), requestId, userId, amount]
      );
    } else {
      // Обновление суммы вклада
      await pool.execute(
        'UPDATE request_contributors SET amount = amount + ? WHERE request_id = ? AND user_id = ?',
        [amount, requestId, userId]
      );
    }

    // Получение созданного доната
    const [donations] = await pool.execute(
      `SELECT d.*, u.display_name as user_name, u.email as user_email,
       r.name as request_name
      FROM donations d
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN requests r ON d.request_id = r.id
      WHERE d.id = ?`,
      [donationId]
    );

    success(res, { donation: donations[0] }, 'Донат создан', 201);
  } catch (err) {
    console.error('Ошибка создания доната:', err);
    error(res, 'Ошибка при создании доната', 500);
  }
});

module.exports = router;

