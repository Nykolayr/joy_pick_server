const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');

function issue(code, field = 'location', source = 'rules', extra = {}) {
  return {
    code,
    field,
    severity: 'block',
    source,
    message_key: messageKeyForCode(code),
    message_en: messageEnForCode(code),
    ...extra,
  };
}

async function checkGeo({ latitude, longitude }) {
  const issues = [];
  const lat = latitude != null && latitude !== '' ? parseFloat(latitude) : NaN;
  const lng = longitude != null && longitude !== '' ? parseFloat(longitude) : NaN;

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    issues.push(issue(REASON.MISSING_COORDS));
    return issues;
  }
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) {
    issues.push(issue(REASON.INVALID_COORDS));
    return issues;
  }
  if (Math.abs(lat) > 85) {
    issues.push(issue(REASON.INVALID_COORDS));
    return issues;
  }

  if (process.env.INTEGRITY_GEO_NOMINATIM !== '0') {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`;
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'JoyPick-Server/1.0 (integrity-check)' },
      });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        const err = data?.error;
        if (err) {
          issues.push(issue(REASON.GEO_NOT_LAND));
        } else {
          const cls = `${data?.class || ''} ${data?.type || ''}`.toLowerCase();
          if (cls.includes('water') || cls.includes('bay') || cls.includes('ocean') || cls.includes('sea')) {
            issues.push(issue(REASON.GEO_NOT_LAND));
          }
        }
      }
    } catch {
      // не блокируем создание при сбое geocoder
    }
  }

  return issues;
}

module.exports = { checkGeo };
