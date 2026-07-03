const { SUPPORTED_LOCALES } = require('../services/translateNews');

/** @type {Record<string, Record<string, string>>} */
const CATALOG = {
  VALIDATION_FAILED: {
    en: 'Please fix the fields below and try again.',
    ru: 'Исправьте указанные поля и попробуйте снова.',
  },
  INVALID_CATEGORY: {
    en: 'Choose a valid request type.',
    ru: 'Выберите корректный тип заявки.',
  },
  NAME_REQUIRED: {
    en: 'Enter a request title.',
    ru: 'Укажите название заявки.',
  },
  DESCRIPTION_REQUIRED: {
    en: 'Describe the cleanup or event.',
    ru: 'Добавьте описание уборки или события.',
  },
  INVALID_DATE_FORMAT: {
    en: 'Check the date format and try again.',
    ru: 'Проверьте формат даты и попробуйте снова.',
  },
  INVALID_BOOLEAN_FIELD: {
    en: 'Invalid value for a yes/no field.',
    ru: 'Некорректное значение для поля да/нет.',
  },
  INVALID_LOCALE: {
    en: 'Unsupported language code.',
    ru: 'Неподдерживаемый код языка.',
  },
  REQUEST_CREATE_FAILED: {
    en: 'Could not create the request. Try again or contact support.',
    ru: 'Не удалось создать заявку. Попробуйте ещё раз или обратитесь в поддержку.',
  },
  FORBIDDEN: {
    en: 'You do not have permission for this action.',
    ru: 'У вас нет прав для этого действия.',
  },
  REQUEST_NOT_FOUND: {
    en: 'Request not found.',
    ru: 'Заявка не найдена.',
  },
  USER_NOT_FOUND: {
    en: 'User not found.',
    ru: 'Пользователь не найден.',
  },
  DONATION_MIN_AMOUNT: {
    en: 'Minimum donation amount is $0.50.',
    ru: 'Минимальная сумма доната — $0.50.',
  },
  DONATION_REQUEST_ID_REQUIRED: {
    en: 'Request ID is required.',
    ru: 'Укажите ID заявки.',
  },
  DONATION_USER_ID_REQUIRED: {
    en: 'User ID is required.',
    ru: 'Укажите ID пользователя.',
  },
  DONATION_AMOUNT_REQUIRED: {
    en: 'Enter a donation amount.',
    ru: 'Укажите сумму доната.',
  },
  DONATION_AMOUNT_INVALID: {
    en: 'Enter a valid donation amount.',
    ru: 'Укажите корректную сумму доната.',
  },
  INSUFFICIENT_PERMISSIONS: {
    en: 'You can only donate on your own behalf.',
    ru: 'Можно создать донат только от своего имени.',
  },
  STRIPE_NOT_CONFIGURED: {
    en: 'Payments are temporarily unavailable. Please contact support.',
    ru: 'Платежи временно недоступны. Обратитесь в поддержку.',
  },
  STRIPE_ERROR: {
    en: 'Payment could not be started. Try again or use another card.',
    ru: 'Не удалось начать оплату. Попробуйте снова или используйте другую карту.',
  },
  STRIPE_TIMEOUT: {
    en: 'Payment service did not respond in time. Try again in a moment.',
    ru: 'Платёжный сервис не ответил вовремя. Попробуйте через минуту.',
  },
  DONATION_RAIL_MANUAL_ONLY: {
    en: 'Card payment is not available for this request. Use the bank details shown in the app.',
    ru: 'Оплата картой для этой заявки недоступна. Используйте реквизиты в приложении.',
  },
  DONATION_RAIL_UNAVAILABLE: {
    en: 'Donations are not set up for this request yet.',
    ru: 'Донаты для этой заявки пока не настроены.',
  },
  DONATION_CREATE_FAILED: {
    en: 'Could not start the donation. Try again or contact support.',
    ru: 'Не удалось начать донат. Попробуйте снова или обратитесь в поддержку.',
  },
};

function normalizeLocale(raw) {
  const l = String(raw || 'en')
    .trim()
    .toLowerCase()
    .split('-')[0];
  return SUPPORTED_LOCALES.includes(l) ? l : 'en';
}

function pickLocaleFromAcceptLanguage(acceptLanguage) {
  if (!acceptLanguage || typeof acceptLanguage !== 'string') return 'en';
  const tokens = acceptLanguage.split(',').map((p) => p.trim().split(';')[0].toLowerCase());
  for (const token of tokens) {
    const base = token.split('-')[0];
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return 'en';
}

function resolveRequestLocale(req, bodyData) {
  const explicit = bodyData?.locale ?? req?.query?.locale;
  if (explicit != null && String(explicit).trim() !== '') {
    return normalizeLocale(explicit);
  }
  return pickLocaleFromAcceptLanguage(req?.headers?.['accept-language']);
}

function t(key, locale, fallbackEn) {
  const loc = normalizeLocale(locale);
  const row = CATALOG[key];
  if (!row) return fallbackEn || key;
  return row[loc] || row.en || fallbackEn || key;
}

function mapExpressValidatorItem(item, locale) {
  const field = item.path || item.param || item.location || 'unknown';
  const rawMsg = String(item.msg || '');

  let key = 'VALIDATION_FAILED';
  if (field === 'category') key = 'INVALID_CATEGORY';
  else if (field === 'name') key = 'NAME_REQUIRED';
  else if (field === 'description') key = 'DESCRIPTION_REQUIRED';
  else if (field === 'request_id') key = 'DONATION_REQUEST_ID_REQUIRED';
  else if (field === 'user_id') key = 'DONATION_USER_ID_REQUIRED';
  else if (field === 'amount') {
    if (/minimum|min/i.test(rawMsg)) key = 'DONATION_MIN_AMOUNT';
    else key = 'DONATION_AMOUNT_INVALID';
  }

  return { field, msg: t(key, locale) };
}

function mapExpressValidatorErrors(items, locale) {
  return (items || []).map((item) => mapExpressValidatorItem(item, locale));
}

function buildErrorPayload({
  errorCode,
  message,
  locale,
  errors,
  errorDetails,
  requestId,
}) {
  const timestamp = new Date().toISOString();
  const payload = {
    success: false,
    errorCode,
    message,
    timestamp,
  };
  if (Array.isArray(errors) && errors.length) payload.errors = errors;
  if (errorDetails || requestId) {
    payload.errorDetails = {
      errorCode,
      errorMessage: message,
      timestamp,
      ...(requestId ? { requestId } : {}),
      ...(errorDetails || {}),
    };
  }
  return payload;
}

function sendUserFacingError(res, options) {
  const {
    statusCode = 400,
    errorCode,
    messageKey,
    message,
    locale = 'en',
    errors,
    errorDetails,
    requestId,
    logError,
    logContext,
  } = options;

  if (logError) {
    console.error(`[${errorCode}]`, logContext || '', logError.message || logError);
    if (logError.stack) console.error(logError.stack);
  }

  const userMessage = message || t(messageKey, locale);
  const payload = buildErrorPayload({
    errorCode,
    message: userMessage,
    locale,
    errors,
    errorDetails: statusCode >= 500 ? errorDetails : undefined,
    requestId,
  });
  return res.status(statusCode).json(payload);
}

function sendValidationError(res, req, validationItems, bodyData) {
  const locale = resolveRequestLocale(req, bodyData);
  const errors = mapExpressValidatorErrors(validationItems, locale);
  const message =
    errors.length === 1 ? errors[0].msg : t('VALIDATION_FAILED', locale);
  return sendUserFacingError(res, {
    statusCode: 400,
    errorCode: 'VALIDATION_FAILED',
    message,
    locale,
    errors,
  });
}

function stripeUserMessage(stripeErr, locale) {
  const code = stripeErr?.code || '';
  const type = stripeErr?.type || '';
  if (
    type === 'StripeConnectionError' ||
    code === 'ETIMEDOUT' ||
    /timeout/i.test(String(stripeErr?.message || ''))
  ) {
    return { errorCode: 'STRIPE_TIMEOUT', message: t('STRIPE_TIMEOUT', locale) };
  }
  return { errorCode: 'STRIPE_ERROR', message: t('STRIPE_ERROR', locale) };
}

function railErrorMessage(code, locale) {
  const key =
    code === 'DONATION_RAIL_MANUAL_ONLY'
      ? 'DONATION_RAIL_MANUAL_ONLY'
      : code === 'REQUEST_NOT_FOUND'
        ? 'REQUEST_NOT_FOUND'
        : 'DONATION_RAIL_UNAVAILABLE';
  return t(key, locale);
}

module.exports = {
  CATALOG,
  normalizeLocale,
  resolveRequestLocale,
  t,
  mapExpressValidatorErrors,
  sendUserFacingError,
  sendValidationError,
  stripeUserMessage,
  railErrorMessage,
};
