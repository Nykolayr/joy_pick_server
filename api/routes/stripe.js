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
  body('email').isEmail().withMessage('Invalid email'),
  body('first_name').notEmpty().withMessage('first_name is required'),
  body('last_name').notEmpty().withMessage('last_name is required'),
  body('phone').optional().isString(),
  body('city').optional().isString(),
  body('country').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Validation error', 400, errors.array());
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
        return error(res, 'Error creating Account Link', 500, err);
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
        settings: {
          payouts: {
            schedule: {
              interval: 'daily' // Ежедневные выплаты по умолчанию
            }
          }
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
            settings: {
              payouts: {
                schedule: {
                  interval: 'daily' // Ежедневные выплаты по умолчанию
                }
              }
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
          return error(res, 'Error creating Stripe account', 500, retryErr);
        }
      } else {
        return error(res, 'Error creating Stripe account', 500, stripeErr);
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
    return error(res, 'Error creating Stripe account', 500, err);
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
      return error(res, 'user_id is required', 400);
    }

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Insufficient permissions', 403);
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
      return error(res, 'Error retrieving account status from Stripe', 500, stripeErr);
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
    return error(res, 'Error checking account status', 500, err);
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

      case 'payout.created':
        await handlePayoutCreated(event.data.object);
        break;

      case 'payout.paid':
        await handlePayoutPaid(event.data.object);
        break;

      case 'payout.failed':
        await handlePayoutFailed(event.data.object);
        break;

      default:
        // Игнорируем неизвестные события
        break;
    }

    res.json({ received: true });
  } catch (err) {
    return error(res, 'Error processing webhook', 500, err);
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
 * Обработка события payout.created
 */
async function handlePayoutCreated(payout) {
  // Проверяем, есть ли уже этот payout в БД
  const [existingPayouts] = await pool.execute(
    'SELECT id FROM instant_payouts WHERE payout_id = ?',
    [payout.id]
  );

  if (existingPayouts.length === 0 && payout.method === 'instant') {
    // Получаем user_id из metadata или связанного аккаунта
    let userId = null;
    
    // Пытаемся найти пользователя по stripe_account_id
    const [accounts] = await pool.execute(
      'SELECT user_id FROM stripe_accounts WHERE account_id = ?',
      [payout.destination || '']
    );
    
    if (accounts.length > 0) {
      userId = accounts[0].user_id;
      
      // Создаем запись в БД
      const payoutId = generateId();
      await pool.execute(
        `INSERT INTO instant_payouts (id, user_id, stripe_account_id, payout_id, amount_cents, currency, status, external_account_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          payoutId,
          userId,
          payout.destination,
          payout.id,
          payout.amount,
          payout.currency,
          payout.status,
          payout.destination || null
        ]
      );
    }
  }
}

/**
 * Обработка события payout.paid
 */
async function handlePayoutPaid(payout) {
  await pool.execute(
    'UPDATE instant_payouts SET status = ?, arrival_date = FROM_UNIXTIME(?), updated_at = NOW() WHERE payout_id = ?',
    ['paid', payout.arrival_date, payout.id]
  );

  // Отправляем push-уведомление пользователю
  const [payouts] = await pool.execute(
    'SELECT user_id, amount_cents FROM instant_payouts WHERE payout_id = ?',
    [payout.id]
  );

  if (payouts.length > 0) {
    const { sendPayoutNotification } = require('../services/pushNotification');
    try {
      await sendPayoutNotification({
        userId: payouts[0].user_id,
        payoutId: payout.id,
        amount: (payouts[0].amount_cents / 100).toFixed(2),
        status: 'paid'
      });
    } catch (notifErr) {
      console.error('❌ Ошибка отправки push-уведомления при выплате:', notifErr);
    }
  }
}

/**
 * Обработка события payout.failed
 */
async function handlePayoutFailed(payout) {
  await pool.execute(
    `UPDATE instant_payouts 
     SET status = ?, failure_code = ?, failure_message = ?, updated_at = NOW() 
     WHERE payout_id = ?`,
    ['failed', payout.failure_code, payout.failure_message, payout.id]
  );

  // Отправляем push-уведомление об ошибке
  const [payouts] = await pool.execute(
    'SELECT user_id, amount_cents FROM instant_payouts WHERE payout_id = ?',
    [payout.id]
  );

  if (payouts.length > 0) {
    const { sendPayoutNotification } = require('../services/pushNotification');
    try {
      await sendPayoutNotification({
        userId: payouts[0].user_id,
        payoutId: payout.id,
        amount: (payouts[0].amount_cents / 100).toFixed(2),
        status: 'failed',
        failureCode: payout.failure_code,
        failureMessage: payout.failure_message
      });
    } catch (notifErr) {
      console.error('❌ Ошибка отправки push-уведомления при ошибке выплаты:', notifErr);
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

// ============================================================================
// УПРАВЛЕНИЕ PAYOUT НАСТРОЙКАМИ
// ============================================================================

/**
 * GET /api/stripe/payout-methods/:user_id
 * Получение доступных методов выплат для пользователя
 */
router.get('/payout-methods/:user_id', authenticate, async (req, res) => {
  try {
    const { user_id } = req.params;

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Insufficient permissions', 403);
    }

    // Получаем Stripe аккаунт пользователя
    const [accounts] = await pool.execute(
      'SELECT account_id FROM stripe_accounts WHERE user_id = ?',
      [user_id]
    );

    if (accounts.length === 0) {
      return error(res, 'Stripe account not found', 404);
    }

    const accountId = accounts[0].account_id;

    // Получаем информацию об аккаунте из Stripe
    const stripeAccount = await stripe.accounts.retrieve(accountId);
    
    // Получаем external accounts (банковские счета и карты)
    const externalAccounts = await stripe.accounts.listExternalAccounts(accountId, {
      limit: 100
    });

    // Проверяем возможности instant payout
    const hasInstantPayoutCapability = stripeAccount.capabilities?.transfers === 'active';
    
    // Получаем настройки payout
    const payoutSettings = {
      schedule: stripeAccount.settings?.payouts?.schedule || null,
      statement_descriptor: stripeAccount.settings?.payouts?.statement_descriptor || null,
      debit_negative_balances: stripeAccount.settings?.payouts?.debit_negative_balances || false
    };

    // Форматируем external accounts
    const formattedAccounts = externalAccounts.data.map(account => ({
      id: account.id,
      object: account.object, // 'bank_account' или 'card'
      type: account.object === 'card' ? 'debit_card' : 'bank_account',
      last4: account.last4,
      brand: account.brand || null, // Для карт
      bank_name: account.bank_name || null, // Для банковских счетов
      currency: account.currency,
      country: account.country,
      default_for_currency: account.default_for_currency,
      status: account.status || 'new',
      available_payout_methods: account.available_payout_methods || []
    }));

    return success(res, {
      account_id: accountId,
      instant_payout_available: hasInstantPayoutCapability,
      payout_settings: payoutSettings,
      external_accounts: formattedAccounts,
      can_add_debit_card: stripeAccount.country === 'US', // Instant payout в основном для US
      onboarding_complete: stripeAccount.charges_enabled && stripeAccount.payouts_enabled
    });

  } catch (stripeErr) {
    return error(res, 'Error retrieving payout methods', 500, {
      stripe_error: stripeErr.message,
      error_type: stripeErr.type,
      error_code: stripeErr.code
    });
  }
});

/**
 * POST /api/stripe/instant-payout
 * Создание мгновенной выплаты на дебетовую карту
 */
router.post('/instant-payout', authenticate, [
  body('user_id').notEmpty().withMessage('user_id is required'),
  body('amount').isFloat({ min: 1 }).withMessage('Minimum 1 dollar'),
  body('external_account_id').optional().isString().withMessage('External account ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Validation error', 400, errors.array());
    }

    const { user_id, amount, external_account_id } = req.body;

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Insufficient permissions', 403);
    }

    // Получаем Stripe аккаунт пользователя
    const [accounts] = await pool.execute(
      'SELECT account_id FROM stripe_accounts WHERE user_id = ?',
      [user_id]
    );

    if (accounts.length === 0) {
      return error(res, 'Stripe account not found', 404);
    }

    const accountId = accounts[0].account_id;

    // Конвертируем в центы
    const amountCents = Math.round(parseFloat(amount) * 100);

    // Создаем instant payout
    const payoutParams = {
      amount: amountCents,
      currency: 'usd',
      method: 'instant'
    };

    // Если указан конкретный external account
    if (external_account_id) {
      payoutParams.destination = external_account_id;
    }

    const payout = await stripe.payouts.create(payoutParams, {
      stripeAccount: accountId
    });

    // Сохраняем информацию о payout в БД (опционально)
    const payoutId = generateId();
    await pool.execute(
      `INSERT INTO instant_payouts (id, user_id, stripe_account_id, payout_id, amount_cents, currency, status, external_account_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        payoutId,
        user_id,
        accountId,
        payout.id,
        amountCents,
        'usd',
        payout.status,
        external_account_id || null
      ]
    );

    return success(res, {
      payout_id: payout.id,
      amount_cents: amountCents,
      amount_dollars: amount,
      status: payout.status,
      arrival_date: payout.arrival_date,
      method: payout.method,
      external_account_id: external_account_id,
      message: 'Instant payout created successfully'
    });

  } catch (stripeErr) {
    return error(res, 'Error creating instant payout', 500, {
      stripe_error: stripeErr.message,
      error_type: stripeErr.type,
      error_code: stripeErr.code,
      decline_code: stripeErr.decline_code || null
    });
  }
});

/**
 * PUT /api/stripe/payout-schedule/:user_id
 * Обновление расписания выплат для пользователя
 */
router.put('/payout-schedule/:user_id', authenticate, [
  body('interval').isIn(['manual', 'daily', 'weekly', 'monthly']).withMessage('Invalid interval'),
  body('delay_days').optional().isInt({ min: 0, max: 365 }).withMessage('delay_days must be between 0 and 365')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Validation error', 400, errors.array());
    }

    const { user_id } = req.params;
    const { interval, delay_days } = req.body;

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Insufficient permissions', 403);
    }

    // Получаем Stripe аккаунт пользователя
    const [accounts] = await pool.execute(
      'SELECT account_id FROM stripe_accounts WHERE user_id = ?',
      [user_id]
    );

    if (accounts.length === 0) {
      return error(res, 'Stripe account not found', 404);
    }

    const accountId = accounts[0].account_id;

    // Обновляем настройки payout в Stripe
    const updateData = {
      settings: {
        payouts: {
          schedule: {
            interval: interval
          }
        }
      }
    };

    // Добавляем delay_days если указан и интервал не manual
    if (delay_days !== undefined && interval !== 'manual') {
      updateData.settings.payouts.schedule.delay_days = delay_days;
    }

    const updatedAccount = await stripe.accounts.update(accountId, updateData);

    return success(res, {
      account_id: accountId,
      payout_schedule: updatedAccount.settings.payouts.schedule,
      message: 'Payout schedule updated successfully'
    });

  } catch (stripeErr) {
    return error(res, 'Error updating payout schedule', 500, {
      stripe_error: stripeErr.message,
      error_type: stripeErr.type,
      error_code: stripeErr.code
    });
  }
});

/**
 * GET /api/stripe/instant-payouts/:user_id
 * Получение истории мгновенных выплат пользователя
 */
router.get('/instant-payouts/:user_id', authenticate, async (req, res) => {
  try {
    const { user_id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Insufficient permissions', 403);
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Получаем instant payouts из БД
    const [payouts] = await pool.execute(
      `SELECT * FROM instant_payouts 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [user_id, limitNum, offset]
    );

    // Получаем общее количество
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM instant_payouts WHERE user_id = ?',
      [user_id]
    );
    const total = countResult[0]?.total || 0;

    // Получаем актуальную информацию из Stripe для последних payouts
    const detailedPayouts = await Promise.all(
      payouts.map(async (payout) => {
        try {
          // Получаем Stripe аккаунт
          const stripePayout = await stripe.payouts.retrieve(payout.payout_id, {
            stripeAccount: payout.stripe_account_id
          });

          return {
            id: payout.id,
            payout_id: payout.payout_id,
            amount_cents: payout.amount_cents,
            amount_dollars: (payout.amount_cents / 100).toFixed(2),
            currency: payout.currency,
            status: stripePayout.status, // Актуальный статус из Stripe
            method: stripePayout.method,
            external_account_id: payout.external_account_id,
            failure_code: stripePayout.failure_code || payout.failure_code,
            failure_message: stripePayout.failure_message || payout.failure_message,
            arrival_date: stripePayout.arrival_date,
            created_at: payout.created_at,
            stripe_data: {
              automatic: stripePayout.automatic,
              balance_transaction: stripePayout.balance_transaction,
              description: stripePayout.description
            }
          };
        } catch (stripeErr) {
          // Если не можем получить из Stripe, возвращаем данные из БД
          return {
            id: payout.id,
            payout_id: payout.payout_id,
            amount_cents: payout.amount_cents,
            amount_dollars: (payout.amount_cents / 100).toFixed(2),
            currency: payout.currency,
            status: payout.status,
            method: 'instant',
            external_account_id: payout.external_account_id,
            failure_code: payout.failure_code,
            failure_message: payout.failure_message,
            arrival_date: payout.arrival_date,
            created_at: payout.created_at,
            stripe_error: stripeErr.message
          };
        }
      })
    );

    return success(res, {
      payouts: detailedPayouts,
      total: total,
      page: pageNum,
      limit: limitNum,
      has_more: total > (pageNum * limitNum)
    });

  } catch (err) {
    return error(res, 'Error retrieving instant payout history', 500, err);
  }
});

/**
 * GET /api/stripe/balance/:user_id
 * Получение доступного баланса пользователя для выплат
 */
router.get('/balance/:user_id', authenticate, async (req, res) => {
  try {
    const { user_id } = req.params;

    // Проверяем права доступа
    if (req.user.userId !== user_id && !req.user.isAdmin) {
      return error(res, 'Insufficient permissions', 403);
    }

    // Получаем Stripe аккаунт пользователя
    const [accounts] = await pool.execute(
      'SELECT account_id, payouts_enabled FROM stripe_accounts WHERE user_id = ?',
      [user_id]
    );

    if (accounts.length === 0) {
      return error(res, 'Stripe account not found', 404);
    }

    const { account_id: accountId, payouts_enabled: payoutsEnabled } = accounts[0];

    // Получаем баланс из Stripe
    let stripeBalance = null;
    try {
      const balance = await stripe.balance.retrieve({
        stripeAccount: accountId
      });

      stripeBalance = {
        available: balance.available.map(b => ({
          amount: b.amount, // в центах
          amount_dollars: (b.amount / 100).toFixed(2),
          currency: b.currency
        })),
        pending: balance.pending.map(b => ({
          amount: b.amount, // в центах  
          amount_dollars: (b.amount / 100).toFixed(2),
          currency: b.currency
        }))
      };
    } catch (stripeErr) {
      return error(res, 'Error retrieving balance from Stripe', 500, {
        stripe_error: stripeErr.message,
        error_type: stripeErr.type,
        error_code: stripeErr.code
      });
    }

    // Получаем информацию о последних выплатах
    const [recentPayouts] = await pool.execute(
      `SELECT * FROM instant_payouts 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT 5`,
      [user_id]
    );

    // Получаем настройки payout расписания
    const stripeAccount = await stripe.accounts.retrieve(accountId);
    const payoutSchedule = stripeAccount.settings?.payouts?.schedule || null;

    return success(res, {
      account_id: accountId,
      payouts_enabled: payoutsEnabled,
      balance: stripeBalance,
      payout_schedule: payoutSchedule,
      recent_payouts: recentPayouts.map(p => ({
        id: p.id,
        amount_dollars: (p.amount_cents / 100).toFixed(2),
        status: p.status,
        created_at: p.created_at
      })),
      can_instant_payout: payoutsEnabled && stripeBalance?.available?.some(b => b.amount > 100) // минимум $1
    });

  } catch (err) {
    return error(res, 'Error retrieving balance', 500, err);
  }
});

module.exports = router;

