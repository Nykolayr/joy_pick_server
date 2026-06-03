const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');

const WASTE_MIN_MINUTES = Math.max(1, parseInt(process.env.INTEGRITY_MIN_WASTE_MINUTES || '15', 10) || 15);
const SPEED_MIN_MINUTES = Math.max(1, parseInt(process.env.INTEGRITY_MIN_SPEED_MINUTES || '20', 10) || 20);
const SPEED_CLIENT_DRIFT_MINUTES = Math.max(
  1,
  parseInt(process.env.INTEGRITY_SPEED_CLIENT_DRIFT_MINUTES || '2', 10) || 2
);

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

function resolveSpeedEndTime({ endDate, submittedForReviewAt }) {
  if (endDate) return endDate;
  if (submittedForReviewAt) return submittedForReviewAt;
  return null;
}

function checkSpeedWorkDuration({ startDate, endDate, submittedForReviewAt, workDurationMinutes }) {
  const issues = [];
  const end = resolveSpeedEndTime({ endDate, submittedForReviewAt });
  const serverMinutes = startDate && end ? minutesBetween(startDate, end) : null;

  if (serverMinutes != null) {
    if (serverMinutes < SPEED_MIN_MINUTES) {
      issues.push(issue(REASON.WORK_TOO_SHORT_SPEED, 'work_duration_minutes'));
    }
    return issues;
  }

  if (workDurationMinutes != null && Number(workDurationMinutes) < SPEED_MIN_MINUTES) {
    issues.push(issue(REASON.WORK_TOO_SHORT_SPEED, 'work_duration_minutes'));
  }

  return issues;
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
    issues.push(
      ...checkSpeedWorkDuration({
        startDate,
        endDate,
        submittedForReviewAt,
        workDurationMinutes,
      })
    );
  }

  return issues;
}

module.exports = {
  checkTime,
  checkSpeedWorkDuration,
  WASTE_MIN_MINUTES,
  SPEED_MIN_MINUTES,
  SPEED_CLIENT_DRIFT_MINUTES,
};
