const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const stripe = require('../config/stripe.js');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');

const router = express.Router();

/** Origin публичного сайта без завершающего слеша (для Stripe redirect, если не заданы STRIPE_*_URL). */
function publicSiteOrigin() {
  return (process.env.BASE_URL || process.env.APP_URL || 'https://joypick.world').replace(/\/+$/, '');
}

function defaultStripeRefreshUrl() {
  return `${publicSiteOrigin()}/stripeCallback?stripe=refresh`;
}

function defaultStripeReturnUrl() {
  return `${publicSiteOrigin()}/stripeCallback?stripe=success`;
}

/**
 * Страна для Stripe Connect: только ISO 3166-1 alpha-2, без дефолта US.
 * Пустая строка из клиента считается как «не передано».
 * @param {unknown} raw
 * @returns {{ ok: true, country: string } | { ok: false, reason: 'missing' | 'invalid' }}
 */
function normalizeConnectCountry(raw) {
  if (raw == null) return { ok: false, reason: 'missing' };
  const s = String(raw).trim().toUpperCase();
  if (s.length === 0) return { ok: false, reason: 'missing' };
  if (!/^[A-Z]{2}$/.test(s)) return { ok: false, reason: 'invalid' };
  return { ok: true, country: s };
}

/** Человекочитаемое название страны (ISO2) для сообщений в UI, напр. «Бельгия (BE)». */
function connectCountryLabelRu(iso2) {
  const code = String(iso2 || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return code || '—';
  try {
    const dn = new Intl.DisplayNames(['ru'], { type: 'region' });
    const name = dn.of(code);
    if (name && name !== code) return `${name} (${code})`;
  } catch {
    // ignore
  }
  return code;
}

/**
 * ITU-коды (без +) для сборки E.164, если клиент прислал национальный номер без префикса.
 * Нет в карте и нет «+» в номере — телефон в Stripe не передаём (онбординг сам не подставляет страну под телефон).
 */
const COUNTRY_DIAL_CODES = {
  US: '1',
  CA: '1',
  GB: '44',
  IE: '353',
  DE: '49',
  FR: '33',
  BE: '32',
  NL: '31',
  LU: '352',
  AT: '43',
  CH: '41',
  IT: '39',
  ES: '34',
  PT: '351',
  GR: '30',
  PL: '48',
  CZ: '420',
  SK: '421',
  HU: '36',
  RO: '40',
  BG: '359',
  HR: '385',
  SI: '386',
  EE: '372',
  LV: '371',
  LT: '370',
  FI: '358',
  SE: '46',
  NO: '47',
  DK: '45',
  IS: '354',
  MT: '356',
  CY: '357',
  AM: '374',
  UA: '380',
  MD: '373',
  GE: '995',
  AZ: '994',
  TR: '90',
  RU: '7',
  BY: '375',
  RS: '381',
  BA: '387',
  ME: '382',
  MK: '389',
  AL: '355',
  IL: '972',
  AE: '971',
  SA: '966',
  IN: '91',
  CN: '86',
  JP: '81',
  KR: '82',
  AU: '61',
  NZ: '64',
  BR: '55',
  MX: '52',
  AR: '54',
  CL: '56',
  CO: '57',
  PE: '51',
  ZA: '27',
  EG: '20',
  NG: '234',
  KE: '254',
  KZ: '7'
};

/**
 * @param {string} countryIso2
 * @param {unknown} rawPhone
 * @returns {string|undefined}
 */
function normalizePhoneE164(countryIso2, rawPhone) {
  if (rawPhone == null) return undefined;
  const raw = String(rawPhone).trim();
  if (!raw) return undefined;
  if (raw.startsWith('+')) {
    const digits = raw.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : undefined;
  }
  const cc = String(countryIso2 || '').toUpperCase();
  const dial = COUNTRY_DIAL_CODES[cc];
  if (!dial) return undefined;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return undefined;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '') || '';
  if (!digits) return undefined;
  if (digits.startsWith(dial)) return `+${digits}`;
  return `+${dial}${digits}`;
}

/**
 * Телефон для Connect: полный E.164 или, если клиент не прислал номер, хотя бы «+код» по country
 * (чтобы в hosted onboarding не подставлялся +1 платформы). Если Stripe отклонит «только код» — см. retry в create-account.
 * @returns {{ phoneE164: string|undefined, phoneDialOnlyPlaceholder: boolean }}
 */
function phoneForStripeConnect(countryIso2, rawPhone) {
  const rawTrim = String(rawPhone ?? '').trim();
  const normalized = normalizePhoneE164(countryIso2, rawPhone);
  if (normalized) {
    return { phoneE164: normalized, phoneDialOnlyPlaceholder: false };
  }
  if (rawTrim) {
    return { phoneE164: undefined, phoneDialOnlyPlaceholder: false };
  }
  const dial = COUNTRY_DIAL_CODES[String(countryIso2 || '').toUpperCase()];
  if (!dial) {
    return { phoneE164: undefined, phoneDialOnlyPlaceholder: false };
  }
  return { phoneE164: `+${dial}`, phoneDialOnlyPlaceholder: true };
}

/**
 * Подтягивает телефон (E.164 или «+код») в уже существующий connected account перед Account Link,
 * чтобы hosted onboarding не оставлял дефолт платформы (+1).
 * @returns {Promise<{ phoneOmittedAfterStripeReject: boolean }>}
 */
async function syncConnectPhoneToExistingStripeAccount(accountId, countryIso2, rawPhone) {
  const { phoneE164, phoneDialOnlyPlaceholder } = phoneForStripeConnect(countryIso2, rawPhone);
  let phoneOmittedAfterStripeReject = false;
  if (!phoneE164) {
    return { phoneOmittedAfterStripeReject };
  }
  const payloadWithPhone = {
    individual: { phone: phoneE164 },
    business_profile: { support_phone: phoneE164 }
  };
  try {
    await stripe.accounts.update(accountId, payloadWithPhone);
  } catch (e) {
    const msg = String(e.message || '');
    const phoneReject =
      phoneDialOnlyPlaceholder &&
      (/phone/i.test(msg) || /phone/i.test(String(e.param || '')));
    if (phoneReject) {
      phoneOmittedAfterStripeReject = true;
    } else {
      // Не блокируем выдачу ссылки онбординга из‑за второстепенного update
      console.error('[stripe/create-account] accounts.update (phone) failed:', e?.message || e);
    }
  }
  return { phoneOmittedAfterStripeReject };
}

/**
 * Обновляет кэш статуса Stripe в таблице users.
 * Вызывать при GET account-status и по вебхуку account.updated.
 * @param {string} userId - ID пользователя
 * @param {object|null} stripeAccount - объект аккаунта из Stripe или null (нет аккаунта)
 */
async function updateUserStripeStatusCache(userId, stripeAccount) {
  try {
    if (!stripeAccount) {
      await pool.execute(
        `UPDATE users SET stripe_account_status = 'none', stripe_status_label = ?, can_donate = 0, can_receive_payouts = 0, stripe_status_updated_at = NOW() WHERE id = ?`,
        ['No Stripe account', userId]
      );
      return;
    }
    const chargesEnabled = !!stripeAccount.charges_enabled;
    const payoutsEnabled = !!stripeAccount.payouts_enabled;
    const detailsSubmitted = !!stripeAccount.details_submitted;
    const complete = chargesEnabled && payoutsEnabled && detailsSubmitted;
    const stripe_account_status = complete ? 'complete' : 'incomplete';
    const stripe_status_label = complete
      ? 'Stripe account active — you can receive payouts'
      : 'Stripe account incomplete — complete setup to receive payouts';
    await pool.execute(
      `UPDATE users SET stripe_account_status = ?, stripe_status_label = ?, can_donate = ?, can_receive_payouts = ?, stripe_status_updated_at = NOW() WHERE id = ?`,
      [stripe_account_status, stripe_status_label, chargesEnabled ? 1 : 0, payoutsEnabled ? 1 : 0, userId]
    );
  } catch (e) {
    // не прерываем основной поток
  }
}

/**
 * Обновляет кэш статуса Stripe в users по актуальным данным из Stripe API.
 * Вызывать при GET /auth/me, чтобы в ответе всегда был актуальный статус.
 * @param {string} userId - ID пользователя
 * @returns {Promise<boolean>} true если кэш обновлён, false если аккаунта нет или ошибка
 */
async function refreshUserStripeStatusIfNeeded(userId) {
  try {
    const [rows] = await pool.execute('SELECT account_id FROM stripe_accounts WHERE user_id = ?', [userId]);
    if (rows.length === 0) return false;
    const accountId = rows[0].account_id;
    const account = await stripe.accounts.retrieve(accountId);
    await updateUserStripeStatusCache(userId, account);
    return true;
  } catch (e) {
    return false;
  }
}

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

    const { email, first_name, last_name, phone, city } = req.body;

    const countryNorm = normalizeConnectCountry(req.body.country);
    if (!countryNorm.ok) {
      const code = countryNorm.reason === 'missing' ? 'STRIPE_COUNTRY_REQUIRED' : 'STRIPE_COUNTRY_INVALID';
      const message = countryNorm.reason === 'missing'
        ? 'country is required (ISO 3166-1 alpha-2, e.g. BR, US)'
        : 'country must be exactly 2 letters (ISO 3166-1 alpha-2)';
      return error(res, message, 400, { code });
    }
    const country = countryNorm.country;
    const { phoneE164, phoneDialOnlyPlaceholder } = phoneForStripeConnect(country, phone);

    // Используем user_id из токена (пользователь уже аутентифицирован)
    const user_id = req.user.userId;

    // Проверяем, существует ли уже аккаунт
    const [existingAccounts] = await pool.execute(
      'SELECT * FROM stripe_accounts WHERE user_id = ?',
      [user_id]
    );

    if (existingAccounts.length > 0) {
      const existingAccount = existingAccounts[0];
      let remoteAccount;
      try {
        remoteAccount = await stripe.accounts.retrieve(existingAccount.account_id);
      } catch (e) {
        return error(res, 'Cannot load existing Stripe account', 500, e);
      }
      const stripeCountry = String(remoteAccount.country || '').toUpperCase();
      if (stripeCountry === country) {
        try {
          const { phoneOmittedAfterStripeReject } = await syncConnectPhoneToExistingStripeAccount(
            existingAccount.account_id,
            country,
            phone
          );

          const accountLink = await stripe.accountLinks.create({
            account: existingAccount.account_id,
            refresh_url: process.env.STRIPE_REFRESH_URL || defaultStripeRefreshUrl(),
            return_url: process.env.STRIPE_RETURN_URL || defaultStripeReturnUrl(),
            type: 'account_onboarding'
          });

          const extraExisting = {};
          if (phoneOmittedAfterStripeReject) {
            extraExisting.stripe_onboarding_phone_hint =
              'Платёжная система не приняла номер только с кодом страны — в форме Stripe выберите код страны и введите полный номер.';
          } else if (phoneDialOnlyPlaceholder) {
            extraExisting.stripe_onboarding_phone_hint =
              'Передан код страны для телефона — в форме Stripe допишите остальные цифры номера.';
          } else if (!phoneE164) {
            extraExisting.stripe_onboarding_phone_hint =
              'Для выбранной страны нет кода в справочнике сервера — в Stripe вручную выберите код страны в поле телефона.';
          }

          return success(res, {
            account_id: existingAccount.account_id,
            account_link_url: accountLink.url,
            message: 'Account already exists, onboarding link created',
            ...extraExisting
          }, 'Account link created');
        } catch (err) {
          return error(res, 'Error creating Account Link', 500, err);
        }
      }

      // Страна в приложении другая, чем у уже созданного acct_*: пересоздаём Connect с нужной страной
      // (страну нельзя сменить в onboarding — только новый accounts.create).
      try {
        await stripe.accounts.del(existingAccount.account_id);
      } catch (delErr) {
        return error(
          res,
          delErr.message || 'Could not remove previous Stripe account for new country',
          409,
          { code: 'STRIPE_ACCOUNT_COUNTRY_RESET_FAILED', stripeCountry, requestedCountry: country }
        );
      }
      try {
        await pool.execute('DELETE FROM stripe_accounts WHERE user_id = ?', [user_id]);
        await pool.execute('UPDATE users SET stripe_id = NULL WHERE id = ?', [user_id]);
      } catch (dbErr) {
        return error(res, 'Failed to unlink Stripe account after delete', 500, dbErr);
      }
      await updateUserStripeStatusCache(user_id, null);
      // не return — ниже создаём новый accounts.create с [country]
    }

    const buildAccountCreateParams = (recipientMode, includePhoneFields = true) => {
      const withPhone = !!(includePhoneFields && phoneE164);
      return {
        country,
        business_type: 'individual',
        controller: {
          fees: { payer: 'application' },
          losses: { payments: 'application' },
          stripe_dashboard: { type: 'express' }
        },
        capabilities: recipientMode
          ? { transfers: { requested: true } }
          : {
              card_payments: { requested: true },
              transfers: { requested: true }
            },
        ...(recipientMode ? { tos_acceptance: { service_agreement: 'recipient' } } : {}),
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
          ...(withPhone ? { phone: phoneE164 } : {}),
          address: {
            city: city || undefined,
            country
          }
        },
        business_profile: {
          url: `${publicSiteOrigin()}/profile/${user_id}`,
          product_description: 'Environmental cleanup volunteer on JoyPick platform',
          mcc: '8398', // Charitable organizations
          support_email: email,
          ...(withPhone ? { support_phone: phoneE164 } : {})
        },
        metadata: {
          platform: 'joypick',
          account_type: 'volunteer',
          user_id: user_id
        }
      };
    };

    let account;
    let phoneOmittedAfterStripeReject = false;
    const createAccountWithOptionalPhoneRetry = async (recipientMode) => {
      try {
        return await stripe.accounts.create(buildAccountCreateParams(recipientMode, true));
      } catch (e) {
        const msg = String(e.message || '');
        const phoneReject =
          phoneDialOnlyPlaceholder
          && (/phone/i.test(msg) || /phone/i.test(String(e.param || '')));
        if (phoneReject) {
          phoneOmittedAfterStripeReject = true;
          return await stripe.accounts.create(buildAccountCreateParams(recipientMode, false));
        }
        throw e;
      }
    };

    try {
      // Сначала обычный Express: card_payments + transfers (так для BE, EU и большинства стран).
      // Только если Stripe запрещает card_payments для этой страны (как AM) — второй вызов: transfers + recipient.
      try {
        account = await createAccountWithOptionalPhoneRetry(false);
      } catch (firstErr) {
        const msg0 = String(firstErr.message || '');
        const cardPaymentsBlocked =
          firstErr?.param === 'requested_capabilities'
          && /card_payments/i.test(msg0)
          && (/cannot request/i.test(msg0) || /You cannot request/i.test(msg0));
        if (!cardPaymentsBlocked) throw firstErr;
        account = await createAccountWithOptionalPhoneRetry(true);
      }
    } catch (stripeErr) {
      const isCountry = stripeErr?.code === 'account_country_invalid'
        || String(stripeErr?.message || '').toLowerCase().includes('country');
      if (isCountry) {
        return error(res, stripeErr.message || 'Stripe rejected this country for Connect', 400, {
          code: 'STRIPE_COUNTRY_NOT_SUPPORTED',
          stripeCode: stripeErr.code
        });
      }
      if (stripeErr?.param === 'requested_capabilities') {
        const msg = String(stripeErr.message || '');
        if (/needs approval/i.test(msg) && /transfers/i.test(msg) && /card_payments/i.test(msg)) {
          const label = connectCountryLabelRu(country);
          return error(
            res,
            `Подключение счёта для выплат (${label}) сейчас недоступно. Напишите в поддержку приложения — подскажем, что делать дальше.`,
            403,
            {
              code: 'STRIPE_PLATFORM_TRANSFERS_ONLY_APPROVAL',
              country
            }
          );
        }
        return error(res, stripeErr.message || 'Stripe rejected requested capabilities for this country', 400, {
          code: 'STRIPE_CONNECT_CAPABILITIES',
          stripeCode: stripeErr.code,
          param: stripeErr.param
        });
      }
      return error(res, 'Error creating Stripe account', 500, stripeErr);
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
      refresh_url: process.env.STRIPE_REFRESH_URL || defaultStripeRefreshUrl(),
      return_url: process.env.STRIPE_RETURN_URL || defaultStripeReturnUrl(),
      type: 'account_onboarding'
    });

    const extra = {};
    if (phoneOmittedAfterStripeReject) {
      extra.stripe_onboarding_phone_hint =
        'Платёжная система не приняла номер только с кодом страны — в форме Stripe выберите код страны и введите полный номер.';
    } else if (phoneDialOnlyPlaceholder) {
      extra.stripe_onboarding_phone_hint =
        'Передан код страны для телефона — в форме Stripe допишите остальные цифры номера.';
    } else if (!phoneE164) {
      extra.stripe_onboarding_phone_hint =
        'Для выбранной страны нет кода в справочнике сервера — в Stripe вручную выберите код страны в поле телефона.';
    }
    return success(res, {
      account_id: account.id,
      account_link_url: accountLink.url,
      ...extra
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
      await updateUserStripeStatusCache(user_id, null);
      return success(res, {
        account_id: null,
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        onboarding_complete: false,
        stripe_account_status: 'none',
        stripe_status_label: 'No Stripe account',
        can_donate: false,
        can_receive_payouts: false
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

    const chargesEnabled = !!stripeAccount.charges_enabled;
    const payoutsEnabled = !!stripeAccount.payouts_enabled;
    const detailsSubmitted = !!stripeAccount.details_submitted;
    const onboardingComplete = chargesEnabled && payoutsEnabled && detailsSubmitted;

    const stripe_account_status = onboardingComplete ? 'complete' : 'incomplete';
    const stripe_status_label = onboardingComplete
      ? 'Stripe account active — you can receive payouts'
      : 'Stripe account incomplete — complete setup to receive payouts';
    const can_donate = chargesEnabled;
    const can_receive_payouts = payoutsEnabled;

    // Если нужен доонбординг, создаем Account Link
    let accountLinkUrl = null;
    if (!onboardingComplete) {
      try {
        const accountLink = await stripe.accountLinks.create({
          account: dbAccount.account_id,
          refresh_url: process.env.STRIPE_REFRESH_URL || defaultStripeRefreshUrl(),
          return_url: process.env.STRIPE_RETURN_URL || defaultStripeReturnUrl(),
          type: 'account_onboarding'
        });
        accountLinkUrl = accountLink.url;
      } catch (linkErr) {
        // Игнорируем ошибку создания ссылки, просто не возвращаем её
      }
    }

    await updateUserStripeStatusCache(dbAccount.user_id, stripeAccount);

    return success(res, {
      account_id: dbAccount.account_id,
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled,
      details_submitted: detailsSubmitted,
      onboarding_complete: onboardingComplete,
      stripe_account_status,
      stripe_status_label,
      can_donate,
      can_receive_payouts,
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
    return error(res, 'Webhook secret not configured', 500);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return error(res, 'Webhook signature verification failed', 400, {
      ...err,
      webhook_signature_error: true,
      errorDetails: {
        errorMessage: err.message,
        errorName: err.name,
        hasSignature: !!sig,
        hasWebhookSecret: !!webhookSecret,
        signatureLength: sig?.length || 0,
        note: 'Check STRIPE_WEBHOOK_SECRET in environment variables'
      }
    });
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

    // ВАЖНО: Stripe требует HTTP 200-299 для успешной доставки
    return res.status(200).json({ 
      received: true,
      event_type: event.type,
      event_id: event.id,
      message: 'Webhook processed successfully'
    });
  } catch (err) {
    // Возвращаем 500 с детальной информацией, чтобы Stripe повторил запрос
    return error(res, 'Error processing webhook event', 500, {
      ...err,
      event_type: event?.type || 'unknown',
      event_id: event?.id || 'unknown',
      webhook_processing_error: true,
      errorDetails: {
        errorMessage: err.message,
        errorName: err.name,
        errorCode: err.code,
        eventType: event?.type,
        eventId: event?.id,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      }
    });
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
    const dbAccount = accounts[0];
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
    await updateUserStripeStatusCache(dbAccount.user_id, account);
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
  // Проверка обязательных полей
  if (!paymentIntent || !paymentIntent.id) {
    throw new Error('PaymentIntent ID is required');
  }

  const [paymentIntents] = await pool.execute(
    'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
    [paymentIntent.id]
  );

  const piData = paymentIntents.length > 0 ? paymentIntents[0] : null;

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
        paymentIntent.id || 'unknown',
        paymentIntent.metadata?.user_id || null,
        paymentIntent.metadata?.request_id || null,
        paymentIntent.amount || 0,
        paymentIntent.currency || 'usd',
        paymentIntent.status || 'succeeded',
        paymentIntent.metadata?.type || 'unknown',
        JSON.stringify(paymentIntent.metadata || {})
      ]
    );
  }

  // Для донатов: создаём запись в donations и обновляем total_contributed только после успешной оплаты.
  // До этого донат не создаётся (create-donation только создаёт PaymentIntent), поэтому при отмене заявка не «платная».
  const isDonation = (piData && piData.type === 'donation') || (paymentIntent.metadata && paymentIntent.metadata.type === 'donation');
  const requestId = (piData && piData.request_id) || (paymentIntent.metadata && paymentIntent.metadata.request_id);
  const userId = (piData && piData.user_id) || (paymentIntent.metadata && paymentIntent.metadata.user_id);

  if (isDonation && requestId && userId) {
    const [existingDonation] = await pool.execute(
      'SELECT id FROM donations WHERE payment_intent_id = ?',
      [paymentIntent.id]
    );
    if (existingDonation.length === 0) {
      const amountDollars = (paymentIntent.amount || 0) / 100;
      const donationId = generateId();
      await pool.execute(
        'INSERT INTO donations (id, request_id, user_id, amount, payment_intent_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [donationId, requestId, userId, amountDollars, paymentIntent.id]
      );
      const [reqRows] = await pool.execute(
        'SELECT total_contributed, created_by, name, category FROM requests WHERE id = ?',
        [requestId]
      );
      if (reqRows.length > 0) {
        const currentTotal = parseFloat(reqRows[0].total_contributed || 0);
        await pool.execute(
          'UPDATE requests SET total_contributed = ?, updated_at = NOW() WHERE id = ?',
          [currentTotal + amountDollars, requestId]
        );
        const createdBy = reqRows[0].created_by;
        try {
          const { addUserToGroupChatByRequest } = require('../utils/chatHelpers');
          await addUserToGroupChatByRequest(requestId, userId);
        } catch (chatErr) {
          console.error('Webhook: add donor to group chat failed:', chatErr.message);
        }
        if (createdBy && createdBy !== userId) {
          const { sendDonationNotification } = require('../services/pushNotification');
          sendDonationNotification({
            requestId,
            requestName: reqRows[0].name || 'Request',
            requestCategory: reqRows[0].category || 'unknown',
            creatorId: createdBy,
            donorId: userId,
            amount: amountDollars,
          }).catch(err => console.error('Webhook: donation notification failed:', err.message));
        }
      }
    }
  }
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
  body('amount').isFloat({ min: 1 }).withMessage('Instant payouts are only available for $1 or more. For smaller amounts, the payout will be sent automatically within 2 days according to your payout schedule.'),
  body('external_account_id').optional().isString().withMessage('External account ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errList = errors.array();
      const amountErr = errList.find(e => e.param === 'amount');
      const message = amountErr ? amountErr.msg : 'Validation error';
      return error(res, message, 400, errList);
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

    // Убираем напоминания из cron: пользователь уже получил деньги через instant payout
    await pool.execute(
      "UPDATE transfer_payout_checks SET status = 'money_available', updated_at = NOW() WHERE performer_user_id = ? AND status = 'pending'",
      [user_id]
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
       LIMIT ${limitNum} OFFSET ${offset}`,
      [user_id]
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
 * Получение доступного баланса пользователя для выплат.
 * Перед ответом синхронизирует с Stripe статусы payment_intents и transfers для этого пользователя (компенсация при отключённом вебхуке).
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

    // Синхронизация с Stripe до формирования ответа (если вебхук отключён)
    try {
      // 1) PaymentIntents по донатам заявок, где пользователь — исполнитель или создатель (event)
      const [donationRows] = await pool.execute(
        `SELECT DISTINCT d.payment_intent_id FROM donations d
         INNER JOIN requests r ON r.id = d.request_id
         WHERE (r.joined_user_id = ? OR (r.category = 'event' AND r.created_by = ?))
           AND d.payment_intent_id IS NOT NULL`,
        [user_id, user_id]
      );
      for (const row of donationRows) {
        try {
          const stripePI = await stripe.paymentIntents.retrieve(row.payment_intent_id);
          await pool.execute(
            'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
            [stripePI.status, stripePI.id]
          );
        } catch (e) {
          // один неудачный PI не прерываем
        }
      }
      // 2) Transfers, где пользователь — получатель: синхронизируем только reversed
      const [userTransfers] = await pool.execute(
        'SELECT transfer_id FROM transfers WHERE performer_user_id = ?',
        [user_id]
      );
      for (const t of userTransfers) {
        try {
          const st = await stripe.transfers.retrieve(t.transfer_id);
          if (st.reversed) {
            await pool.execute(
              'UPDATE transfers SET status = ?, updated_at = NOW() WHERE transfer_id = ?',
              ['reversed', t.transfer_id]
            );
          }
        } catch (e) {}
      }
    } catch (syncErr) {
      // сбой синхронизации не блокирует ответ по балансу
    }

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

    // Ожидаемые/уже отправленные выплаты из нашей БД (transfers) — чтобы показывать «деньги в пути»
    const [transfersToUser] = await pool.execute(
      `SELECT id, transfer_id, request_id, amount_cents, status, created_at 
       FROM transfers 
       WHERE performer_user_id = ? AND (status IS NULL OR status != 'reversed')
       ORDER BY created_at DESC`,
      [user_id]
    );
    const pendingTransfersTotalCents = transfersToUser.reduce((sum, t) => sum + (t.amount_cents || 0), 0);

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
      // Ожидаемые выплаты: из нашей БД (если Transfer создан — здесь будет сумма; в Stripe она попадёт в pending/available)
      , pending_transfers: transfersToUser.map(t => ({
        request_id: t.request_id,
        amount_cents: t.amount_cents,
        amount_dollars: (t.amount_cents / 100).toFixed(2),
        status: t.status || 'pending',
        created_at: t.created_at
      })),
      pending_transfers_total_cents: pendingTransfersTotalCents,
      pending_transfers_total_dollars: (pendingTransfersTotalCents / 100).toFixed(2)
    });

  } catch (err) {
    return error(res, 'Error retrieving balance', 500, err);
  }
});

/**
 * POST /api/stripe/test-webhook
 * Тестовый эндпоинт для симуляции webhook событий от Stripe
 * Позволяет проверить обработку webhook без реальных событий от Stripe
 */
router.post('/test-webhook', authenticate, [
  body('event_type').notEmpty().withMessage('event_type is required'),
  body('event_data').optional().isObject().withMessage('event_data must be an object')
], async (req, res) => {
  // КРИТИЧЕСКИ ВАЖНО: Обеспечиваем, что ответ всегда будет отправлен
  let responseSent = false;
  
  const sendResponse = (status, data) => {
    if (!responseSent) {
      responseSent = true;
      return res.status(status).json(data);
    }
  };

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendResponse(400, {
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { event_type, event_data } = req.body;

    // Создаем тестовое событие в формате Stripe
    const testEvent = {
      id: `evt_test_${Date.now()}`,
      object: 'event',
      type: event_type,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: event_data || {}
      },
      livemode: false,
      pending_webhooks: 0,
      request: {
        id: null,
        idempotency_key: null
      }
    };

    // Симулируем обработку webhook
    let processingResult = {
      success: false,
      event_type: event_type,
      event_id: testEvent.id,
      message: '',
      errorDetails: null
    };

    try {
      // Обработка различных типов событий (та же логика, что в реальном webhook)
      switch (event_type) {
        case 'account.updated':
          try {
            await handleAccountUpdated(testEvent.data.object);
            processingResult.success = true;
            processingResult.message = 'Account updated event processed successfully';
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        case 'payment_intent.succeeded':
          try {
            // Нормализуем данные для обработчика
            // ВАЖНО: Для тестовых данных проверяем, существует ли user_id в БД
            const testUserId = event_data?.metadata?.user_id;
            let validUserId = null;
            
            if (testUserId && testUserId.startsWith('test_')) {
              // Тестовый user_id - проверяем, существует ли он в БД
              const [users] = await pool.execute('SELECT id FROM users WHERE id = ?', [testUserId]);
              if (users.length === 0) {
                // Тестовый user_id не существует - используем NULL для теста
                validUserId = null;
                processingResult.message = 'Payment intent succeeded event processed (test user_id not found, using NULL)';
              } else {
                validUserId = testUserId;
              }
            } else if (testUserId) {
              // Реальный user_id - проверяем существование
              const [users] = await pool.execute('SELECT id FROM users WHERE id = ?', [testUserId]);
              if (users.length > 0) {
                validUserId = testUserId;
              } else {
                validUserId = null;
                processingResult.message = 'Payment intent succeeded event processed (user_id not found, using NULL)';
              }
            }
            
            const normalizedPaymentIntent = {
              id: event_data?.id || 'pi_test_missing',
              status: event_data?.status || 'succeeded',
              amount: event_data?.amount || 0,
              currency: event_data?.currency || 'usd',
              metadata: {
                ...(event_data?.metadata || {}),
                user_id: validUserId || null
              }
            };
            
            await handlePaymentIntentSucceeded(normalizedPaymentIntent);
            processingResult.success = true;
            if (!processingResult.message) {
              processingResult.message = 'Payment intent succeeded event processed successfully';
            }
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        case 'payment_intent.requires_capture':
          try {
            await handlePaymentIntentRequiresCapture(testEvent.data.object);
            processingResult.success = true;
            processingResult.message = 'Payment intent requires capture event processed successfully';
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        case 'payment_intent.payment_failed':
          try {
            await handlePaymentIntentFailed(testEvent.data.object);
            processingResult.success = true;
            processingResult.message = 'Payment intent failed event processed successfully';
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        case 'payment_intent.canceled':
          try {
            await handlePaymentIntentCanceled(testEvent.data.object);
            processingResult.success = true;
            processingResult.message = 'Payment intent canceled event processed successfully';
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        case 'transfer.created':
          try {
            await handleTransferCreated(testEvent.data.object);
            processingResult.success = true;
            processingResult.message = 'Transfer created event processed successfully';
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        case 'transfer.paid':
          try {
            await handleTransferPaid(testEvent.data.object);
            processingResult.success = true;
            processingResult.message = 'Transfer paid event processed successfully';
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        case 'transfer.failed':
          try {
            await handleTransferFailed(testEvent.data.object);
            processingResult.success = true;
            processingResult.message = 'Transfer failed event processed successfully';
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        case 'payout.created':
          try {
            await handlePayoutCreated(testEvent.data.object);
            processingResult.success = true;
            processingResult.message = 'Payout created event processed successfully';
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        case 'payout.paid':
          try {
            await handlePayoutPaid(testEvent.data.object);
            processingResult.success = true;
            processingResult.message = 'Payout paid event processed successfully';
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        case 'payout.failed':
          try {
            await handlePayoutFailed(testEvent.data.object);
            processingResult.success = true;
            processingResult.message = 'Payout failed event processed successfully';
          } catch (handlerErr) {
            throw handlerErr;
          }
          break;

        default:
          processingResult.success = false;
          processingResult.message = `Unknown event type: ${event_type}`;
          processingResult.errorDetails = {
            supportedEvents: [
              'account.updated',
              'payment_intent.succeeded',
              'payment_intent.requires_capture',
              'payment_intent.payment_failed',
              'payment_intent.canceled',
              'transfer.created',
              'transfer.paid',
              'transfer.failed',
              'payout.created',
              'payout.paid',
              'payout.failed'
            ]
          };
      }
    } catch (processingErr) {
      processingResult.success = false;
      processingResult.message = 'Error processing webhook event';
      processingResult.errorDetails = {
        errorMessage: processingErr.message || 'Unknown error',
        errorName: processingErr.name || 'Error',
        errorCode: processingErr.code || null,
        errno: processingErr.errno || null,
        sqlMessage: processingErr.sqlMessage || null,
        sql: processingErr.sql || null,
        stack: process.env.NODE_ENV === 'development' ? processingErr.stack : undefined
      };
    }

    // ВАЖНО: Всегда возвращаем ответ, даже если обработка не удалась
    return sendResponse(200, {
      success: true,
      message: processingResult.success ? 'Webhook test completed' : 'Webhook test failed',
      data: {
        test_event: testEvent,
        processing_result: processingResult,
        note: 'This is a test endpoint. Real webhooks from Stripe go to /api/stripe/webhooks'
      }
    });

  } catch (err) {
    // КРИТИЧЕСКИ ВАЖНО: Всегда возвращаем ответ, даже при ошибке
    try {
      if (!responseSent) {
        return error(res, 'Error testing webhook', 500, {
          ...err,
          errorMessage: err.message || 'Unknown error',
          errorName: err.name || 'Error',
          errorCode: err.code || null,
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
      }
    } catch (responseErr) {
      // Если даже error() падает, возвращаем минимальный ответ
      return sendResponse(500, {
        success: false,
        message: 'Critical error in test-webhook endpoint',
        error: err.message || 'Unknown error',
        responseError: responseErr.message
      });
    }
  }
});

router.refreshUserStripeStatusIfNeeded = refreshUserStripeStatusIfNeeded;
module.exports = router;

