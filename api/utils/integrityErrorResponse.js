/**
 * 422 при провале integrity (создание или закрытие — заявка не создаётся / не уходит в pending).
 */
function sendIntegrityCheckFailed(res, integrityPayload, statusCode = 422) {
  const phase = integrityPayload.phase || 'create';
  const defaultMsg =
    phase === 'close'
      ? 'Could not submit work for review.'
      : 'Request did not pass verification.';
  return res.status(statusCode).json({
    success: false,
    errorCode: 'INTEGRITY_CHECK_FAILED',
    message: integrityPayload.summary || integrityPayload.summary_en || defaultMsg,
    data: {
      integrity: {
        ok: false,
        request_created: false,
        request_closed: false,
        summary_key: integrityPayload.summary_key || null,
        ...integrityPayload,
      },
    },
  });
}

module.exports = { sendIntegrityCheckFailed };
