const pool = require('../config/database');
const { checkRequestIntegrity, saveIntegrityOnRequest } = require('./requestIntegrity');
const { parseJsonArraySafe, parseJsonFieldSafe } = require('../utils/requestPayloadParsers');
const {
  proposeModerationDecision,
  isAutoModerationEnabled,
} = require('./requestModerationService');

async function loadRequestForIntegrity(requestId) {
  const [rows] = await pool.execute(
    `SELECT id, status, category, name, description, latitude, longitude, city,
            photos_before, photos_after, work_duration_minutes, joined_user_id,
            submitted_for_review_at, start_date, end_date, participant_completions,
            join_date
     FROM requests WHERE id = ?`,
    [requestId]
  );
  return rows[0] || null;
}

/**
 * Проверка integrity для заявки в pending; сохранение в БД; при включённой автомодерации — proposed reject.
 */
async function runIntegrityOnPending(requestId, options = {}) {
  const row = await loadRequestForIntegrity(requestId);
  if (!row || row.status !== 'pending') {
    return { skipped: true, reason: 'not_pending' };
  }

  const photosBefore = parseJsonArraySafe(row.photos_before);
  const photosAfter = parseJsonArraySafe(row.photos_after);
  const completions = parseJsonFieldSafe(row.participant_completions, {});

  const integrity = await checkRequestIntegrity({
    phase: 'moderate',
    category: row.category,
    name: row.name,
    description: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    city: row.city,
    photosBefore,
    photosAfter,
    workDurationMinutes: row.work_duration_minutes,
    joinDate: row.join_date,
    submittedForReviewAt: row.submitted_for_review_at,
    startDate: row.start_date,
    endDate: row.end_date,
    locale: options.locale || 'en',
  });

  await saveIntegrityOnRequest(requestId, integrity);

  let proposed = null;
  if (!integrity.ok && isAutoModerationEnabled()) {
    try {
      proposed = await proposeModerationDecision(requestId, {
        action: 'reject',
        reasonCode: integrity.primary_reject_code || 'INTEGRITY_FAILED',
        meta: {
          integrity_issues: integrity.issues,
          integrity_summary: integrity.summary,
          integrity_summary_en: integrity.summary_en,
        },
        ruleVersion: integrity.rule_version,
      });
    } catch (e) {
      if (e.code !== 'PROPOSAL_EXISTS') {
        console.error('[integrityOnPending] propose failed:', requestId, e.message);
      }
    }
  }

  return { integrity, proposed };
}

module.exports = {
  runIntegrityOnPending,
  loadRequestForIntegrity,
};
