const { SUPPORTED_LOCALES } = require('../services/translateNews');

/**
 * Стабильные ключи для ARB в joy_pick (api_error_*).
 * Клиент переводит по message_key; message на сервере — только EN fallback.
 */
const MESSAGE_KEYS = {
  VALIDATION_FAILED: 'api_error_validation_failed',
  INVALID_CATEGORY: 'api_error_invalid_category',
  NAME_REQUIRED: 'api_error_name_required',
  DESCRIPTION_REQUIRED: 'api_error_description_required',
  INVALID_DATE_FORMAT: 'api_error_invalid_date_format',
  INVALID_BOOLEAN_FIELD: 'api_error_invalid_boolean_field',
  INVALID_LOCALE: 'api_error_invalid_locale',
  REQUEST_CREATE_FAILED: 'api_error_request_create_failed',
  FORBIDDEN: 'api_error_forbidden',
  REQUEST_NOT_FOUND: 'api_error_request_not_found',
  USER_NOT_FOUND: 'api_error_user_not_found',
  DONATION_MIN_AMOUNT: 'api_error_donation_min_amount',
  DONATION_REQUEST_ID_REQUIRED: 'api_error_donation_request_id_required',
  DONATION_USER_ID_REQUIRED: 'api_error_donation_user_id_required',
  DONATION_AMOUNT_REQUIRED: 'api_error_donation_amount_required',
  DONATION_AMOUNT_INVALID: 'api_error_donation_amount_invalid',
  INSUFFICIENT_PERMISSIONS: 'api_error_insufficient_permissions',
  STRIPE_NOT_CONFIGURED: 'api_error_stripe_not_configured',
  STRIPE_ERROR: 'api_error_stripe_error',
  STRIPE_TIMEOUT: 'api_error_stripe_timeout',
  DONATION_RAIL_MANUAL_ONLY: 'api_error_donation_rail_manual_only',
  DONATION_RAIL_UNAVAILABLE: 'api_error_donation_rail_unavailable',
  DONATION_CREATE_FAILED: 'api_error_donation_create_failed',
};

/** English fallback only — все остальные языки в Flutter ARB. */
const MESSAGE_EN = {
  VALIDATION_FAILED: 'Please fix the fields below and try again.',
  INVALID_CATEGORY: 'Choose a valid request type.',
  NAME_REQUIRED: 'Enter a request title.',
  DESCRIPTION_REQUIRED: 'Describe the cleanup or event.',
  INVALID_DATE_FORMAT: 'Check the date format and try again.',
  INVALID_BOOLEAN_FIELD: 'Invalid value for a yes/no field.',
  INVALID_LOCALE: 'Unsupported language code.',
  REQUEST_CREATE_FAILED: 'Could not create the request. Try again or contact support.',
  FORBIDDEN: 'You do not have permission for this action.',
  REQUEST_NOT_FOUND: 'Request not found.',
  USER_NOT_FOUND: 'User not found.',
  DONATION_MIN_AMOUNT: 'Minimum donation amount is $0.50.',
  DONATION_REQUEST_ID_REQUIRED: 'Request ID is required.',
  DONATION_USER_ID_REQUIRED: 'User ID is required.',
  DONATION_AMOUNT_REQUIRED: 'Enter a donation amount.',
  DONATION_AMOUNT_INVALID: 'Enter a valid donation amount.',
  INSUFFICIENT_PERMISSIONS: 'You can only donate on your own behalf.',
  STRIPE_NOT_CONFIGURED: 'Payments are temporarily unavailable. Please contact support.',
  STRIPE_ERROR: 'Payment could not be started. Try again or use another card.',
  STRIPE_TIMEOUT: 'Payment service did not respond in time. Try again in a moment.',
  DONATION_RAIL_MANUAL_ONLY:
    'Card payment is not available for this request. Use the bank details shown in the app.',
  DONATION_RAIL_UNAVAILABLE: 'Donations are not set up for this request yet.',
  DONATION_CREATE_FAILED: 'Could not start the donation. Try again or contact support.',
};

function messageKeyForErrorCode(errorCode) {
  return MESSAGE_KEYS[errorCode] || `api_error_${String(errorCode || 'unknown').toLowerCase()}`;
}

function messageEnForErrorCode(errorCode) {
  return MESSAGE_EN[errorCode] || 'Something went wrong. Please try again.';
}

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

/** Locale клиента — для логов / data.integrity; тексты ошибок API не локализуются на сервере. */
function resolveRequestLocale(req, bodyData) {
  const explicit = bodyData?.locale ?? req?.query?.locale;
  if (explicit != null && String(explicit).trim() !== '') {
    return normalizeLocale(explicit);
  }
  return pickLocaleFromAcceptLanguage(req?.headers?.['accept-language']);
}

function errorCodeForValidatorField(field, rawMsg) {
  if (field === 'category') return 'INVALID_CATEGORY';
  if (field === 'name') return 'NAME_REQUIRED';
  if (field === 'description') return 'DESCRIPTION_REQUIRED';
  if (field === 'request_id') return 'DONATION_REQUEST_ID_REQUIRED';
  if (field === 'user_id') return 'DONATION_USER_ID_REQUIRED';
  if (field === 'amount') {
    if (/minimum|min/i.test(String(rawMsg || ''))) return 'DONATION_MIN_AMOUNT';
    return 'DONATION_AMOUNT_INVALID';
  }
  return 'VALIDATION_FAILED';
}

function mapExpressValidatorItem(item) {
  const field = item.path || item.param || item.location || 'unknown';
  const errorCode = errorCodeForValidatorField(field, item.msg);
  const message_key = messageKeyForErrorCode(errorCode);
  return {
    field,
    message_key,
    msg: messageEnForErrorCode(errorCode),
  };
}

function mapExpressValidatorErrors(items) {
  return (items || []).map((item) => mapExpressValidatorItem(item));
}

function buildErrorPayload({
  errorCode,
  message_key,
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
    message_key,
    message,
    timestamp,
  };
  if (locale) payload.locale = locale;
  if (Array.isArray(errors) && errors.length) payload.errors = errors;
  if (errorDetails || requestId) {
    payload.errorDetails = {
      errorCode,
      message_key,
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
    locale,
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

  const resolvedKey = messageKey || messageKeyForErrorCode(errorCode);
  const fallbackMessage = message || messageEnForErrorCode(errorCode);

  const payload = buildErrorPayload({
    errorCode,
    message_key: resolvedKey,
    message: fallbackMessage,
    locale,
    errors,
    errorDetails: statusCode >= 500 ? errorDetails : undefined,
    requestId,
  });
  return res.status(statusCode).json(payload);
}

function sendValidationError(res, req, validationItems, bodyData) {
  const locale = resolveRequestLocale(req, bodyData);
  const errors = mapExpressValidatorErrors(validationItems);
  const primaryCode =
    validationItems.length === 1
      ? errorCodeForValidatorField(
          validationItems[0].path || validationItems[0].param,
          validationItems[0].msg
        )
      : 'VALIDATION_FAILED';
  const message =
    errors.length === 1 ? errors[0].msg : messageEnForErrorCode('VALIDATION_FAILED');
  return sendUserFacingError(res, {
    statusCode: 400,
    errorCode: primaryCode,
    message,
    locale,
    errors,
  });
}

function stripeUserError(stripeErr) {
  const code = stripeErr?.code || '';
  const type = stripeErr?.type || '';
  if (
    type === 'StripeConnectionError' ||
    code === 'ETIMEDOUT' ||
    /timeout/i.test(String(stripeErr?.message || ''))
  ) {
    return { errorCode: 'STRIPE_TIMEOUT' };
  }
  return { errorCode: 'STRIPE_ERROR' };
}

module.exports = {
  MESSAGE_KEYS,
  MESSAGE_EN,
  messageKeyForErrorCode,
  messageEnForErrorCode,
  normalizeLocale,
  resolveRequestLocale,
  mapExpressValidatorErrors,
  sendUserFacingError,
  sendValidationError,
  stripeUserError,
};
