#!/usr/bin/env node
const assert = require('assert');
const {
  messageEnForErrorCode,
  messageKeyForErrorCode,
  mapExpressValidatorErrors,
  stripeUserError,
} = require('../api/utils/userFacingErrors');

assert.strictEqual(messageKeyForErrorCode('NAME_REQUIRED'), 'api_error_name_required');
assert.strictEqual(messageEnForErrorCode('NAME_REQUIRED'), 'Enter a request title.');
assert.strictEqual(messageEnForErrorCode('DONATION_MIN_AMOUNT'), 'Minimum donation amount is $0.50.');

const mapped = mapExpressValidatorErrors([{ path: 'name', msg: 'Name is required' }]);
assert.strictEqual(mapped[0].field, 'name');
assert.strictEqual(mapped[0].message_key, 'api_error_name_required');
assert.ok(mapped[0].msg.includes('title'));

assert.strictEqual(stripeUserError({ type: 'StripeConnectionError' }).errorCode, 'STRIPE_TIMEOUT');

console.log('test_user_facing_errors: ok');
