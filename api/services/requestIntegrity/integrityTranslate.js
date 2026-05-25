const { translateOne, SUPPORTED_LOCALES } = require('../translateNews');
const { SUMMARY_EN } = require('./reasonCodes');

function normalizeLocale(locale) {
  const l = String(locale || 'en')
    .trim()
    .toLowerCase()
    .split('-')[0];
  return SUPPORTED_LOCALES.includes(l) ? l : 'en';
}

async function translateText(text, targetLocale, sourceLang = 'en') {
  const locale = normalizeLocale(targetLocale);
  if (!text || locale === sourceLang) return text;
  const { text: out, error } = await translateOne(text, sourceLang, locale);
  return error ? text : out || text;
}

async function localizeIntegrityResult(result, locale) {
  const loc = normalizeLocale(locale);
  const issues = [];
  for (const issue of result.issues || []) {
    const base = issue.message_en || issue.message || '';
    const message = await translateText(base, loc, 'en');
    issues.push({
      ...issue,
      message,
      message_key: issue.message_key,
    });
  }
  const summary = await translateText(result.summary_en || SUMMARY_EN, loc, 'en');
  return {
    ...result,
    locale: loc,
    summary,
    summary_en: result.summary_en || SUMMARY_EN,
    issues,
  };
}

module.exports = {
  normalizeLocale,
  localizeIntegrityResult,
};
