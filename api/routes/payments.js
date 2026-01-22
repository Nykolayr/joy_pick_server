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
  body('request_id').notEmpty().withMessage('request_id is required'),
  body('user_id').notEmpty().withMessage('user_id is required'),
  body('amount').isFloat({ min: 0.5 }).withMessage('Minimum 0.5 dollars (50 cents)'),
  body('request_category').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, errors.array());
    }

    const { request_id, user_id, amount, request_category } = req.body;

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Insufficient permissions', 403);
    }

    // Проверяем существование заявки
    const [requests] = await pool.execute(
      'SELECT id, name, category FROM requests WHERE id = ?',
      [request_id]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    // Проверяем существование пользователя
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [user_id]
    );

    if (users.length === 0) {
      return error(res, 'User not found', 404);
    }

    // Проверяем, что Stripe API ключ настроен
    if (!process.env.STRIPE_SECRET_KEY) {
      return error(res, 'Stripe not configured on server', 500);
    }

    // ВАЖНО: amount приходит в долларах (как возвращается на фронт)
    // Конвертируем в центы для Stripe
    const amountCents = Math.round(parseFloat(amount) * 100);
    
    if (amountCents < 50) {
      return error(res, 'Minimum 50 cents (Stripe requirement)', 400);
    }

    // Создаем PaymentIntent в Stripe
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        payment_method_types: ['card'],
        capture_method: 'automatic', // Автоматический захват средств
        metadata: {
          request_id: request_id,
          user_id: user_id,
          request_category: request_category || requests[0].category || 'unknown',
          type: 'donation'
        }
      });

      // КРИТИЧЕСКИ ВАЖНО: Проверяем что Stripe вернул корректный ответ
      if (!paymentIntent) {
        throw new Error('Stripe вернул пустой ответ (null или undefined)');
      }

      if (!paymentIntent.id) {
        throw new Error('Stripe не вернул payment_intent_id в ответе');
      }

      if (!paymentIntent.client_secret) {
        throw new Error('Stripe не вернул client_secret в ответе. PaymentIntent ID: ' + paymentIntent.id);
      }

    } catch (stripeErr) {
      return error(res, 'Error creating PaymentIntent for donation', 500, {
        errorMessage: stripeErr.message || 'Неизвестная ошибка',
        errorType: stripeErr.type || 'StripeError',
        errorCode: stripeErr.code || 'STRIPE_ERROR',
        requestId: request_id,
        userId: user_id,
        amountCents: amountCents,
        amountDollars: parseFloat(amount),
        stripeRaw: stripeErr.raw || null,
        stripeDeclineCode: stripeErr.decline_code || null,
        stripeParam: stripeErr.param || null
      });
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
        amountCents,
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

    // Сохраняем донат в таблицу donations (amount в долларах)
    const donationId = generateId();
    await pool.execute(
      `INSERT INTO donations (id, request_id, user_id, amount, payment_intent_id, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [donationId, request_id, user_id, parseFloat(amount), paymentIntent.id]
    );

    return success(res, {
      payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      message: 'Payment intent created'
    }, 'Payment intent created');

  } catch (err) {
    return error(res, 'Error creating donation', 500, err);
  }
});

/**
 * POST /api/payments/create-request-payment
 * @deprecated Эндпоинт удален. Теперь все платежи идут через донаты.
 * Используйте POST /api/payments/create-donation
 */
router.post('/create-request-payment', authenticate, async (req, res) => {
  return error(res, 'Эндпоинт удален. Платные заявки больше не поддерживаются. Используйте POST /api/payments/create-donation для создания доната от создателя заявки.', 410);
});

/**
 * POST /api/payments/complete-request
 * Завершение заявки и выплата волонтёру
 */
router.post('/complete-request', authenticate, [
  body('request_id').notEmpty().withMessage('request_id is required'),
  body('performer_user_id').notEmpty().withMessage('performer_user_id is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, errors.array());
    }

    const { request_id, performer_user_id } = req.body;

    // Получаем заявку из базы данных
    const [requests] = await pool.execute(
      'SELECT id, category, name FROM requests WHERE id = ?',
      [request_id]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const request = requests[0];

    const [donations] = await pool.execute(
      `SELECT d.*, pi.payment_intent_id, pi.status as payment_status
       FROM donations d
       LEFT JOIN payment_intents pi ON d.payment_intent_id = pi.payment_intent_id
       WHERE d.request_id = ? AND pi.status IN ('requires_capture', 'succeeded')`,
      [request_id]
    );

    const allPaymentIntents = donations.map(d => d.payment_intent_id).filter(Boolean);

    // Capture всех PaymentIntent
    const capturedPaymentIntents = [];
    const captureErrors = [];

    for (const paymentIntentId of allPaymentIntents) {
      try {
        // Проверяем текущий статус PaymentIntent в Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        // Захватываем только если статус requires_capture
        // Если уже succeeded, значит уже захвачен (например, через webhook)
        if (paymentIntent.status === 'requires_capture') {
          await stripe.paymentIntents.capture(paymentIntentId);
          capturedPaymentIntents.push(paymentIntentId);
          
          // Обновляем статус в БД
          await pool.execute(
            'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
            ['succeeded', paymentIntentId]
          );
        } else if (paymentIntent.status === 'succeeded') {
          // Уже захвачен, просто обновляем статус в БД если нужно
          await pool.execute(
            'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
            ['succeeded', paymentIntentId]
          );
          capturedPaymentIntents.push(paymentIntentId);
        }
      } catch (captureErr) {
        captureErrors.push({
          payment_intent_id: paymentIntentId,
          error: captureErr.message
        });
        // Продолжаем с остальными даже при ошибке
      }
    }

    // Рассчитываем сумму для transfer
    // MySQL возвращает decimal как строки, поэтому используем parseFloat
    // Теперь все платежи идут только через донаты
    const totalAmount = donations.reduce((sum, d) => sum + Math.round(parseFloat(d.amount) * 100), 0);

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
      return error(res, 'Performer Stripe account not found', 404);
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
      return error(res, 'Error creating transfer', 500, transferErr);
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
    return error(res, 'Error completing request', 500, err);
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
      return error(res, 'user_id is required', 400);
    }

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Insufficient permissions', 403);
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
    return error(res, 'Error retrieving payment history', 500, err);
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
      return error(res, 'user_id is required', 400);
    }

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Insufficient permissions', 403);
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
    return error(res, 'Error retrieving payout history', 500, err);
  }
});

module.exports = router;

