const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');
const { messageForCodeAndLocale } = require('./integrityLocalizedMessages');
const { looksLikePaymentInTitle } = require('./paymentInstructionsHeuristic');

function issue(code, field, source = 'rules', extra = {}, locale) {
  const localized = locale ? messageForCodeAndLocale(code, locale) : null;
  return {
    code,
    field,
    severity: 'block',
    source,
    message_key: messageKeyForCode(code),
    message_en: localized || messageEnForCode(code),
    message: localized || messageEnForCode(code),
    ...extra,
  };
}

const MIN_DESCRIPTION_CHARS = Math.max(
  8,
  parseInt(process.env.INTEGRITY_MIN_DESCRIPTION_CHARS || '12', 10) || 12
);
const MIN_DESCRIPTION_WORDS = Math.max(
  2,
  parseInt(process.env.INTEGRITY_MIN_DESCRIPTION_WORDS || '2', 10) || 2
);

function usesSpaceSeparatedWords(text) {
  return /[a-zA-Zа-яА-ЯёЁ]/.test(text);
}

function isGibberish(text, { isDescription = false } = {}) {
  const s = String(text || '').trim();
  const contentChars = s.replace(/[\s\d\p{P}\p{S}]/gu, '');
  const minContentLen = usesSpaceSeparatedWords(s) ? 3 : 2;
  if (contentChars.length < minContentLen) return true;
  if (/(.)\1{4,}/u.test(s)) return true;

  const words = s.split(/\s+/).filter((w) => w.length >= 1);
  const meaningfulWords = words.filter((w) => w.replace(/[\s\d\p{P}\p{S}]/gu, '').length >= 2);

  // Латиница — по словам, не по всей строке без пробелов (иначе ломается EN)
  for (const word of words) {
    const latin = word.replace(/[^a-zA-Z]/g, '');
    if (latin.length < 4) continue;
    const compact = latin.toLowerCase();
    const vowels = (compact.match(/[aeiouy]/g) || []).length;
    const ratio = vowels / compact.length;
    if (ratio < 0.08) return true;
    if (compact.length <= 12 && (ratio < 0.12 || ratio > 0.85)) return true;
    if (/[bcdfghjklmnpqrstvwxyz]{6,}/i.test(compact)) return true;
  }

  // Кириллица — явный мусор без гласных
  for (const word of words) {
    const cyr = word.replace(/[^а-яА-ЯёЁ]/g, '');
    if (cyr.length < 4) continue;
    const vowels = (cyr.match(/[аеёиоуыэюя]/gi) || []).length;
    if (vowels / cyr.length < 0.08) return true;
  }

  if (meaningfulWords.length === 0 && s.length > 5) return true;

  if (isDescription) {
    if (usesSpaceSeparatedWords(s)) {
      if (s.length < MIN_DESCRIPTION_CHARS && meaningfulWords.length < MIN_DESCRIPTION_WORDS) {
        return true;
      }
    } else if (contentChars.length < 6) {
      return true;
    }
  }

  return false;
}

function checkTextRequired({ name, description, locale }) {
  const issues = [];
  const n = String(name || '').trim();
  const d = String(description || '').trim();

  if (!n) issues.push(issue(REASON.MISSING_NAME, 'name', 'rules', {}, locale));
  if (!d) issues.push(issue(REASON.MISSING_DESCRIPTION, 'description', 'rules', {}, locale));

  return issues;
}

function checkTextGibberishRules({ name, description, locale }) {
  const issues = [];
  const n = String(name || '').trim();
  const d = String(description || '').trim();

  if (n) {
    if (looksLikePaymentInTitle(n)) {
      issues.push(issue(REASON.PAYMENT_IN_TITLE, 'name', 'rules', {}, locale));
    } else if (isGibberish(n, { isDescription: false })) {
      issues.push(issue(REASON.GIBBERISH_NAME, 'name', 'rules', {}, locale));
    }
  }
  if (d && isGibberish(d, { isDescription: true })) {
    issues.push(issue(REASON.GIBBERISH_DESCRIPTION, 'description', 'rules', {}, locale));
  }

  return issues;
}

/** Текст проверяется только на create. Close / pending — без текста. */
async function checkText({ name, description, phase, locale, category }) {
  if (phase !== 'create') return [];

  const issues = checkTextRequired({ name, description, locale });
  if (issues.some((i) => i.code === REASON.MISSING_NAME || i.code === REASON.MISSING_DESCRIPTION)) {
    return issues;
  }

  issues.push(...checkTextGibberishRules({ name, description, locale }));
  if (issues.length > 0) return issues;

  const { isTextAiEnabled, checkTextWithAi } = require('./textAiCheck');
  if (!isTextAiEnabled()) return issues;

  const n = String(name || '').trim();
  const d = String(description || '').trim();
  const nameGibberish = n ? isGibberish(n, { isDescription: false }) : false;
  const descriptionGibberish = d ? isGibberish(d, { isDescription: true }) : false;

  const aiIssues = await checkTextWithAi({
    name,
    description,
    locale,
    category,
    phase,
    nameGibberish,
    descriptionGibberish,
  });
  if (aiIssues === null) {
    return issues;
  }
  return issues.concat(aiIssues);
}

module.exports = { checkText, checkTextRequired, checkTextGibberishRules, isGibberish };
