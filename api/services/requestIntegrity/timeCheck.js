const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');

const WASTE_MIN_MINUTES = Math.max(1, parseInt(process.env.INTEGRITY_MIN_WASTE_MINUTES || '15', 10) || 15);
const SPEED_MIN_MINUTES = Math.max(1, parseInt(process.env.INTEGRITY_MIN_SPEED_MINUTES || '20', 10) || 20);

function issue(code, field = 'time', severity = 'reject') {
  return {
    code,
    field,
    severity,
    source: 'rules',
    message_key: messageKeyForCode(code),
    message_en: messageEnForCode(code),
  };
}

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.abs(t2 - t1) / (1000 * 60);
}

function checkTime({ category, phase, workDurationMinutes, joinDate, submittedForReviewAt, startDate, endDate }) {
  if (phase !== 'moderate' && phase !== 'close') return [];

  const issues = [];
  const cat = String(category || '').toLowerCase();

  if (cat === 'wastelocation') {
    const joinToSubmit = minutesBetween(joinDate, submittedForReviewAt);
    if (joinToSubmit != null && joinToSubmit < WASTE_MIN_MINUTES) {
      issues.push(issue(REASON.WORK_TOO_SHORT_WASTE));
    }
    if (workDurationMinutes != null && Number(workDurationMinutes) < WASTE_MIN_MINUTES) {
      issues.push(issue(REASON.WORK_TOO_SHORT_WASTE));
    }
  }

  if (cat === 'speedcleanup') {
    const span = minutesBetween(startDate, endDate);
    if (span != null && span < SPEED_MIN_MINUTES) {
      issues.push(issue(REASON.WORK_TOO_SHORT_SPEED));
    }
    if (workDurationMinutes != null && Number(workDurationMinutes) < SPEED_MIN_MINUTES) {
      issues.push(issue(REASON.WORK_TOO_SHORT_SPEED));
    }
  }

  return issues;
}

module.exports = { checkTime, WASTE_MIN_MINUTES, SPEED_MIN_MINUTES };
