/**
 * Рельсы донатов (вариант 1 — строгий matching).
 * A = Stripe, E = manual off-platform, D/B/C — фазы 1+.
 */

const PAYOUT_RAILS = Object.freeze({
  STRIPE: 'stripe',
  MANUAL: 'manual',
  CRYPTO: 'crypto',
  PSP: 'psp',
});

const RAIL_CODES = Object.freeze({
  A: 'A',
  E: 'E',
  D: 'D',
  B: 'B',
  C: 'C',
});

function normalizeCategory(category) {
  return String(category || '').trim().toLowerCase();
}

/**
 * @param {object} requestRow — строка requests
 * @returns {string[]}
 */
function resolveExecutorUserIds(requestRow) {
  if (!requestRow) return [];
  const category = normalizeCategory(requestRow.category);

  if (category === 'event') {
    const ids = new Set();
    const add = (v) => {
      if (v) ids.add(String(v));
    };
    let registered = requestRow.registered_participants;
    let actual = requestRow.actual_participants;
    if (typeof registered === 'string') {
      try {
        registered = JSON.parse(registered);
      } catch {
        registered = [];
      }
    }
    if (typeof actual === 'string') {
      try {
        actual = JSON.parse(actual);
      } catch {
        actual = [];
      }
    }
    if (Array.isArray(registered)) registered.forEach(add);
    if (Array.isArray(actual)) actual.forEach(add);
    add(requestRow.created_by);
    return [...ids];
  }

  const single =
    requestRow.joined_user_id || requestRow.taken_by || requestRow.created_by || null;
  return single ? [String(single)] : [];
}

/**
 * @param {object|null} userRow
 * @param {{ hasStripeAccount?: boolean }} stripeMeta
 */
function inferPayoutRail(userRow, stripeMeta = {}) {
  if (!userRow) return null;
  const explicit = String(userRow.payout_rail || '').trim().toLowerCase();
  if (explicit && Object.values(PAYOUT_RAILS).includes(explicit)) {
    return explicit;
  }
  if (userRow.can_receive_payouts && stripeMeta.hasStripeAccount) {
    return PAYOUT_RAILS.STRIPE;
  }
  if (hasManualPayoutDetails(userRow)) {
    return PAYOUT_RAILS.MANUAL;
  }
  if (userRow.stripe_account_status === 'complete' || userRow.can_receive_payouts) {
    return PAYOUT_RAILS.STRIPE;
  }
  return null;
}

function hasManualPayoutDetails(userRow) {
  const raw = userRow?.manual_payout_details;
  if (!raw) return false;
  if (typeof raw === 'object') {
    const text = raw.instructions || raw.text || raw.details || '';
    return String(text).trim().length >= 8;
  }
  return String(raw).trim().length >= 8;
}

function parseManualDetails(userRow) {
  const raw = userRow?.manual_payout_details;
  if (!raw) return null;
  if (typeof raw === 'object') {
    return {
      label: raw.label ? String(raw.label) : null,
      instructions: String(raw.instructions || raw.text || raw.details || '').trim(),
      currency_hint: raw.currency_hint ? String(raw.currency_hint) : null,
    };
  }
  return { label: null, instructions: String(raw).trim(), currency_hint: null };
}

/**
 * @param {object} userRow
 * @param {{ hasStripeAccount?: boolean }} stripeMeta
 */
function buildPayoutProfileSummary(userRow, stripeMeta = {}) {
  const rail = inferPayoutRail(userRow, stripeMeta);
  const manual = parseManualDetails(userRow);
  return {
    user_id: userRow?.id || null,
    payout_rail: rail,
    stripe_account_status: userRow?.stripe_account_status || 'none',
    can_receive_payouts: Boolean(userRow?.can_receive_payouts),
    has_stripe_account: Boolean(stripeMeta.hasStripeAccount),
    manual_payout_configured: Boolean(manual?.instructions),
    manual_payout_verified_at: userRow?.manual_payout_verified_at || null,
  };
}

/**
 * @typedef {{ code: string, provider: string, methods: string[], label_key: string, platform_fee: boolean, manual_instructions?: object }} DonationRailOption
 */

function canReceiveStripePayouts(userRow, stripeMeta = {}) {
  return Boolean(userRow?.can_receive_payouts && stripeMeta.hasStripeAccount);
}

/**
 * @param {object} input
 * @param {object} input.requestRow
 * @param {object[]} input.executorUsers — users + optional has_stripe_account per row
 * @returns {{ rails: DonationRailOption[], recommended: string|null, blocked_reason: string|null, executor_user_ids: string[], payout_profiles: object[] }}
 */
function resolveDonationRails({ requestRow, executorUsers }) {
  const executorUserIds = resolveExecutorUserIds(requestRow);
  const payoutProfiles = (executorUsers || []).map((u) =>
    buildPayoutProfileSummary(u, { hasStripeAccount: Boolean(u.has_stripe_account) })
  );

  if (executorUserIds.length === 0) {
    return {
      rails: [],
      recommended: null,
      blocked_reason: 'NO_EXECUTOR',
      executor_user_ids: [],
      payout_profiles: payoutProfiles,
    };
  }

  const rails = [];
  const anyStripe = (executorUsers || []).some((u) =>
    canReceiveStripePayouts(u, { hasStripeAccount: Boolean(u.has_stripe_account) })
  );
  const anyManual = (executorUsers || []).some((u) => hasManualPayoutDetails(u));

  if (anyStripe) {
    rails.push({
      code: RAIL_CODES.A,
      provider: 'stripe',
      methods: ['card'],
      label_key: 'donation_rail_stripe_card',
      platform_fee: true,
    });
  }

  if (anyManual) {
    const manualUser = (executorUsers || []).find((u) => hasManualPayoutDetails(u));
    const manual = parseManualDetails(manualUser);
    rails.push({
      code: RAIL_CODES.E,
      provider: 'manual',
      methods: ['off_platform'],
      label_key: 'donation_rail_manual',
      platform_fee: false,
      manual_instructions: manual,
    });
  }

  let recommended = null;
  if (rails.some((r) => r.code === RAIL_CODES.A)) recommended = RAIL_CODES.A;
  else if (rails.some((r) => r.code === RAIL_CODES.E)) recommended = RAIL_CODES.E;

  let blocked_reason = null;
  if (rails.length === 0) {
    blocked_reason = 'EXECUTOR_PAYOUT_NOT_CONFIGURED';
  }

  return {
    rails,
    recommended,
    blocked_reason,
    executor_user_ids: executorUserIds,
    payout_profiles: payoutProfiles,
  };
}

function isStripeDonationAllowed(resolved) {
  return (resolved.rails || []).some((r) => r.code === RAIL_CODES.A);
}

function normalizeManualPayoutDetailsInput(body) {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string') {
    const instructions = body.trim();
    if (!instructions) return null;
    return { instructions };
  }
  if (typeof body === 'object') {
    const instructions = String(body.instructions || body.text || '').trim();
    const label = body.label != null ? String(body.label).trim() : null;
    const currency_hint = body.currency_hint != null ? String(body.currency_hint).trim() : null;
    if (!instructions) return null;
    return {
      ...(label ? { label } : {}),
      instructions,
      ...(currency_hint ? { currency_hint } : {}),
    };
  }
  return null;
}

module.exports = {
  PAYOUT_RAILS,
  RAIL_CODES,
  resolveExecutorUserIds,
  inferPayoutRail,
  canReceiveStripePayouts,
  hasManualPayoutDetails,
  parseManualDetails,
  buildPayoutProfileSummary,
  resolveDonationRails,
  isStripeDonationAllowed,
  normalizeManualPayoutDetailsInput,
};
