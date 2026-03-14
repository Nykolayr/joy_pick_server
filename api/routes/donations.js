const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { sendDonationNotification } = require('../services/pushNotification');
const { normalizeDatesInObject } = require('../utils/datetime');
const { addUserToGroupChatByRequest } = require('../utils/chatHelpers');
const stripe = require('../config/stripe.js');

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

    // Нормализация дат в UTC
    const normalizedDonations = donations.map(donation => normalizeDatesInObject(donation));

    success(res, {
      donations: normalizedDonations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error('Ошибка получения донатов:', err);
    error(res, 'Error fetching donations list', 500);
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
      return error(res, 'Donation not found', 404);
    }

    // Нормализация дат в UTC
    const normalizedDonation = normalizeDatesInObject(donations[0]);

    success(res, { donation: normalizedDonation });
  } catch (err) {
    console.error('Ошибка получения доната:', err);
    error(res, 'Error fetching donation', 500);
  }
});

/**
 * POST /api/donations
 * Создание доната
 */
router.post('/', authenticate, [
  body('requestId').notEmpty().withMessage('Request ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be a positive number'),
  body('paymentIntentId').notEmpty().withMessage('Payment Intent ID is required')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }

    const { requestId, amount, paymentIntentId } = req.body;
    const userId = req.user.userId;

    // Проверка существования заявки
    const [requests] = await pool.execute(
      'SELECT id, name, category, created_by, total_contributed FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const request = requests[0];

    // Проверка PaymentIntent в Stripe: только успешный платёж или requires_capture допускаем к созданию доната
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (stripeErr) {
      return error(res, 'Invalid payment. Payment could not be verified. Please try again.', 400, {
        reason: 'stripe_retrieve_failed',
        stripe_error: stripeErr.message
      });
    }

    if (paymentIntent.metadata?.user_id && paymentIntent.metadata.user_id !== userId) {
      return error(res, 'This payment does not belong to your account.', 403);
    }
    if (paymentIntent.metadata?.request_id && paymentIntent.metadata.request_id !== requestId) {
      return error(res, 'This payment is not for this request.', 400);
    }

    const amountCents = Math.round(parseFloat(amount) * 100);
    if (paymentIntent.amount !== amountCents) {
      return error(res, 'Payment amount does not match the donation amount.', 400);
    }

    const allowedStatuses = ['succeeded', 'requires_capture'];
    if (!allowedStatuses.includes(paymentIntent.status)) {
      const statusMessages = {
        requires_payment_method: 'Payment method required. Please add a valid card and try again.',
        requires_confirmation: 'Payment requires confirmation. Please complete the payment.',
        requires_action: 'Additional authentication required. Please complete the payment.',
        canceled: 'Payment was canceled.',
        processing: 'Payment is still processing. Please wait and try again.'
      };
      const message = statusMessages[paymentIntent.status] || `Payment status "${paymentIntent.status}" is not valid. Payment must succeed before creating a donation.`;
      return error(res, message, 400, {
        reason: 'payment_not_complete',
        stripe_status: paymentIntent.status
      });
    }

    const donationId = generateId();

    // Создание доната
    await pool.execute(
      'INSERT INTO donations (id, request_id, user_id, amount, payment_intent_id) VALUES (?, ?, ?, ?, ?)',
      [donationId, requestId, userId, amount, paymentIntentId]
    );

    // Обновление суммы вкладов в заявке
    // MySQL возвращает decimal как строки, поэтому используем parseFloat
    const currentTotal = parseFloat(request.total_contributed || 0);
    const newTotalContributed = currentTotal + parseFloat(amount);
    await pool.execute(
      'UPDATE requests SET total_contributed = ?, updated_at = NOW() WHERE id = ?',
      [newTotalContributed, requestId]
    );

    // Донатеры хранятся только в таблице donations, request_contributors больше не используется

    // Добавление донатера в групповой чат заявки (СИНХРОННО - важно для корректной работы)
    try {
      await addUserToGroupChatByRequest(requestId, userId);
    } catch (chatErr) {
      // Передаем детали ошибки в ответ API
      return error(res, 'Error adding to group chat', 500, chatErr);
    }

    // Отправка push-уведомления создателю заявки (асинхронно)
    // ВАЖНО: Не отправляем уведомление, если донат от самого создателя
    if (request.created_by && request.created_by !== userId) {
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

    // Нормализация дат в UTC
    const normalizedDonation = normalizeDatesInObject(donations[0]);

    success(res, { donation: normalizedDonation }, 'Donation created', 201);
  } catch (err) {
    console.error('Ошибка создания доната:', err);
    error(res, 'Error creating donation', 500);
  }
});

/**
 * DELETE /api/donations/by-payment-intent/:payment_intent_id
 * Удаление доната по payment_intent_id (при ошибке/отмене оплаты)
 */
router.delete('/by-payment-intent/:payment_intent_id', authenticate, async (req, res) => {
  try {
    const { payment_intent_id } = req.params;
    const userId = req.user.userId;

    // Находим донат по payment_intent_id
    const [donations] = await pool.execute(
      'SELECT id, request_id, amount, user_id FROM donations WHERE payment_intent_id = ?',
      [payment_intent_id]
    );

    if (donations.length === 0) {
      return error(res, 'Donation not found', 404);
    }

    const donation = donations[0];

    // Проверка прав: только создатель доната или админ может удалить
    if (donation.user_id !== userId && !req.user.isAdmin) {
      return error(res, 'Access denied', 403);
    }

    // Откатываем total_contributed в заявке
    const [requests] = await pool.execute(
      'SELECT total_contributed FROM requests WHERE id = ?',
      [donation.request_id]
    );

    if (requests.length > 0) {
      const currentTotal = parseFloat(requests[0].total_contributed || 0);
      const newTotal = Math.max(0, currentTotal - parseFloat(donation.amount)); // Не может быть отрицательным
      
      await pool.execute(
        'UPDATE requests SET total_contributed = ?, updated_at = NOW() WHERE id = ?',
        [newTotal, donation.request_id]
      );
    }

    // Удаляем донат
    await pool.execute('DELETE FROM donations WHERE id = ?', [donation.id]);

    // Отменяем PaymentIntent в Stripe (если еще не отменен)
    try {
      const stripe = require('../config/stripe.js');
      const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
      
      if (paymentIntent.status !== 'canceled' && 
          paymentIntent.status !== 'succeeded' &&
          (paymentIntent.status === 'requires_capture' || 
           paymentIntent.status === 'requires_payment_method' ||
           paymentIntent.status === 'requires_confirmation' ||
           paymentIntent.status === 'requires_action')) {
        await stripe.paymentIntents.cancel(payment_intent_id);
      }
    } catch (stripeErr) {
      // Игнорируем ошибки Stripe (возможно, уже отменен)
    }

    success(res, null, 'Donation deleted, amount refunded');
  } catch (err) {
    return error(res, 'Error deleting donation', 500, err);
  }
});

module.exports = router;

