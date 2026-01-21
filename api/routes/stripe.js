const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const stripe = require('../config/stripe');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');

const router = express.Router();

/**
 * POST /api/stripe/create-account
 * Создание Stripe Express Account для волонтёра
 */
router.post('/create-account', authenticate, [
  body('email').isEmail().withMessage('Некорректный email'),
  body('first_name').notEmpty().withMessage('first_name обязателен'),
  body('last_name').notEmpty().withMessage('last_name обязателен'),
  body('phone').optional().isString(),
  body('city').optional().isString(),
  body('country').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, errors.array());
    }

    const { email, first_name, last_name, phone, city, country = 'US' } = req.body;
    
    // Используем user_id из токена (пользователь уже аутентифицирован)
    const user_id = req.user.userId;

    // Проверяем, существует ли уже аккаунт
    const [existingAccounts] = await pool.execute(
      'SELECT * FROM stripe_accounts WHERE user_id = ?',
      [user_id]
    );

    if (existingAccounts.length > 0) {
      const existingAccount = existingAccounts[0];
      // Если аккаунт уже существует, создаем новый Account Link для доонбординга
      try {
        const accountLink = await stripe.accountLinks.create({
          account: existingAccount.account_id,
          refresh_url: process.env.STRIPE_REFRESH_URL || 'https://danilagames.ru/stripeCallback?stripe=refresh',
          return_url: process.env.STRIPE_RETURN_URL || 'https://danilagames.ru/stripeCallback?stripe=success',
          type: 'account_onboarding'
        });

        return success(res, {
          account_id: existingAccount.account_id,
          account_link_url: accountLink.url,
          message: 'Account already exists, onboarding link created'
        }, 'Account link created');
      } catch (err) {
        return error(res, 'Ошибка при создании Account Link', 500, err);
      }
    }

    // Создаем Express Account в Stripe
    let account;
    try {
      account = await stripe.accounts.create({
        type: 'express',
        country: country,
        business_type: 'individual',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        email: email,
        individual: {
          first_name: first_name,
          last_name: last_name,
          email: email,
          phone: phone || undefined,
          address: {
            city: city || undefined,
            country: country
          }
        },
        business_profile: {
          url: `https://joyvee.live/profile/${user_id}`,
          product_description: 'Environmental cleanup volunteer on JoyPick platform',
          mcc: '8398', // Charitable organizations
          support_email: email,
          support_phone: phone || undefined
        },
        metadata: {
          platform: 'joypick',
          account_type: 'volunteer',
          user_id: user_id
        }
      });
    } catch (stripeErr) {
      // Если country не поддерживается, пробуем с US
      if (stripeErr.code === 'account_country_invalid' || stripeErr.message?.includes('country')) {
        try {
          account = await stripe.accounts.create({
            type: 'express',
            country: 'US',
            business_type: 'individual',
            capabilities: {
              card_payments: { requested: true },
              transfers: { requested: true }
            },
            email: email,
            individual: {
              first_name: first_name,
              last_name: last_name,
              email: email,
              phone: phone || undefined,
              address: {
                city: city || undefined,
                country: 'US'
              }
            },
            business_profile: {
              url: `https://joyvee.live/profile/${user_id}`,
              product_description: 'Environmental cleanup volunteer on JoyPick platform',
              mcc: '8398',
              support_email: email,
              support_phone: phone || undefined
            },
            metadata: {
              platform: 'joypick',
              account_type: 'volunteer',
              user_id: user_id
            }
          });
        } catch (retryErr) {
          return error(res, 'Ошибка при создании Stripe аккаунта', 500, retryErr);
        }
      } else {
        return error(res, 'Ошибка при создании Stripe аккаунта', 500, stripeErr);
      }
    }

    // Сохраняем аккаунт в базу данных
    const accountId = generateId();
    await pool.execute(
      `INSERT INTO stripe_accounts (id, user_id, account_id, charges_enabled, payouts_enabled, details_submitted)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        accountId,
        user_id,
        account.id,
        account.charges_enabled || false,
        account.payouts_enabled || false,
        account.details_submitted || false
      ]
    );

    // Создаем Account Link для доонбординга
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: process.env.STRIPE_REFRESH_URL || 'https://danilagames.ru/stripeCallback?stripe=refresh',
      return_url: process.env.STRIPE_RETURN_URL || 'https://danilagames.ru/stripeCallback?stripe=success',
      type: 'account_onboarding'
    });

    return success(res, {
      account_id: account.id,
      account_link_url: accountLink.url,
      message: 'Account created successfully'
    }, 'Account created successfully');

  } catch (err) {
    return error(res, 'Ошибка при создании Stripe аккаунта', 500, err);
  }
});

/**
 * GET /api/stripe/account-status
 * Проверка статуса Stripe аккаунта пользователя
 */
router.get('/account-status', authenticate, async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return error(res, 'user_id обязателен', 400);
    }

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Недостаточно прав', 403);
    }

    // Получаем аккаунт из базы данных
    const [accounts] = await pool.execute(
      'SELECT * FROM stripe_accounts WHERE user_id = ?',
      [user_id]
    );

    if (accounts.length === 0) {
      return success(res, {
        account_id: null,
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        onboarding_complete: false
      }, 'Account not found');
    }

    const dbAccount = accounts[0];

    // Получаем актуальный статус из Stripe
    let stripeAccount;
    try {
      stripeAccount = await stripe.accounts.retrieve(dbAccount.account_id);
    } catch (stripeErr) {
      return error(res, 'Ошибка при получении статуса аккаунта из Stripe', 500, stripeErr);
    }

    // Обновляем статус в базе данных
    await pool.execute(
      `UPDATE stripe_accounts 
       SET charges_enabled = ?, payouts_enabled = ?, details_submitted = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        stripeAccount.charges_enabled || false,
        stripeAccount.payouts_enabled || false,
        stripeAccount.details_submitted || false,
        dbAccount.id
      ]
    );

    const onboardingComplete = stripeAccount.charges_enabled && stripeAccount.payouts_enabled && stripeAccount.details_submitted;

    // Если нужен доонбординг, создаем Account Link
    let accountLinkUrl = null;
    if (!onboardingComplete) {
      try {
        const accountLink = await stripe.accountLinks.create({
          account: dbAccount.account_id,
          refresh_url: process.env.STRIPE_REFRESH_URL || 'https://danilagames.ru/stripeCallback?stripe=refresh',
          return_url: process.env.STRIPE_RETURN_URL || 'https://danilagames.ru/stripeCallback?stripe=success',
          type: 'account_onboarding'
        });
        accountLinkUrl = accountLink.url;
      } catch (linkErr) {
        // Игнорируем ошибку создания ссылки, просто не возвращаем её
      }
    }

    return success(res, {
      account_id: dbAccount.account_id,
      charges_enabled: stripeAccount.charges_enabled || false,
      payouts_enabled: stripeAccount.payouts_enabled || false,
      details_submitted: stripeAccount.details_submitted || false,
      onboarding_complete: onboardingComplete,
      account_link_url: accountLinkUrl
    }, 'Account status retrieved');

  } catch (err) {
    return error(res, 'Ошибка при проверке статуса аккаунта', 500, err);
  }
});

/**
 * POST /api/stripe/webhooks
 * Обработка webhooks от Stripe
 * ВАЖНО: Этот endpoint должен быть доступен без authenticate middleware
 * для получения webhooks от Stripe
 * 
 * КРИТИЧЕСКИ ВАЖНО: Stripe требует HTTPS для webhooks в продакшене
 * На Beget SSL настраивается через панель управления хостингом
 */
router.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  // Проверка HTTPS в продакшене (на Beget обычно работает через прокси)
  // Проверяем либо прямой HTTPS, либо заголовок X-Forwarded-Proto от прокси
  const isProduction = process.env.NODE_ENV === 'production';
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  
  if (isProduction && !isSecure) {
    return error(res, 'Webhook endpoint requires HTTPS in production', 400);
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return error(res, 'Webhook secret не настроен', 500);
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return error(res, `Webhook signature verification failed: ${err.message}`, 400, err);
  }

  try {
    // Обработка различных типов событий
    switch (event.type) {
      case 'account.updated':
        await handleAccountUpdated(event.data.object);
        break;

      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case 'payment_intent.requires_capture':
        await handlePaymentIntentRequiresCapture(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object);
        break;

      case 'payment_intent.canceled':
        await handlePaymentIntentCanceled(event.data.object);
        break;

      case 'transfer.created':
        await handleTransferCreated(event.data.object);
        break;

      case 'transfer.paid':
        await handleTransferPaid(event.data.object);
        break;

      case 'transfer.failed':
        await handleTransferFailed(event.data.object);
        break;

      default:
        // Игнорируем неизвестные события
        break;
    }

    res.json({ received: true });
  } catch (err) {
    return error(res, 'Ошибка при обработке webhook', 500, err);
  }
});

/**
 * Обработка события account.updated
 */
async function handleAccountUpdated(account) {
  const [accounts] = await pool.execute(
    'SELECT * FROM stripe_accounts WHERE account_id = ?',
    [account.id]
  );

  if (accounts.length > 0) {
    await pool.execute(
      `UPDATE stripe_accounts 
       SET charges_enabled = ?, payouts_enabled = ?, details_submitted = ?, updated_at = NOW()
       WHERE account_id = ?`,
      [
        account.charges_enabled || false,
        account.payouts_enabled || false,
        account.details_submitted || false,
        account.id
      ]
    );
  }
}

/**
 * Обработка события payment_intent.requires_capture
 * Автоматически захватываем платеж после подтверждения пользователем
 * Это предотвращает возврат денег через 7 дней
 */
async function handlePaymentIntentRequiresCapture(paymentIntent) {
  try {
    // Проверяем, что это наш PaymentIntent
    const [paymentIntents] = await pool.execute(
      'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
      [paymentIntent.id]
    );

    if (paymentIntents.length === 0) {
      return; // Не наш PaymentIntent
    }

    const paymentIntentData = paymentIntents[0];

    // Обновляем статус в БД
    await pool.execute(
      'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
      ['requires_capture', paymentIntent.id]
    );

    // Автоматически захватываем платеж
    try {
      const capturedPaymentIntent = await stripe.paymentIntents.capture(paymentIntent.id);
      
      // Обновляем статус на succeeded
      await pool.execute(
        'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
        ['succeeded', paymentIntent.id]
      );

      // ВАЖНО: Теперь все платежи идут через донаты (type === 'donation')
      // Для донатов capture уже сделан, статус обновлен, ничего дополнительного не требуется
    } catch (captureErr) {
      // Логируем ошибку capture, но не прерываем выполнение
      console.error('Ошибка автоматического capture PaymentIntent:', captureErr);
      // Статус остается requires_capture, можно попробовать capture позже
    }
  } catch (err) {
    // Логируем ошибку, но не прерываем выполнение
    console.error('Ошибка обработки payment_intent.requires_capture:', err);
  }
}

/**
 * Обработка события payment_intent.succeeded
 */
async function handlePaymentIntentSucceeded(paymentIntent) {
  const [paymentIntents] = await pool.execute(
    'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
    [paymentIntent.id]
  );

  if (paymentIntents.length > 0) {
    await pool.execute(
      'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
      ['succeeded', paymentIntent.id]
    );
  } else {
    // Если payment intent не найден в БД, создаем запись
    const id = generateId();
    await pool.execute(
      `INSERT INTO payment_intents (id, payment_intent_id, user_id, request_id, amount_cents, currency, status, type, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        paymentIntent.id,
        paymentIntent.metadata?.user_id || null,
        paymentIntent.metadata?.request_id || null,
        paymentIntent.amount,
        paymentIntent.currency,
        paymentIntent.status,
        paymentIntent.metadata?.type || 'unknown',
        JSON.stringify(paymentIntent.metadata || {})
      ]
    );
  }

  // ВАЖНО: Теперь все платежи идут через донаты (type === 'donation')
  // Для донатов статус заявки не меняется при успешной оплате
}

/**
 * Обработка события payment_intent.payment_failed
 * Удаляем заявку, если оплата не прошла
 */
async function handlePaymentIntentFailed(paymentIntent) {
  const [paymentIntents] = await pool.execute(
    'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
    [paymentIntent.id]
  );

  if (paymentIntents.length > 0) {
    const paymentIntentData = paymentIntents[0];
    
    // Обновляем статус PaymentIntent
    await pool.execute(
      'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
      ['canceled', paymentIntent.id]
    );

    // ВАЖНО: Теперь все платежи идут через донаты (type === 'donation')
    // Если это донат, удаляем донат и откатываем total_contributed
    if (paymentIntentData.type === 'donation' && paymentIntentData.request_id) {
      await deleteDonationIfFailed(paymentIntentData.payment_intent_id, paymentIntentData.request_id);
    }
  }
}

/**
 * Обработка события payment_intent.canceled
 * Удаляем заявку, если оплата была отменена
 */
async function handlePaymentIntentCanceled(paymentIntent) {
  const [paymentIntents] = await pool.execute(
    'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
    [paymentIntent.id]
  );

  if (paymentIntents.length > 0) {
    const paymentIntentData = paymentIntents[0];
    
    // Обновляем статус PaymentIntent
    await pool.execute(
      'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
      ['canceled', paymentIntent.id]
    );

    // ВАЖНО: Теперь все платежи идут через донаты (type === 'donation')
    // Если это донат, удаляем донат и откатываем total_contributed
    if (paymentIntentData.type === 'donation' && paymentIntentData.request_id) {
      await deleteDonationIfFailed(paymentIntentData.payment_intent_id, paymentIntentData.request_id);
    }
  }
}

/**
 * УДАЛЕН: Функция больше не используется
 * Теперь все платежи идут через донаты, заявки не удаляются автоматически при отмене доната
 * @deprecated Эта функция удалена. Заявки не удаляются автоматически при отмене доната.
 */
async function deleteRequestIfPendingPayment(requestId, reason) {
  // Функция больше не используется - все платежи через донаты
  return;

    // Удаляем ВСЕ чаты заявки
    const { deleteAllChatsForRequest } = require('../utils/chatHelpers');
    await deleteAllChatsForRequest(requestId);

    // Удаляем заявку
    await pool.execute('DELETE FROM requests WHERE id = ?', [requestId]);

    // Отправляем push-уведомление создателю (если есть)
    if (request.created_by) {
      const { sendRequestRejectedNotification } = require('../services/pushNotification');
      try {
        await sendRequestRejectedNotification({
          userIds: [request.created_by],
          requestId: requestId,
          messageType: 'creator',
          rejectionMessage: `Заявка была удалена: ${reason}`,
          requestCategory: request.category || 'wasteLocation', // Получаем категорию из БД
        });
      } catch (notifErr) {
        // Игнорируем ошибки уведомлений
      }
    }
  } catch (err) {
    // Логируем ошибку, но не прерываем выполнение
    console.error('Ошибка при удалении заявки после отмены оплаты:', err);
  }
}

/**
 * Обработка события transfer.created
 */
async function handleTransferCreated(transfer) {
  // Transfer уже должен быть в БД, просто обновляем статус если нужно
  const [transfers] = await pool.execute(
    'SELECT * FROM transfers WHERE transfer_id = ?',
    [transfer.id]
  );

  if (transfers.length === 0) {
    // Если transfer не найден, создаем запись
    const id = generateId();
    await pool.execute(
      `INSERT INTO transfers (id, transfer_id, request_id, performer_user_id, amount_cents, platform_fee_cents, stripe_fee_cents, currency, status, source_payment_intent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        transfer.id,
        transfer.metadata?.request_id || null,
        transfer.metadata?.performer_user_id || null,
        transfer.amount,
        0, // platform_fee_cents будет обновлен позже
        0, // stripe_fee_cents будет обновлен позже
        transfer.currency,
        'pending',
        transfer.source_transaction || null
      ]
    );
  }
}

/**
 * Обработка события transfer.paid
 */
async function handleTransferPaid(transfer) {
  await pool.execute(
    'UPDATE transfers SET status = ?, updated_at = NOW() WHERE transfer_id = ?',
    ['paid', transfer.id]
  );

  // Отправляем push-уведомление волонтёру
  const [transfers] = await pool.execute(
    'SELECT performer_user_id FROM transfers WHERE transfer_id = ?',
    [transfer.id]
  );

  if (transfers.length > 0) {
    const { sendTransferPaidNotification } = require('../services/pushNotification');
    try {
      await sendTransferPaidNotification({
        userIds: [transfers[0].performer_user_id],
        transferId: transfer.id,
        amountCents: transfer.amount
      });
    } catch (notifErr) {
      // Игнорируем ошибки уведомлений
    }
  }
}

/**
 * Обработка события transfer.failed
 */
async function handleTransferFailed(transfer) {
  await pool.execute(
    'UPDATE transfers SET status = ?, updated_at = NOW() WHERE transfer_id = ?',
    ['failed', transfer.id]
  );

  // Отправляем push-уведомление волонтёру об ошибке
  const [transfers] = await pool.execute(
    'SELECT performer_user_id FROM transfers WHERE transfer_id = ?',
    [transfer.id]
  );

  if (transfers.length > 0) {
    const { sendTransferFailedNotification } = require('../services/pushNotification');
    try {
      await sendTransferFailedNotification({
        userIds: [transfers[0].performer_user_id],
        transferId: transfer.id
      });
    } catch (notifErr) {
      // Игнорируем ошибки уведомлений
    }
  }
}

/**
 * Удаляет донат при ошибке/отмене оплаты
 * Откатывает total_contributed в заявке
 */
async function deleteDonationIfFailed(paymentIntentId, requestId) {
  try {
    // Находим донат по payment_intent_id
    const [donations] = await pool.execute(
      'SELECT id, amount FROM donations WHERE payment_intent_id = ?',
      [paymentIntentId]
    );

    if (donations.length === 0) {
      return; // Донат уже удален или не найден
    }

    const donation = donations[0];

    // Откатываем total_contributed в заявке
    const [requests] = await pool.execute(
      'SELECT total_contributed FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length > 0) {
      const currentTotal = parseFloat(requests[0].total_contributed || 0);
      const newTotal = Math.max(0, currentTotal - parseFloat(donation.amount)); // Не может быть отрицательным
      
      await pool.execute(
        'UPDATE requests SET total_contributed = ?, updated_at = NOW() WHERE id = ?',
        [newTotal, requestId]
      );
    }

    // Удаляем донат
    await pool.execute('DELETE FROM donations WHERE id = ?', [donation.id]);
  } catch (err) {
    // Логируем ошибку, но не прерываем выполнение
    console.error('Ошибка при удалении доната после отмены оплаты:', err);
  }
}

module.exports = router;

