const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');

const CLOSE_RADIUS_METERS = Math.max(
  50,
  parseInt(process.env.INTEGRITY_CLOSE_RADIUS_METERS || '200', 10) || 200
);

function issue(code, field = 'location', extra = {}) {
  return {
    code,
    field,
    severity: 'reject',
    source: 'rules',
    message_key: messageKeyForCode(code),
    message_en: messageEnForCode(code),
    ...extra,
  };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Исполнитель/участник в момент сдачи должен быть в радиусе точки заявки (погрешность GPS).
 */
function checkExecutorAtRequestSite({
  requestLatitude,
  requestLongitude,
  completionLatitude,
  completionLongitude,
  field = 'location',
}) {
  const issues = [];
  const rLat = requestLatitude != null && requestLatitude !== '' ? parseFloat(requestLatitude) : NaN;
  const rLng = requestLongitude != null && requestLongitude !== '' ? parseFloat(requestLongitude) : NaN;
  const cLat =
    completionLatitude != null && completionLatitude !== '' ? parseFloat(completionLatitude) : NaN;
  const cLng =
    completionLongitude != null && completionLongitude !== '' ? parseFloat(completionLongitude) : NaN;

  if (Number.isNaN(cLat) || Number.isNaN(cLng)) {
    issues.push(issue(REASON.EXECUTOR_COORDS_MISSING, field));
    return issues;
  }
  if (Number.isNaN(rLat) || Number.isNaN(rLng)) {
    return issues;
  }

  const distanceMeters = haversineMeters(rLat, rLng, cLat, cLng);
  if (distanceMeters > CLOSE_RADIUS_METERS) {
    issues.push(
      issue(REASON.EXECUTOR_TOO_FAR, field, {
        distance_meters: Math.round(distanceMeters),
        max_meters: CLOSE_RADIUS_METERS,
      })
    );
  }
  return issues;
}

module.exports = { checkExecutorAtRequestSite, CLOSE_RADIUS_METERS };
