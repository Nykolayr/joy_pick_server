/**
 * Нормализация и проверка гостевого идентификатора для support AI (UUID в заголовке X-Support-Guest-Id).
 * @param {unknown} raw
 * @returns {string|null} нижний регистр UUID или null
 */
function normalizeSupportGuestKey(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s.length < 32 || s.length > 64) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return null;
  return s.toLowerCase();
}

function guestKeyFromRequest(req) {
  const h = req.headers['x-support-guest-id'] ?? req.headers['X-Support-Guest-Id'];
  return normalizeSupportGuestKey(h);
}

module.exports = {
  normalizeSupportGuestKey,
  guestKeyFromRequest
};
