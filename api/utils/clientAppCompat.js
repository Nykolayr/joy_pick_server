/**
 * POST /api/requests: блокировка на create только если клиент передал integrity_enforce.
 * Без поля / false / 0 — legacy: заявка создаётся; проверка на pending для модерации.
 */

function parseTruthyField(raw) {
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}

function parseIntegrityEnforce(req) {
  const raw = req.body?.integrity_enforce ?? req.query?.integrity_enforce;
  return parseTruthyField(raw);
}

function supportsIntegrityBlockOnCreate(req) {
  return parseIntegrityEnforce(req);
}

function requiresDescriptionOnCreate(req) {
  return parseIntegrityEnforce(req);
}

function normalizeDescriptionForCreate(req, description, name) {
  const trimmed = String(description ?? '').trim();
  if (trimmed) return trimmed;
  if (requiresDescriptionOnCreate(req)) return '';
  const fromName = String(name ?? '').trim();
  return fromName || '—';
}

module.exports = {
  parseIntegrityEnforce,
  supportsIntegrityBlockOnCreate,
  requiresDescriptionOnCreate,
  normalizeDescriptionForCreate,
};
