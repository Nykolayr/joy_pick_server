const {
  messageKeyForCode,
  messageEnForCode,
  REASON,
} = require('../services/requestIntegrity/reasonCodes');

const KNOWN_CODES = new Set(Object.values(REASON));

function looksLikeIntegrityCode(text) {
  if (text == null || typeof text !== 'string') return false;
  const s = text.trim();
  if (!s) return false;
  if (KNOWN_CODES.has(s)) return true;
  return /^[A-Z][A-Z0-9_]{4,}$/.test(s);
}

/**
 * Текст для push/in-app: не сырой WORK_TOO_SHORT_SPEED, а message_key + readable fallback.
 */
function resolveRejectionNotificationText({
  rejectionMessage = null,
  primaryCode = null,
  messageKey = null,
  messageType = 'creator',
} = {}) {
  let code = primaryCode || null;
  if (!code && looksLikeIntegrityCode(rejectionMessage)) {
    code = String(rejectionMessage).trim();
  }

  const resolvedMessageKey = messageKey || (code ? messageKeyForCode(code) : null);
  const readableEn = code ? messageEnForCode(code) : null;

  let body = rejectionMessage;
  if (!body || looksLikeIntegrityCode(body)) {
    if (messageType === 'donor') {
      body = readableEn
        ? `Request you donated to was rejected: ${readableEn}`
        : 'Request you donated to was rejected';
    } else if (messageType === 'executor' || messageType === 'participant') {
      body = readableEn || 'Your submission was rejected';
    } else {
      body = readableEn || 'Your request was rejected';
    }
  }

  const titleKey =
    messageType === 'donor'
      ? 'notification_request_rejected_donor_title'
      : messageType === 'executor' || messageType === 'participant'
        ? 'notification_request_rejected_executor_title'
        : 'notification_request_rejected_creator_title';

  return {
    body,
    messageKey: resolvedMessageKey,
    primaryCode: code,
    titleKey,
  };
}

module.exports = {
  resolveRejectionNotificationText,
  looksLikeIntegrityCode,
};
