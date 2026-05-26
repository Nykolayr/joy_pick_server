const { supportsIntegrityEnforce } = require('./clientAppCompat');
const { sendIntegrityCheckFailed } = require('./integrityErrorResponse');

/**
 * При integrity_enforce=true и провале проверки — 422, вызывающий код не должен менять статус.
 * @returns {Promise<boolean>} true если ответ уже отправлен
 */
async function integrityEnforceOrRespond(req, res, checkFn) {
  if (!supportsIntegrityEnforce(req)) return false;
  const result = await checkFn();
  if (!result.ok) {
    sendIntegrityCheckFailed(res, result);
    return true;
  }
  return false;
}

module.exports = { integrityEnforceOrRespond };
