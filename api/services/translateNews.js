/**
 * Перевод контента новостей на все поддерживаемые локали.
 * Fallback при ошибке: английский вариант. В ответе — полный translation_report для админки.
 */
const translate = require('google-translate-api-x');

const CONTENT_DELIMITER = '[|||]';

const SUPPORTED_LOCALES = ['en', 'ru', 'es', 'ar', 'zh', 'hi', 'fr', 'pt', 'he', 'de'];

/** Map our locale codes to Google Translate codes if needed */
const toGoogleLang = (locale) => {
  if (locale === 'zh') return 'zh-cn';
  return locale;
};

/**
 * Translate one text to one language. Returns { text, error }.
 */
async function translateOne(text, fromLang, toLang) {
  if (!text || String(text).trim() === '') return { text: '', error: null };
  try {
    const res = await translate(text, {
      from: toGoogleLang(fromLang),
      to: toGoogleLang(toLang),
      client: 'gtx',
      forceBatch: true
    });
    const translated = (res && res.text) ? String(res.text) : '';
    return { text: translated, error: null };
  } catch (err) {
    return { text: '', error: err.message || String(err) };
  }
}

/**
 * Translate content to all locales. Returns { title_i18n, short_description_i18n, text_i18n, translation_report }.
 * @param {string} sourceLang - one of SUPPORTED_LOCALES
 * @param {string} title
 * @param {string} shortDescription
 * @param {string} text
 */
async function translateToAllLocales(sourceLang, title, shortDescription, text) {
  const report = {
    success: true,
    source_lang: sourceLang,
    locales: {},
    errors: [],
    warnings: []
  };

  const title_i18n = {};
  const short_description_i18n = {};
  const text_i18n = {};

  const src = sourceLang && SUPPORTED_LOCALES.includes(sourceLang) ? sourceLang : 'en';
  title_i18n[src] = title != null ? String(title).trim() : '';
  short_description_i18n[src] = shortDescription != null ? String(shortDescription).trim().slice(0, 500) : '';
  text_i18n[src] = text != null ? String(text).trim() : '';

  report.locales[src] = { status: 'ok', message: null };

  // Ensure we have English for fallback
  let enTitle = title_i18n.en;
  let enShort = short_description_i18n.en;
  let enText = text_i18n.en;
  if (src !== 'en') {
    const tTitle = await translateOne(title_i18n[src], src, 'en');
    const tShort = await translateOne(short_description_i18n[src], src, 'en');
    const tText = await translateOne(text_i18n[src], src, 'en');
    enTitle = tTitle.error ? title_i18n[src] : tTitle.text;
    enShort = tShort.error ? short_description_i18n[src] : tShort.text;
    enText = tText.error ? text_i18n[src] : tText.text;
    if (tTitle.error || tShort.error || tText.error) {
      report.warnings.push({ locale: 'en', message: 'Partial translation to en, used source as fallback' });
    }
    title_i18n.en = enTitle;
    short_description_i18n.en = enShort;
    text_i18n.en = enText;
    report.locales.en = (tTitle.error && tShort.error && tText.error) ? { status: 'fallback', message: 'Used source' } : { status: 'ok', message: null };
  }

  const targetLocales = SUPPORTED_LOCALES.filter(loc => loc !== src);

  for (const locale of targetLocales) {
    const from = src;
    const tTitle = await translateOne(title_i18n[from] || enTitle, from, locale);
    const tShort = await translateOne(short_description_i18n[from] || enShort, from, locale);
    const tText = await translateOne(text_i18n[from] || enText, from, locale);

    const useFallback = tTitle.error || tShort.error || tText.error;
    if (useFallback) {
      report.success = false;
      title_i18n[locale] = tTitle.error ? enTitle : tTitle.text;
      short_description_i18n[locale] = tShort.error ? enShort : tShort.text;
      text_i18n[locale] = tText.error ? enText : tText.text;
      const messages = [tTitle.error, tShort.error, tText.error].filter(Boolean);
      report.locales[locale] = { status: 'fallback', message: messages.join('; ') || 'Used en' };
      report.errors.push({ locale, message: messages.join('; ') });
      report.warnings.push({ locale, message: `Translation failed, used en. ${messages.join('; ')}` });
    } else {
      title_i18n[locale] = tTitle.text;
      short_description_i18n[locale] = tShort.text;
      text_i18n[locale] = tText.text;
      report.locales[locale] = { status: 'ok', message: null };
    }
  }

  return {
    title_i18n,
    short_description_i18n,
    text_i18n,
    translation_report: report
  };
}

/**
 * Parse content string "title[|||]short_description[|||]text" into { title, short_description, text }.
 * @returns {{ title, short_description, text } | { error: string }}
 */
function parseContent(content) {
  if (content == null || typeof content !== 'string') {
    return { error: 'content is required and must be a string' };
  }
  const parts = content.split(CONTENT_DELIMITER).map(s => s.trim());
  if (parts.length !== 3) {
    return { error: `content must contain exactly 3 parts separated by "${CONTENT_DELIMITER}" (got ${parts.length})` };
  }
  const [title, short_description, text] = parts;
  if (!title) return { error: 'title (first part) cannot be empty' };
  if (!text) return { error: 'text (third part) cannot be empty' };
  return { title, short_description: short_description || '', text };
}

/**
 * Parse content для статей из заявок (from_request): "theme[|||]text" — два поля (тема и текст).
 * @returns {{ theme, text } | { error: string }}
 */
function parseContentFromRequest(content) {
  if (content == null || typeof content !== 'string') {
    return { error: 'content is required and must be a string' };
  }
  const parts = content.split(CONTENT_DELIMITER).map(s => s.trim());
  if (parts.length !== 2) {
    return { error: `content for from_request must contain exactly 2 parts (theme and text) separated by "${CONTENT_DELIMITER}" (got ${parts.length})` };
  }
  const [theme, text] = parts;
  if (!theme) return { error: 'theme (first part) cannot be empty' };
  if (!text) return { error: 'text (second part) cannot be empty' };
  return { theme, text };
}

module.exports = {
  SUPPORTED_LOCALES,
  CONTENT_DELIMITER,
  translateOne,
  parseContent,
  parseContentFromRequest,
  translateToAllLocales
};
