const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/**
 * Явный request_id из тела или из data (поля, deeplink, parameterData JSON).
 */
function resolveRequestIdFromSendPayload({ request_id: explicit, data }) {
  if (isUuid(explicit)) {
    return explicit.trim();
  }
  const d = data && typeof data === 'object' ? data : {};
  for (const key of ['request_id', 'requestId', 'requestUUID']) {
    if (isUuid(d[key])) {
      return String(d[key]).trim();
    }
  }
  const deeplink = d.deeplink || d.deep_link || d.deepLink;
  if (typeof deeplink === 'string') {
    const m = deeplink.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (m && isUuid(m[1])) {
      return m[1];
    }
  }
  const pd = d.parameterData;
  if (typeof pd === 'string' && pd.trim()) {
    try {
      const parsed = JSON.parse(pd);
      if (parsed && typeof parsed === 'object') {
        for (const key of ['request_id', 'requestId', 'id']) {
          if (isUuid(parsed[key])) {
            return String(parsed[key]).trim();
          }
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

module.exports = {
  isUuid,
  resolveRequestIdFromSendPayload,
};
