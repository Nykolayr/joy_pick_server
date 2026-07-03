#!/usr/bin/env node
const assert = require('assert');
const {
  t,
  mapExpressValidatorErrors,
  normalizeLocale,
  stripeUserMessage,
  railErrorMessage,
} = require('../api/utils/userFacingErrors');

assert.strictEqual(t('NAME_REQUIRED', 'ru'), 'Укажите название заявки.');
assert.strictEqual(t('DONATION_MIN_AMOUNT', 'en'), 'Minimum donation amount is $0.50.');
assert.strictEqual(normalizeLocale('ru-RU'), 'ru');

const mapped = mapExpressValidatorErrors(
  [{ path: 'name', msg: 'Name is required' }],
  'ru'
);
assert.strictEqual(mapped[0].field, 'name');
assert.ok(mapped[0].msg.includes('название'));

const stripeTimeout = stripeUserMessage({ type: 'StripeConnectionError' }, 'ru');
assert.strictEqual(stripeTimeout.errorCode, 'STRIPE_TIMEOUT');

const railManual = railErrorMessage('DONATION_RAIL_MANUAL_ONLY', 'ru');
assert.ok(railManual.includes('картой') || railManual.includes('реквизиты'));

console.log('test_user_facing_errors: ok');
