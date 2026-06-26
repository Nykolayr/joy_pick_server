const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');
const {
  shouldAllowPaymentInstructionsInDescription,
  looksLikePaymentInTitle,
} = require('./paymentInstructionsHeuristic');
const { messageForCodeAndLocale } = require('./integrityLocalizedMessages');

const TEXT_AI_CODES = new Set([
  REASON.GIBBERISH_NAME,
  REASON.GIBBERISH_DESCRIPTION,
  REASON.PAYMENT_IN_TITLE,
]);

function aiIssue(code, field, phase, locale, extra = {}) {
  const severity = phase === 'create' ? 'block' : 'reject';
  const localized = messageForCodeAndLocale(code, locale);
  return {
    code,
    field,
    severity,
    source: 'ai',
    message_key: messageKeyForCode(code),
    message_en: localized || messageEnForCode(code),
    message: localized || messageEnForCode(code),
    ...extra,
  };
}

/**
 * После AI: bypass для описания с реквизитами, перенос поля, подсказки.
 * @param {{ name: string, description: string, nameGibberish: boolean, descriptionGibberish: boolean, aiIssues: object[], phase: string, locale?: string }} input
 * @returns {object[]}
 */
function postProcessTextAiIssues(input) {
  const {
    name,
    description,
    nameGibberish,
    descriptionGibberish,
    aiIssues,
    phase,
    locale,
  } = input;

  const issues = Array.isArray(aiIssues) ? aiIssues : [];
  if (issues.length === 0) return [];

  if (
    shouldAllowPaymentInstructionsInDescription({
      name,
      description,
      nameGibberish,
      descriptionGibberish,
    })
  ) {
    return [];
  }

  if (looksLikePaymentInTitle(name) && !nameGibberish) {
    return [aiIssue(REASON.PAYMENT_IN_TITLE, 'name', phase, locale)];
  }

  const nameOnly = issues.filter((i) => TEXT_AI_CODES.has(i.code) && i.field === 'name');
  const descOnly = issues.filter((i) => TEXT_AI_CODES.has(i.code) && i.field === 'description');
  const hasNameIssue = nameOnly.length > 0;
  const hasDescIssue = descOnly.length > 0;

  if (hasNameIssue && !hasDescIssue && !nameGibberish) {
    const code = REASON.GIBBERISH_DESCRIPTION;
    return [aiIssue(code, 'description', phase, locale)];
  }

  return issues.map((issue) => {
    const code = issue.code;
    const field = issue.field;
    const localized = messageForCodeAndLocale(code, locale);
    return {
      ...issue,
      message_key: messageKeyForCode(code),
      message_en: localized || issue.message_en || messageEnForCode(code),
      message: localized || issue.message || messageEnForCode(code),
      field,
    };
  });
}

module.exports = { postProcessTextAiIssues, aiIssue };
