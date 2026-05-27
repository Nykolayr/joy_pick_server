const { SUMMARY_EN, SUMMARY_CLOSE_EN } = require('./reasonCodes');
const { checkGeo } = require('./geoCheck');
const { checkText } = require('./textCheck');
const { checkPhotos } = require('./photoCheck');
const { checkTime } = require('./timeCheck');
const { checkExecutorAtRequestSite } = require('./executorGeoCheck');
const { checkEventParticipantsForClose } = require('./eventCloseCheck');
const { localizeIntegrityResult, normalizeLocale } = require('./integrityTranslate');

const RULE_VERSION = process.env.INTEGRITY_RULE_VERSION || 'integrity-v1';

function normalizePhase(phase) {
  if (phase === 'moderate' || phase === 'close') return phase;
  return 'create';
}

function pickPrimaryRejectCode(issues) {
  const reject = issues.find((i) => i.severity === 'reject' || i.severity === 'block');
  return reject ? reject.code : null;
}

function isOkForPhase(phase, issues) {
  const blocking = issues.filter((i) => i.severity === 'block');
  const rejecting = issues.filter((i) => i.severity === 'reject');
  if (phase === 'create') return blocking.length === 0;
  return rejecting.length === 0 && blocking.length === 0;
}

/**
 * @param {object} input
 * @returns {Promise<object>}
 */
async function checkRequestIntegrity(input) {
  const phase = normalizePhase(input.phase);
  const locale = normalizeLocale(input.locale);

  let issues = [];

  if (phase === 'create') {
    issues = issues.concat(await checkText({ ...input, phase }));
    issues = issues.concat(await checkPhotos(input));
  } else if (phase === 'close') {
    const cat = String(input.category || '').toLowerCase();
    if (input.eventCloseAllParticipants) {
      issues = issues.concat(
        await checkEventParticipantsForClose({
          request: input.request,
          participantCompletions: input.participantCompletions,
        })
      );
    } else {
      // Текст и фото на close не проверяем — только гео исполнителя и время.
      issues = issues.concat(
        checkExecutorAtRequestSite({
          requestLatitude: input.latitude,
          requestLongitude: input.longitude,
          completionLatitude: input.completionLatitude,
          completionLongitude: input.completionLongitude,
          field: input.completionField || 'location',
        })
      );
      issues = issues.concat(checkTime({ ...input, phase: 'close' }));
    }
  } else {
    issues = issues.concat(await checkGeo(input));
    issues = issues.concat(await checkPhotos(input));
    issues = issues.concat(checkTime({ ...input, phase }));
    if (input.completionLatitude != null || input.completionLongitude != null) {
      issues = issues.concat(
        checkExecutorAtRequestSite({
          requestLatitude: input.latitude,
          requestLongitude: input.longitude,
          completionLatitude: input.completionLatitude,
          completionLongitude: input.completionLongitude,
        })
      );
    }
  }

  const ok = isOkForPhase(phase, issues);
  const summaryBase = phase === 'close' ? SUMMARY_CLOSE_EN : SUMMARY_EN;

  const result = {
    ok,
    phase,
    rule_version: RULE_VERSION,
    checked_at: new Date().toISOString(),
    request_created: false,
    request_closed: false,
    summary_en: ok ? null : summaryBase,
    issues,
    primary_reject_code: !ok ? pickPrimaryRejectCode(issues) : null,
  };

  return localizeIntegrityResult(result, locale);
}

async function saveIntegrityOnRequest(requestId, result) {
  const pool = require('../../config/database');
  await pool.execute(
    `UPDATE requests SET integrity_check_json = ?, integrity_checked_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [JSON.stringify(result), requestId]
  );
}

module.exports = {
  checkRequestIntegrity,
  saveIntegrityOnRequest,
  normalizeLocale,
  RULE_VERSION,
};
