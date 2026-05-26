const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');

function issue(code, field, source = 'rules', extra = {}) {
  return {
    code,
    field,
    severity: 'block',
    source,
    message_key: messageKeyForCode(code),
    message_en: messageEnForCode(code),
    ...extra,
  };
}

const MIN_DESCRIPTION_CHARS = Math.max(
  10,
  parseInt(process.env.INTEGRITY_MIN_DESCRIPTION_CHARS || '20', 10) || 20
);
const MIN_DESCRIPTION_WORDS = Math.max(
  2,
  parseInt(process.env.INTEGRITY_MIN_DESCRIPTION_WORDS || '2', 10) || 2
);

function isGibberish(text, { isDescription = false } = {}) {
  const s = String(text || '').trim();
  if (s.length < 3) return true;
  const lettersOnly = s.replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s]/g, '');
  if (lettersOnly.length < 3) return true;
  if (/(.)\1{4,}/i.test(s)) return true;
  if (/^[a-z]{1,2}[a-z]{4,}$/i.test(s.replace(/\s/g, ''))) return true;
  if (/^[^a-zA-Zа-яА-ЯёЁ]*$/.test(s)) return true;

  const compact = s.replace(/\s/g, '');
  const vowels = (compact.match(/[aeiouyаеёиоуыэюя]/gi) || []).length;
  const ratio = vowels / Math.max(compact.length, 1);

  // Короткий мусор: «пддисс», «раами» — повторы букв, мало смысла
  const doubleLetterRuns = (compact.match(/(.)\1/g) || []).length;
  if (compact.length <= 8 && doubleLetterRuns >= 1) return true;
  if (compact.length <= 14 && doubleLetterRuns >= 2) return true;

  if (compact.length >= 4 && compact.length <= 12) {
    if (ratio < 0.12 || ratio > 0.8) return true;
  }
  if (compact.length > 8 && ratio < 0.08) return true;

  if (/[bcdfghjklmnpqrstvwxyzбвгджзйклмнпрстфхцчшщ]{5,}/i.test(compact)) return true;

  const words = s.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0 && s.length > 5) return true;

  if (isDescription) {
    if (s.length < MIN_DESCRIPTION_CHARS && words.length < MIN_DESCRIPTION_WORDS) {
      return true;
    }
  }

  return false;
}

function checkText({ name, description, phase }) {
  const issues = [];
  const n = String(name || '').trim();
  const d = String(description || '').trim();

  if (!n) {
    issues.push(issue(REASON.MISSING_NAME, 'name'));
  } else if (isGibberish(n, { isDescription: false })) {
    issues.push(issue(REASON.GIBBERISH_NAME, 'name'));
  }

  if (!d) {
    issues.push(issue(REASON.MISSING_DESCRIPTION, 'description'));
  } else if (isGibberish(d, { isDescription: true })) {
    issues.push(issue(REASON.GIBBERISH_DESCRIPTION, 'description'));
  }

  return issues;
}

module.exports = { checkText, isGibberish };
