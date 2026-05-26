const { supportsIntegrityEnforce } = require('./clientAppCompat');
const { sendIntegrityCheckFailed } = require('./integrityErrorResponse');
const {
  saveCompletionIntegrityRejected,
} = require('../services/completionIntegrityPersist');

/**
 * При integrity_enforce=true и провале — 422, опционально пишем completion_integrity_* в БД.
 * @returns {Promise<boolean>} true если ответ уже отправлен
 */
async function integrityEnforceOrRespond(req, res, checkFn, options = {}) {
  const { requestId } = options;
  if (!supportsIntegrityEnforce(req)) return false;
  const result = await checkFn();
  if (!result.ok) {
    if (requestId) {
      try {
        await saveCompletionIntegrityRejected(requestId, result);
      } catch (e) {
        console.error('[integrityGate] saveCompletionIntegrityRejected:', requestId, e.message);
      }
    }
    sendIntegrityCheckFailed(res, result);
    return true;
  }
  return false;
}

module.exports = { integrityEnforceOrRespond };
