#!/usr/bin/env node
/**
 * Smoke для donationRailResolver + donationRailService (без HTTP).
 */
const assert = require('assert');
const {
  resolveExecutorUserIds,
  resolveDonationRails,
  inferPayoutRail,
  PAYOUT_RAILS,
} = require('../api/services/donationRailResolver');

function testExecutorIds() {
  const waste = {
    category: 'wasteLocation',
    joined_user_id: 'u1',
    taken_by: 'u2',
    created_by: 'u3',
  };
  assert.deepStrictEqual(resolveExecutorUserIds(waste), ['u1']);

  const event = {
    category: 'event',
    created_by: 'org',
    registered_participants: JSON.stringify(['p1', 'p2']),
    actual_participants: ['p3'],
  };
  const ids = resolveExecutorUserIds(event);
  assert.ok(ids.includes('org'));
  assert.ok(ids.includes('p1'));
  assert.ok(ids.includes('p3'));
}

function testRailsStripeOnly() {
  const resolved = resolveDonationRails({
    requestRow: { category: 'wasteLocation', joined_user_id: 'e1' },
    executorUsers: [
      {
        id: 'e1',
        can_receive_payouts: 1,
        stripe_account_status: 'complete',
        has_stripe_account: true,
      },
    ],
  });
  assert.strictEqual(resolved.recommended, 'A');
  assert.strictEqual(resolved.rails.length, 1);
  assert.strictEqual(resolved.rails[0].code, 'A');
}

function testRailsManualOnly() {
  const resolved = resolveDonationRails({
    requestRow: { category: 'speedCleanup', taken_by: 'e2' },
    executorUsers: [
      {
        id: 'e2',
        can_receive_payouts: 0,
        stripe_account_status: 'none',
        has_stripe_account: false,
        manual_payout_details: { instructions: 'Pix: 12345-6', label: 'Pix' },
        payout_rail: 'manual',
      },
    ],
  });
  assert.strictEqual(resolved.recommended, 'E');
  assert.strictEqual(resolved.rails[0].code, 'E');
  assert.ok(resolved.rails[0].manual_instructions.instructions.includes('Pix'));
}

function testRailsBothPreferA() {
  const resolved = resolveDonationRails({
    requestRow: { category: 'wasteLocation', joined_user_id: 'e3' },
    executorUsers: [
      {
        id: 'e3',
        can_receive_payouts: 1,
        has_stripe_account: true,
        manual_payout_details: { instructions: 'IBAN DE89...' },
        payout_rail: 'manual',
      },
    ],
  });
  assert.strictEqual(resolved.recommended, 'A');
  assert.ok(resolved.rails.some((r) => r.code === 'A'));
  assert.ok(resolved.rails.some((r) => r.code === 'E'));
}

function testInferRail() {
  assert.strictEqual(
    inferPayoutRail({ payout_rail: 'manual', manual_payout_details: { instructions: 'x' } }),
    PAYOUT_RAILS.MANUAL
  );
  assert.strictEqual(
    inferPayoutRail({ can_receive_payouts: 1 }, { hasStripeAccount: true }),
    PAYOUT_RAILS.STRIPE
  );
}

function main() {
  testExecutorIds();
  testRailsStripeOnly();
  testRailsManualOnly();
  testRailsBothPreferA();
  testInferRail();
  console.log('test_donation_rail_resolver: ok');
}

main();
