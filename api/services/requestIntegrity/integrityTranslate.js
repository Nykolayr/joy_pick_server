const { SUPPORTED_LOCALES } = require('../translateNews');
const { SUMMARY_EN, SUMMARY_CLOSE_EN, messageKeyForCode } = require('./reasonCodes');

function normalizeLocale(locale) {
  const l = String(locale || 'en')
    .trim()
    .toLowerCase()
    .split('-')[0];
  return SUPPORTED_LOCALES.includes(l) ? l : 'en';
}

/**
 * Локализация текстов ошибок — на клиенте по message_key / summary_key (ARB).
 * Без Google Translate на сервере (быстро, все языки приложения).
 */
function localizeIntegrityResult(result, locale) {
  const loc = normalizeLocale(locale);
  const phase = result.phase || 'create';

  if (result.ok) {
    return { ...result, locale: loc };
  }

  const summaryKey =
    phase === 'close' ? 'integrity_check_failed_close_summary' : 'integrity_check_failed_summary';
  const summaryEn = result.summary_en || (phase === 'close' ? SUMMARY_CLOSE_EN : SUMMARY_EN);

  const issues = (result.issues || []).map((issue) => ({
    ...issue,
    message_key: issue.message_key || messageKeyForCode(issue.code),
    message_en: issue.message_en || issue.message || '',
    message: issue.message_en || issue.message || '',
  }));

  return {
    ...result,
    locale: loc,
    summary_key: summaryKey,
    summary_en: summaryEn,
    summary: summaryEn,
    issues,
  };
}

module.exports = {
  normalizeLocale,
  localizeIntegrityResult,
};
