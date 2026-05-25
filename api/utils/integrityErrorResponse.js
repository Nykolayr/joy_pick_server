/**
 * Ответ при провале integrity на создании заявки (заявка не создаётся).
 */
function sendIntegrityCheckFailed(res, integrityPayload, statusCode = 422) {
  return res.status(statusCode).json({
    success: false,
    errorCode: 'INTEGRITY_CHECK_FAILED',
    message: integrityPayload.summary || integrityPayload.summary_en || 'Request did not pass verification.',
    data: {
      integrity: {
        ok: false,
        request_created: false,
        ...integrityPayload,
      },
    },
  });
}

module.exports = { sendIntegrityCheckFailed };
