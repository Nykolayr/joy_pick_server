const pool = require('../config/database');
const {
  handleRequestRejection,
  handleEventApproval,
  handleSpeedCleanupApproval,
  handleWasteApproval,
  buildRequestDetailForApi,
} = require('../routes/requests');
const {
  sendModerationAutoRejectPendingNotification,
} = require('./pushNotification');

const GRACE_HOURS = Math.max(1, parseInt(process.env.AUTO_MODERATION_GRACE_HOURS || '24', 10) || 24);
const AUTO_MODERATION_ENABLED = process.env.AUTO_MODERATION_ENABLED === '1' || process.env.AUTO_MODERATION_ENABLED === 'true';
const DEFAULT_RULE_VERSION = process.env.AUTO_MODERATION_RULE_VERSION || 'v0';

function isAutoModerationEnabled() {
  return AUTO_MODERATION_ENABLED;
}

function parseMeta(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return typeof value === 'string' ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function hasActiveProposal(row) {
  return (
    row &&
    row.status === 'pending' &&
    row.moderation_proposed_action &&
    !row.moderation_cancelled_at
  );
}

async function loadRequestRow(requestId, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id, status, category, created_by, joined_user_id, start_date, end_date,
            moderation_proposed_action, moderation_proposed_at, moderation_finalize_at,
            moderation_proposed_reason_code, moderation_proposed_meta,
            moderation_proposed_rule_version, moderation_confirmed_by, moderation_confirmed_at,
            moderation_cancelled_at, submitted_for_review_at, name,
            integrity_check_json, integrity_checked_at
     FROM requests WHERE id = ?`,
    [requestId]
  );
  return rows[0] || null;
}

async function fetchDonationsSummary(requestId) {
  const [rows] = await pool.execute(
    `SELECT COUNT(id) AS donations_count, COALESCE(SUM(amount), 0) AS total_amount
     FROM donations WHERE request_id = ?`,
    [requestId]
  );
  const row = rows[0] || {};
  return {
    count: Number(row.donations_count) || 0,
    total_amount: Number(row.total_amount) || 0,
    currency: 'USD',
  };
}

function buildModerationUi(row, donationsSummary) {
  const active = hasActiveProposal(row);
  const finalizeAt = row.moderation_finalize_at ? new Date(row.moderation_finalize_at) : null;
  const now = Date.now();
  const secondsUntilFinalize =
    active && finalizeAt && finalizeAt.getTime() > now
      ? Math.max(0, Math.floor((finalizeAt.getTime() - now) / 1000))
      : 0;

  return {
    proposed_action: active ? row.moderation_proposed_action : null,
    proposed_at: active ? row.moderation_proposed_at : null,
    finalize_at: active ? row.moderation_finalize_at : null,
    seconds_until_finalize: secondsUntilFinalize,
    reason_code: active ? row.moderation_proposed_reason_code : null,
    reason_summary: active
      ? row.moderation_proposed_reason_code || null
      : null,
    meta: active ? parseMeta(row.moderation_proposed_meta) : null,
    rule_version: active ? row.moderation_proposed_rule_version : null,
    cancelled_at: row.moderation_cancelled_at || null,
    confirmed_by: row.moderation_confirmed_by || null,
    confirmed_at: row.moderation_confirmed_at || null,
    can_confirm: active,
    can_cancel: active,
    can_manual_approve: row.status === 'pending',
    can_manual_reject: row.status === 'pending',
    auto_moderation_enabled: isAutoModerationEnabled(),
    donations_summary: donationsSummary,
    integrity_check: parseMeta(row.integrity_check_json),
    integrity_checked_at: row.integrity_checked_at || null,
    integrity_summary_for_moderator: buildIntegritySummaryForModerator(row),
  };
}

function buildIntegritySummaryForModerator(row) {
  const ic = parseMeta(row.integrity_check_json);
  if (!ic || !Array.isArray(ic.issues) || ic.issues.length === 0) {
    const meta = parseMeta(row.moderation_proposed_meta);
    if (meta?.integrity_summary) return meta.integrity_summary;
    if (meta?.integrity_summary_en) return meta.integrity_summary_en;
    return null;
  }
  return ic.issues
    .map((i) => i.message_en || i.message || i.code)
    .filter(Boolean)
    .join('; ');
}

function computeSpeedCleanupEarnedCoin(startDate, endDate) {
  if (!startDate || !endDate) return false;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMinutes = (end - start) / (1000 * 60);
  return diffMinutes >= 20;
}

async function clearProposalFields(requestId, connection = pool) {
  await connection.execute(
    `UPDATE requests SET
       moderation_proposed_action = NULL,
       moderation_proposed_at = NULL,
       moderation_finalize_at = NULL,
       moderation_proposed_reason_code = NULL,
       moderation_proposed_meta = NULL,
       moderation_proposed_rule_version = NULL,
       updated_at = NOW()
     WHERE id = ?`,
    [requestId]
  );
}

/**
 * Предварительное решение (клиентский status остаётся pending).
 */
async function proposeModerationDecision(requestId, options = {}) {
  const { action, reasonCode = null, meta = null, ruleVersion = DEFAULT_RULE_VERSION } = options;
  if (action !== 'approve' && action !== 'reject') {
    const err = new Error('action must be approve or reject');
    err.code = 'INVALID_ACTION';
    throw err;
  }

  const row = await loadRequestRow(requestId);
  if (!row) {
    const err = new Error('Request not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (row.status !== 'pending') {
    const err = new Error('Request must be in status pending');
    err.code = 'INVALID_STATUS';
    throw err;
  }
  if (hasActiveProposal(row)) {
    const err = new Error('Active moderation proposal already exists');
    err.code = 'PROPOSAL_EXISTS';
    throw err;
  }

  const graceMs = GRACE_HOURS * 60 * 60 * 1000;
  const metaJson = meta != null ? JSON.stringify(meta) : null;

  await pool.execute(
    `UPDATE requests SET
       moderation_proposed_action = ?,
       moderation_proposed_at = NOW(),
       moderation_finalize_at = DATE_ADD(NOW(), INTERVAL ? HOUR),
       moderation_proposed_reason_code = ?,
       moderation_proposed_meta = ?,
       moderation_proposed_rule_version = ?,
       moderation_cancelled_at = NULL,
       moderation_confirmed_by = NULL,
       moderation_confirmed_at = NULL,
       updated_at = NOW()
     WHERE id = ? AND status = 'pending'`,
    [action, GRACE_HOURS, reasonCode, metaJson, ruleVersion, requestId]
  );

  if (action === 'reject') {
    const donationsSummary = await fetchDonationsSummary(requestId);
    sendModerationAutoRejectPendingNotification({
      requestId,
      requestName: row.name,
      requestCategory: row.category,
      finalizeAt: new Date(Date.now() + graceMs).toISOString(),
      donationsCount: donationsSummary.count,
      donationsTotal: donationsSummary.total_amount,
      reasonCode,
    }).catch(() => {});
  }

  const updated = await loadRequestRow(requestId);
  const donationsSummary = await fetchDonationsSummary(requestId);
  return {
    request_id: requestId,
    status: updated.status,
    moderation: buildModerationUi(updated, donationsSummary),
  };
}

async function cancelProposedModeration(requestId, adminUserId) {
  const row = await loadRequestRow(requestId);
  if (!row) {
    const err = new Error('Request not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (!hasActiveProposal(row)) {
    const err = new Error('No active moderation proposal');
    err.code = 'NO_PROPOSAL';
    throw err;
  }

  await pool.execute(
    `UPDATE requests SET
       moderation_proposed_action = NULL,
       moderation_proposed_at = NULL,
       moderation_finalize_at = NULL,
       moderation_proposed_reason_code = NULL,
       moderation_proposed_meta = NULL,
       moderation_proposed_rule_version = NULL,
       moderation_cancelled_at = NOW(),
       updated_at = NOW()
     WHERE id = ?`,
    [requestId]
  );

  const updated = await loadRequestRow(requestId);
  const donationsSummary = await fetchDonationsSummary(requestId);
  return {
    request_id: requestId,
    status: updated.status,
    moderation: buildModerationUi(updated, donationsSummary),
  };
}

/**
 * Финальный approve/reject (коины, Stripe, пуши пользователям).
 */
async function finalizeModeration(requestId, options = {}) {
  const {
    action,
    source = 'manual',
    adminUserId = null,
    rejectionReason = null,
    rejectionMessage = null,
    useProposed = false,
  } = options;

  const row = await loadRequestRow(requestId);
  if (!row) {
    const err = new Error('Request not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (row.status !== 'pending') {
    const err = new Error('Request must be in status pending');
    err.code = 'INVALID_STATUS';
    throw err;
  }

  let finalAction = action;
  if (useProposed) {
    if (!hasActiveProposal(row)) {
      const err = new Error('No active moderation proposal');
      err.code = 'NO_PROPOSAL';
      throw err;
    }
    finalAction = row.moderation_proposed_action;
  }
  if (finalAction !== 'approve' && finalAction !== 'reject') {
    const err = new Error('action must be approve or reject');
    err.code = 'INVALID_ACTION';
    throw err;
  }

  const category = row.category;
  const categoryNorm = String(category || '').trim().toLowerCase();
  const creatorId = row.created_by;
  let transferResult = null;

  if (finalAction === 'approve') {
    await pool.execute(
      `UPDATE requests SET status = 'approved', approved_at = NOW(), submitted_for_review_at = NULL,
         moderation_confirmed_by = ?, moderation_confirmed_at = IF(? IS NOT NULL, NOW(), moderation_confirmed_at),
         updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [adminUserId, adminUserId, requestId]
    );
    await clearProposalFields(requestId);

    try {
      if (categoryNorm === 'wastelocation') {
        transferResult = await handleWasteApproval(requestId, creatorId);
      } else if (categoryNorm === 'event') {
        await handleEventApproval(requestId, creatorId);
      } else if (categoryNorm === 'speedcleanup') {
        const earnedCoin = computeSpeedCleanupEarnedCoin(row.start_date, row.end_date);
        await handleSpeedCleanupApproval(requestId, creatorId, earnedCoin);
      }
    } catch (handlerErr) {
      console.error('[requestModeration] Approval handler error:', handlerErr);
    }
  } else {
    const reason =
      rejectionReason ||
      row.moderation_proposed_reason_code ||
      (source === 'auto' ? 'Auto-moderation rejected' : 'Rejected by moderator');
    await pool.execute(
      `UPDATE requests SET
         moderation_confirmed_by = ?,
         moderation_confirmed_at = IF(? IS NOT NULL, NOW(), moderation_confirmed_at),
         updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [adminUserId, adminUserId, requestId]
    );
    await clearProposalFields(requestId);
    try {
      await handleRequestRejection(requestId, category, creatorId, reason, rejectionMessage);
    } catch (handlerErr) {
      console.error('[requestModeration] Rejection handler error:', handlerErr);
    }
  }

  const detail = await buildRequestDetailForApi(pool, requestId);
  return {
    request: detail?.request || null,
    transfer_result: transferResult || undefined,
    finalized_action: finalAction,
    source,
  };
}

async function confirmProposedModeration(requestId, adminUserId) {
  return finalizeModeration(requestId, {
    useProposed: true,
    source: 'manual',
    adminUserId,
  });
}

async function finalizeDueProposals() {
  const [rows] = await pool.execute(
    `SELECT id FROM requests
     WHERE status = 'pending'
       AND moderation_proposed_action IS NOT NULL
       AND moderation_cancelled_at IS NULL
       AND moderation_finalize_at IS NOT NULL
       AND moderation_finalize_at <= NOW()`
  );

  let finalized = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      await finalizeModeration(row.id, { useProposed: true, source: 'auto' });
      finalized++;
    } catch (e) {
      errors++;
      console.error('[requestModeration] finalizeDueProposals error:', row.id, e.message);
    }
  }
  return { finalized, errors, total: rows.length };
}

async function getModerationDetail(requestId) {
  const row = await loadRequestRow(requestId);
  if (!row) {
    const err = new Error('Request not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const donationsSummary = await fetchDonationsSummary(requestId);
  const detail = await buildRequestDetailForApi(pool, requestId);
  return {
    request: detail?.request || null,
    moderation: buildModerationUi(row, donationsSummary),
  };
}

async function listModerationQueue(query = {}) {
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  const hasProposed = query.has_proposed;
  const proposedAction = query.proposed_action;
  const sort = query.sort === 'submitted' ? 'submitted' : 'finalize_at';

  const conditions = ["r.status = 'pending'"];
  const params = [];

  if (hasProposed === '1' || hasProposed === 'true') {
    conditions.push('r.moderation_proposed_action IS NOT NULL');
    conditions.push('r.moderation_cancelled_at IS NULL');
  } else if (hasProposed === '0' || hasProposed === 'false') {
    conditions.push('(r.moderation_proposed_action IS NULL OR r.moderation_cancelled_at IS NOT NULL)');
  }

  if (proposedAction === 'approve' || proposedAction === 'reject') {
    conditions.push('r.moderation_proposed_action = ?');
    conditions.push('r.moderation_cancelled_at IS NULL');
    params.push(proposedAction);
  }

  const orderBy =
    sort === 'submitted'
      ? 'COALESCE(r.submitted_for_review_at, r.updated_at) ASC'
      : `CASE WHEN r.moderation_finalize_at IS NULL THEN 1 ELSE 0 END,
         r.moderation_finalize_at ASC,
         COALESCE(r.submitted_for_review_at, r.updated_at) ASC`;

  const where = conditions.join(' AND ');
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM requests r WHERE ${where}`,
    params
  );
  const total = Number(countRows[0]?.total) || 0;

  const [items] = await pool.execute(
    `SELECT r.id, r.name, r.category, r.status, r.created_at, r.updated_at,
            r.submitted_for_review_at, r.created_by, r.joined_user_id,
            r.moderation_proposed_action, r.moderation_proposed_at, r.moderation_finalize_at,
            r.moderation_proposed_reason_code, r.moderation_cancelled_at,
            r.integrity_check_json, r.integrity_checked_at,
            u.display_name AS creator_name,
            d.donations_count, d.total_donations
     FROM requests r
     LEFT JOIN users u ON r.created_by = u.id
     LEFT JOIN (
       SELECT request_id, COUNT(id) AS donations_count, COALESCE(SUM(amount), 0) AS total_donations
       FROM donations GROUP BY request_id
     ) d ON d.request_id = r.id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const mapped = await Promise.all(
    items.map(async (row) => {
      const donationsSummary = {
        count: Number(row.donations_count) || 0,
        total_amount: Number(row.total_donations) || 0,
        currency: 'USD',
      };
      return {
        id: row.id,
        name: row.name,
        category: row.category,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        submitted_for_review_at: row.submitted_for_review_at,
        creator_name: row.creator_name,
        moderation: buildModerationUi(row, donationsSummary),
      };
    })
  );

  return { items: mapped, total, limit, offset };
}

module.exports = {
  GRACE_HOURS,
  isAutoModerationEnabled,
  hasActiveProposal,
  buildModerationUi,
  proposeModerationDecision,
  cancelProposedModeration,
  confirmProposedModeration,
  finalizeModeration,
  finalizeDueProposals,
  getModerationDetail,
  listModerationQueue,
  fetchDonationsSummary,
};
