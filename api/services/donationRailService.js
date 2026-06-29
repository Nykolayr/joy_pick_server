const pool = require('../config/database');
const {
  resolveExecutorUserIds,
  resolveDonationRails,
  buildPayoutProfileSummary,
} = require('./donationRailResolver');

const USER_PAYOUT_COLUMNS = `
  u.id, u.payout_rail, u.manual_payout_details, u.manual_payout_verified_at,
  u.stripe_account_status, u.can_receive_payouts, u.country
`;

async function loadRequestRowForRails(requestId) {
  const [rows] = await pool.execute(
    `SELECT id, category, status, created_by, taken_by, joined_user_id,
            registered_participants, actual_participants
     FROM requests WHERE id = ?`,
    [requestId]
  );
  return rows[0] || null;
}

async function loadExecutorUsersForRails(userIds) {
  if (!userIds.length) return [];
  const placeholders = userIds.map(() => '?').join(',');
  const [users] = await pool.execute(
    `SELECT ${USER_PAYOUT_COLUMNS}
     FROM users u
     WHERE u.id IN (${placeholders})`,
    userIds
  );
  const [stripeRows] = await pool.execute(
    `SELECT user_id FROM stripe_accounts WHERE user_id IN (${placeholders})`,
    userIds
  );
  const stripeSet = new Set(stripeRows.map((r) => String(r.user_id)));
  return users.map((u) => {
    const manual = u.manual_payout_details;
    if (manual && typeof manual === 'string') {
      try {
        u.manual_payout_details = JSON.parse(manual);
      } catch {
        // keep string
      }
    }
    return {
      ...u,
      has_stripe_account: stripeSet.has(String(u.id)),
    };
  });
}

async function getDonationRailsForRequest(requestId) {
  const requestRow = await loadRequestRowForRails(requestId);
  if (!requestRow) {
    return { notFound: true };
  }
  const executorUserIds = resolveExecutorUserIds(requestRow);
  const executorUsers = await loadExecutorUsersForRails(executorUserIds);
  const resolved = resolveDonationRails({ requestRow, executorUsers });
  return {
    request_id: String(requestId),
    category: requestRow.category,
    status: requestRow.status,
    ...resolved,
  };
}

async function assertStripeDonationAllowed(requestId) {
  const data = await getDonationRailsForRequest(requestId);
  if (data.notFound) {
    return { ok: false, status: 404, code: 'REQUEST_NOT_FOUND', message: 'Request not found' };
  }
  const stripeAllowed = (data.rails || []).some((r) => r.code === 'A');
  if (!stripeAllowed) {
    const onlyManual = (data.rails || []).some((r) => r.code === 'E') && data.rails.length === 1;
    return {
      ok: false,
      status: 422,
      code: onlyManual ? 'DONATION_RAIL_MANUAL_ONLY' : 'DONATION_RAIL_UNAVAILABLE',
      message: onlyManual
        ? 'In-app card donation is not available; use off-platform transfer (rail E)'
        : 'No donation rail configured for this request',
      rails: data.rails,
      blocked_reason: data.blocked_reason,
    };
  }
  return { ok: true, rails: data.rails };
}

/**
 * Краткая сводка для карточки заявки (без полных реквизитов).
 */
async function getExecutorPayoutSummaryForRequest(requestId, requestRow = null) {
  const row = requestRow || (await loadRequestRowForRails(requestId));
  if (!row) return null;
  const executorUserIds = resolveExecutorUserIds(row);
  const executorUsers = await loadExecutorUsersForRails(executorUserIds);
  const profiles = executorUsers.map((u) =>
    buildPayoutProfileSummary(u, { hasStripeAccount: u.has_stripe_account })
  );
  const rails = resolveDonationRails({ requestRow: row, executorUsers });
  return {
    executor_user_ids: executorUserIds,
    payout_profiles: profiles,
    donation_rails_available: (rails.rails || []).map((r) => r.code),
    manual_payout_available: profiles.some((p) => p.manual_payout_configured),
    blocked_reason: rails.blocked_reason,
  };
}

module.exports = {
  loadRequestRowForRails,
  loadExecutorUsersForRails,
  getDonationRailsForRequest,
  assertStripeDonationAllowed,
  getExecutorPayoutSummaryForRequest,
};
