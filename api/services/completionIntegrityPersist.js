const pool = require('../config/database');

const CLEAR_SQL = `
  completion_integrity_rejected = 0,
  completion_integrity_rejected_at = NULL,
  completion_integrity_summary = NULL,
  completion_integrity_issues = NULL,
  completion_integrity_primary_code = NULL,
  completion_integrity_locale = NULL
`;

function parseIssuesJson(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return raw;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const DB_FIELDS = [
  'completion_integrity_rejected',
  'completion_integrity_rejected_at',
  'completion_integrity_summary',
  'completion_integrity_issues',
  'completion_integrity_primary_code',
  'completion_integrity_locale',
];

/** Блок для API (мобилка / админка). */
function completionIntegrityFromRow(row) {
  if (!row || Number(row.completion_integrity_rejected) !== 1) {
    return null;
  }
  return {
    rejected: true,
    rejected_at: row.completion_integrity_rejected_at || null,
    summary: row.completion_integrity_summary || null,
    issues: parseIssuesJson(row.completion_integrity_issues) || [],
    primary_code: row.completion_integrity_primary_code || null,
    locale: row.completion_integrity_locale || null,
  };
}

/** Поле completion_integrity + убрать сырые колонки из ответа. */
function attachCompletionIntegrityToRequest(request) {
  if (!request) return request;
  request.completion_integrity = completionIntegrityFromRow(request);
  for (const key of DB_FIELDS) {
    if (key in request) delete request[key];
  }
  return request;
}

async function saveCompletionIntegrityRejected(requestId, integrityResult) {
  const summary =
    integrityResult.summary ||
    integrityResult.summary_en ||
  null;
  const issues = Array.isArray(integrityResult.issues) ? integrityResult.issues : [];
  const primaryCode = integrityResult.primary_reject_code || null;
  const locale = integrityResult.locale || null;

  await pool.execute(
    `UPDATE requests SET
       completion_integrity_rejected = 1,
       completion_integrity_rejected_at = NOW(),
       completion_integrity_summary = ?,
       completion_integrity_issues = ?,
       completion_integrity_primary_code = ?,
       completion_integrity_locale = ?,
       updated_at = NOW()
     WHERE id = ?`,
    [
      summary,
      JSON.stringify(issues),
      primaryCode,
      locale,
      requestId,
    ]
  );
}

async function clearCompletionIntegrityRejected(requestId) {
  await pool.execute(
    `UPDATE requests SET ${CLEAR_SQL}, updated_at = NOW() WHERE id = ?`,
    [requestId]
  );
}

module.exports = {
  completionIntegrityFromRow,
  attachCompletionIntegrityToRequest,
  saveCompletionIntegrityRejected,
  clearCompletionIntegrityRejected,
  CLEAR_SQL,
};
