const { SUMMARY_EN } = require('./reasonCodes');
const { checkGeo } = require('./geoCheck');
const { checkText } = require('./textCheck');
const { checkPhotos } = require('./photoCheck');
const { checkTime } = require('./timeCheck');
const { localizeIntegrityResult, normalizeLocale } = require('./integrityTranslate');

const RULE_VERSION = process.env.INTEGRITY_RULE_VERSION || 'integrity-v1';

function pickPrimaryRejectCode(issues) {
  const reject = issues.find((i) => i.severity === 'reject' || i.severity === 'block');
  return reject ? reject.code : null;
}

/**
 * @param {object} input
 * @returns {Promise<object>}
 */
async function checkRequestIntegrity(input) {
  const phase = input.phase === 'moderate' ? 'moderate' : 'create';
  const locale = normalizeLocale(input.locale);

  let issues = [];
  issues = issues.concat(await checkGeo(input));
  issues = issues.concat(checkText({ ...input, phase }));
  issues = issues.concat(await checkPhotos(input));
  issues = issues.concat(checkTime({ ...input, phase }));

  const blocking = issues.filter((i) => i.severity === 'block');
  const rejecting = issues.filter((i) => i.severity === 'reject');
  const ok =
    phase === 'create' ? blocking.length === 0 : rejecting.length === 0 && blocking.length === 0;

  const result = {
    ok,
    phase,
    rule_version: RULE_VERSION,
    checked_at: new Date().toISOString(),
    request_created: false,
    summary_en: ok ? null : SUMMARY_EN,
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
