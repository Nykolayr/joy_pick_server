const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const stripe = require('../config/stripe');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');

const router = express.Router();

/**
 * POST /api/payments/create-donation
 * Создание PaymentIntent для доната к заявке
 */
router.post('/create-donation', authenticate, [
  body('request_id').notEmpty().withMessage('request_id обязателен'),
  body('user_id').notEmpty().withMessage('user_id обязателен'),
  body('amount_cents').isInt({ min: 50 }).withMessage('Минимум 50 центов'),
  body('request_category').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, errors.array());
    }

    const { request_id, user_id, amount_cents, request_category } = req.body;

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Недостаточно прав', 403);
    }

    // Проверяем существование заявки
    const [requests] = await pool.execute(
      'SELECT id, name, category FROM requests WHERE id = ?',
      [request_id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    // Проверяем существование пользователя
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [user_id]
    );

    if (users.length === 0) {
      return error(res, 'Пользователь не найден', 404);
    }

    // Создаем PaymentIntent в Stripe
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amount_cents,
        currency: 'usd',
        payment_method_types: ['card'],
        capture_method: 'manual', // Холдируем средства
        metadata: {
          request_id: request_id,
          user_id: user_id,
          request_category: request_category || requests[0].category || 'unknown',
          type: 'donation'
        }
      });
    } catch (stripeErr) {
      return error(res, 'Ошибка при создании PaymentIntent', 500, stripeErr);
    }

    // Сохраняем PaymentIntent в базу данных
    const id = generateId();
    await pool.execute(
      `INSERT INTO payment_intents (id, payment_intent_id, user_id, request_id, amount_cents, currency, status, type, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        paymentIntent.id,
        user_id,
        request_id,
        amount_cents,
        'usd',
        paymentIntent.status,
        'donation',
        JSON.stringify({
          request_id: request_id,
          user_id: user_id,
          request_category: request_category || requests[0].category || 'unknown'
        })
      ]
    );

    // Сохраняем донат в таблицу donations
    const donationId = generateId();
    await pool.execute(
      `INSERT INTO donations (id, request_id, user_id, amount, payment_intent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [donationId, request_id, user_id, amount_cents / 100, paymentIntent.id]
    );

    return success(res, {
      payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      message: 'Payment intent created'
    }, 'Payment intent created');

  } catch (err) {
    return error(res, 'Ошибка при создании доната', 500, err);
  }
});

/**
 * POST /api/payments/create-request-payment
 * Создание PaymentIntent для оплаты стоимости заявки (если cost > 0)
 */
router.post('/create-request-payment', authenticate, [
  body('request_id').notEmpty().withMessage('request_id обязателен'),
  body('user_id').notEmpty().withMessage('user_id обязателен'),
  body('amount_cents').isInt({ min: 50 }).withMessage('Минимум 50 центов'),
  body('request_category').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, errors.array());
    }

    const { request_id, user_id, amount_cents, request_category } = req.body;

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Недостаточно прав', 403);
    }

    // Проверяем существование заявки
    const [requests] = await pool.execute(
      'SELECT id, name, category FROM requests WHERE id = ?',
      [request_id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    // Проверяем существование пользователя
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [user_id]
    );

    if (users.length === 0) {
      return error(res, 'Пользователь не найден', 404);
    }

    // Создаем PaymentIntent в Stripe
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amount_cents,
        currency: 'usd',
        payment_method_types: ['card'],
        capture_method: 'manual', // Холдируем средства
        metadata: {
          request_id: request_id,
          user_id: user_id,
          request_category: request_category || requests[0].category || 'unknown',
          type: 'request_payment'
        }
      });
    } catch (stripeErr) {
      return error(res, 'Ошибка при создании PaymentIntent', 500, stripeErr);
    }

    // Сохраняем PaymentIntent в базу данных
    const id = generateId();
    await pool.execute(
      `INSERT INTO payment_intents (id, payment_intent_id, user_id, request_id, amount_cents, currency, status, type, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        paymentIntent.id,
        user_id,
        request_id,
        amount_cents,
        'usd',
        paymentIntent.status,
        'request_payment',
        JSON.stringify({
          request_id: request_id,
          user_id: user_id,
          request_category: request_category || requests[0].category || 'unknown'
        })
      ]
    );

    return success(res, {
      payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      message: 'Payment intent created'
    }, 'Payment intent created');

  } catch (err) {
    return error(res, 'Ошибка при создании платежа за заявку', 500, err);
  }
});

/**
 * POST /api/payments/complete-request
 * Завершение заявки и выплата волонтёру
 */
router.post('/complete-request', authenticate, [
  body('request_id').notEmpty().withMessage('request_id обязателен'),
  body('performer_user_id').notEmpty().withMessage('performer_user_id обязателен')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, errors.array());
    }

    const { request_id, performer_user_id } = req.body;

    // Получаем заявку из базы данных
    const [requests] = await pool.execute(
      'SELECT id, cost, category, name FROM requests WHERE id = ?',
      [request_id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    // Получаем все PaymentIntent для заявки
    // 1. Основной PaymentIntent (если cost > 0)
    const [requestPayments] = await pool.execute(
      `SELECT * FROM payment_intents 
       WHERE request_id = ? AND type = 'request_payment' AND status IN ('requires_capture', 'succeeded')`,
      [request_id]
    );

    // 2. Все донаты
    const [donations] = await pool.execute(
      `SELECT d.*, pi.payment_intent_id, pi.status as payment_status
       FROM donations d
       LEFT JOIN payment_intents pi ON d.payment_intent_id = pi.payment_intent_id
       WHERE d.request_id = ? AND pi.status IN ('requires_capture', 'succeeded')`,
      [request_id]
    );

    const allPaymentIntents = [
      ...requestPayments.map(p => p.payment_intent_id),
      ...donations.map(d => d.payment_intent_id).filter(Boolean)
    ];

    // Capture всех PaymentIntent
    const capturedPaymentIntents = [];
    const captureErrors = [];

    for (const paymentIntentId of allPaymentIntents) {
      try {
        const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);
        capturedPaymentIntents.push(paymentIntentId);
        
        // Обновляем статус в БД
        await pool.execute(
          'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
          ['succeeded', paymentIntentId]
        );
      } catch (captureErr) {
        captureErrors.push({
          payment_intent_id: paymentIntentId,
          error: captureErr.message
        });
        // Продолжаем с остальными даже при ошибке
      }
    }

    // Рассчитываем сумму для transfer
    const costAmount = request.cost ? Math.round(request.cost * 100) : 0; // в центах
    const donationsAmount = donations.reduce((sum, d) => sum + Math.round(d.amount * 100), 0);
    const totalAmount = costAmount + donationsAmount;

    // Комиссия платформы: 7%
    const platformFeeCents = Math.round(totalAmount * 0.07);
    
    // Комиссия Stripe: 10.9% + $0.33
    const stripeFeeCents = Math.round(totalAmount * 0.109) + 33;
    
    // Сумма для волонтёра
    const transferAmountCents = totalAmount - platformFeeCents - stripeFeeCents;

    // Получаем stripe_account_id исполнителя
    const [stripeAccounts] = await pool.execute(
      'SELECT account_id FROM stripe_accounts WHERE user_id = ?',
      [performer_user_id]
    );

    if (stripeAccounts.length === 0) {
      return error(res, 'Stripe аккаунт исполнителя не найден', 404);
    }

    const stripeAccountId = stripeAccounts[0].account_id;

    // Создаем Transfer
    let transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: transferAmountCents,
        currency: 'usd',
        destination: stripeAccountId,
        source_transaction: allPaymentIntents[0] || undefined,
        metadata: {
          request_id: request_id,
          performer_user_id: performer_user_id
        }
      });
    } catch (transferErr) {
      // Логируем критическую ошибку, но продолжаем
      return error(res, 'Ошибка при создании transfer', 500, transferErr);
    }

    // Сохраняем transfer в базу данных
    const transferId = generateId();
    await pool.execute(
      `INSERT INTO transfers (id, transfer_id, request_id, performer_user_id, amount_cents, platform_fee_cents, stripe_fee_cents, currency, status, source_payment_intent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transferId,
        transfer.id,
        request_id,
        performer_user_id,
        transferAmountCents,
        platformFeeCents,
        stripeFeeCents,
        'usd',
        'pending',
        allPaymentIntents[0] || null
      ]
    );

    // Обновляем заявку в базе данных
    await pool.execute(
      'UPDATE requests SET status = ?, taken_by = ?, updated_at = NOW() WHERE id = ?',
      ['archived', performer_user_id, request_id]
    );

    return success(res, {
      captured_payment_intents: capturedPaymentIntents,
      capture_errors: captureErrors.length > 0 ? captureErrors : undefined,
      transfer_id: transfer.id,
      transfer_amount_cents: transferAmountCents,
      platform_fee_cents: platformFeeCents,
      stripe_fee_cents: stripeFeeCents,
      message: 'Request completed and transfer created'
    }, 'Request completed and transfer created');

  } catch (err) {
    return error(res, 'Ошибка при завершении заявки', 500, err);
  }
});

/**
 * GET /api/payments/history
 * Получение истории платежей пользователя
 */
router.get('/history', authenticate, async (req, res) => {
  try {
    const { user_id, page = 1, limit = 20 } = req.query;

    if (!user_id) {
      return error(res, 'user_id обязателен', 400);
    }

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Недостаточно прав', 403);
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Получаем платежи
    const [payments] = await pool.execute(
      `SELECT pi.*, r.name as request_name
       FROM payment_intents pi
       LEFT JOIN requests r ON pi.request_id = r.id
       WHERE pi.user_id = ?
       ORDER BY pi.created_at DESC
       LIMIT ? OFFSET ?`,
      [user_id, limitNum, offset]
    );

    // Получаем общее количество
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM payment_intents WHERE user_id = ?',
      [user_id]
    );
    const total = countResult[0]?.total || 0;

    const formattedPayments = payments.map(p => ({
      id: p.payment_intent_id,
      type: p.type,
      amount_cents: p.amount_cents,
      status: p.status,
      request_id: p.request_id,
      request_name: p.request_name,
      created_at: p.created_at
    }));

    return success(res, {
      payments: formattedPayments,
      total: total,
      page: pageNum,
      limit: limitNum
    }, 'Payment history retrieved');

  } catch (err) {
    return error(res, 'Ошибка при получении истории платежей', 500, err);
  }
});

/**
 * GET /api/payments/payouts
 * Получение истории выплат волонтёру
 */
router.get('/payouts', authenticate, async (req, res) => {
  try {
    const { user_id, page = 1, limit = 20 } = req.query;

    if (!user_id) {
      return error(res, 'user_id обязателен', 400);
    }

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Недостаточно прав', 403);
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Получаем выплаты
    const [payouts] = await pool.execute(
      `SELECT t.*, r.name as request_name
       FROM transfers t
       LEFT JOIN requests r ON t.request_id = r.id
       WHERE t.performer_user_id = ?
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [user_id, limitNum, offset]
    );

    // Получаем общее количество
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM transfers WHERE performer_user_id = ?',
      [user_id]
    );
    const total = countResult[0]?.total || 0;

    const formattedPayouts = payouts.map(p => ({
      id: p.transfer_id,
      amount_cents: p.amount_cents,
      status: p.status,
      request_id: p.request_id,
      request_name: p.request_name,
      platform_fee_cents: p.platform_fee_cents,
      stripe_fee_cents: p.stripe_fee_cents,
      created_at: p.created_at
    }));

    return success(res, {
      payouts: formattedPayouts,
      total: total,
      page: pageNum,
      limit: limitNum
    }, 'Payout history retrieved');

  } catch (err) {
    return error(res, 'Ошибка при получении истории выплат', 500, err);
  }
});

module.exports = router;

