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

function isGibberish(text) {
  const s = String(text || '').trim();
  if (s.length < 3) return true;
  const letters = s.replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s]/g, '');
  if (letters.length < 3) return true;
  if (/(.)\1{4,}/i.test(s)) return true;
  if (/^[a-z]{1,2}[a-z]{4,}$/i.test(s.replace(/\s/g, ''))) return true;
  const vowels = (s.match(/[aeiouyаеёиоуыэюя]/gi) || []).length;
  const ratio = vowels / Math.max(letters.length, 1);
  if (letters.length > 8 && ratio < 0.08) return true;
  if (/^[^a-zA-Zа-яА-ЯёЁ]*$/.test(s)) return true;
  const words = s.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0 && s.length > 5) return true;
  return false;
}

function checkText({ name, description, phase }) {
  const issues = [];
  const n = String(name || '').trim();
  const d = String(description || '').trim();

  if (!n) {
    issues.push(issue(REASON.MISSING_NAME, 'name'));
  } else if (isGibberish(n)) {
    issues.push(issue(REASON.GIBBERISH_NAME, 'name'));
  }

  if (!d) {
    issues.push(issue(REASON.MISSING_DESCRIPTION, 'description'));
  } else if (isGibberish(d)) {
    issues.push(issue(REASON.GIBBERISH_DESCRIPTION, 'description'));
  }

  return issues;
}

module.exports = { checkText, isGibberish };
