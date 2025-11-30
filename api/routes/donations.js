const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { sendDonationNotification } = require('../services/pushNotification');

const router = express.Router();

/**
 * GET /api/donations
 * Получение списка донатов
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20, requestId, userId } = req.query;
    
    // Валидация и преобразование параметров пагинации
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20)); // Максимум 100 на странице
    const offset = (pageNum - 1) * limitNum;

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

    // Используем прямой ввод чисел для LIMIT и OFFSET (безопасно, так как значения валидированы)
    query += ` ORDER BY d.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

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
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
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
      'SELECT id, name, category, created_by, total_contributed FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];
    const donationId = generateId();

    // Создание доната
    await pool.execute(
      'INSERT INTO donations (id, request_id, user_id, amount, payment_intent_id) VALUES (?, ?, ?, ?, ?)',
      [donationId, requestId, userId, amount, paymentIntentId]
    );

    // Обновление суммы вкладов в заявке
    const newTotalContributed = (request.total_contributed || 0) + amount;
    await pool.execute(
      'UPDATE requests SET total_contributed = ?, updated_at = NOW() WHERE id = ?',
      [newTotalContributed, requestId]
    );

    // Донатеры хранятся только в таблице donations, request_contributors больше не используется

    // Отправка push-уведомления создателю заявки (асинхронно)
    if (request.created_by) {
      sendDonationNotification({
        requestId: requestId,
        requestName: request.name || 'Request',
        requestCategory: request.category,
        creatorId: request.created_by,
        donorId: userId,
        amount: amount,
      }).catch(err => {
        console.error('❌ Ошибка отправки push-уведомления при донате:', err);
      });
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

