#!/usr/bin/env node
/**
 * Регрессия: реквизиты в описании (rules + heuristic + post-process, без OpenRouter).
 */
const assert = require('assert');
const { isGibberish, checkTextGibberishRules } = require('../api/services/requestIntegrity/textCheck');
const {
  looksLikePaymentInstruction,
  looksLikeCleanupTask,
  shouldAllowPaymentInstructionsInDescription,
  looksLikePaymentInTitle,
} = require('../api/services/requestIntegrity/paymentInstructionsHeuristic');
const { postProcessTextAiIssues } = require('../api/services/requestIntegrity/textIntegrityPostProcess');
const { REASON } = require('../api/services/requestIntegrity/reasonCodes');
const { messageForCodeAndLocale } = require('../api/services/requestIntegrity/integrityLocalizedMessages');

const CASES_PASS = [
  {
    id: 'pt_pix',
    name: 'Limpeza praia Copacabana',
    description:
      'Coleta de lixo na areia. Doação via Pix: 11999887766, chave email@foo.com, Banco Itaú, Ag 1234, CC 56789-0',
    locale: 'pt',
  },
  {
    id: 'ru_pix',
    name: 'Уборка мусора',
    description: 'Уборка мусора на пляже. Перевод на карту Сбер 4276 1234 5678 9012, телефон +7 999 123-45-67',
    locale: 'ru',
  },
  {
    id: 'en_mpesa',
    name: 'Beach cleanup',
    description: 'Trash cleanup at Lagos beach. Donate via M-Pesa +254712345678, account name John Doe',
    locale: 'en',
  },
  {
    id: 'es_cuenta',
    name: 'Limpieza playa',
    description: 'Recoger basura en la playa. Transferencia a cuenta 1234567890, tarjeta 4111 1111 1111 1111',
    locale: 'es',
  },
  {
    id: 'clean_only',
    name: 'Coleta de lixo',
    description: 'Coleta de lixo na praia de Ipanema, perto do quiosque 12.',
    locale: 'pt',
  },
];

const CASES_FAIL = [
  {
    id: 'payment_only',
    name: 'Pix 11999887766',
    description: 'Pix 11999887766 CPF 123.456.789-00 Banco Itau',
    locale: 'pt',
  },
  {
    id: 'gibberish',
    name: 'asdfgh qwerty',
    description: 'zxcvbn mnbvcx Pix 11999887766',
    locale: 'en',
  },
];

function simulateAiRejectName(name, description) {
  return postProcessTextAiIssues({
    name,
    description,
    nameGibberish: isGibberish(name, { isDescription: false }),
    descriptionGibberish: isGibberish(description, { isDescription: true }),
    aiIssues: [{ code: REASON.GIBBERISH_NAME, field: 'name', source: 'ai' }],
    phase: 'create',
    locale: 'pt',
  });
}

let failed = 0;

for (const c of CASES_PASS) {
  const nameG = isGibberish(c.name, { isDescription: false });
  const descG = isGibberish(c.description, { isDescription: true });
  const rules = checkTextGibberishRules({ name: c.name, description: c.description, locale: c.locale });
  const allow = shouldAllowPaymentInstructionsInDescription({
    name: c.name,
    description: c.description,
    nameGibberish: nameG,
    descriptionGibberish: descG,
  });
  const aiAfter = simulateAiRejectName(c.name, c.description);

  try {
    assert.strictEqual(nameG, false, `${c.id}: name gibberish`);
    assert.strictEqual(descG, false, `${c.id}: desc gibberish`);
    assert.strictEqual(rules.length, 0, `${c.id}: rules issues`);
    if (looksLikePaymentInstruction(c.description)) {
      assert.strictEqual(allow, true, `${c.id}: should allow payment in description`);
      assert.strictEqual(aiAfter.length, 0, `${c.id}: AI post-process should pass`);
    }
    console.log('OK pass', c.id);
  } catch (e) {
    failed += 1;
    console.error('FAIL pass', c.id, e.message);
  }
}

for (const c of CASES_FAIL) {
  const nameG = isGibberish(c.name, { isDescription: false });
  const descG = isGibberish(c.description, { isDescription: true });
  const allow = shouldAllowPaymentInstructionsInDescription({
    name: c.name,
    description: c.description,
    nameGibberish: nameG,
    descriptionGibberish: descG,
  });
  try {
    assert.strictEqual(allow, false, `${c.id}: must not allow`);
    console.log('OK fail', c.id);
  } catch (e) {
    failed += 1;
    console.error('FAIL fail', c.id, e.message);
  }
}

try {
  const remapped = simulateAiRejectName('Limpeza praia', 'Coleta com Pix 11999887766 na descrição.');
  assert.strictEqual(remapped.length, 0, 'remap: valid cleanup+pix passes');
  const paymentTitle = checkTextGibberishRules({
    name: 'Pix 11999887766',
    description: 'Limpeza da praia.',
    locale: 'pt',
  });
  assert.ok(
    paymentTitle.some((i) => i.code === REASON.PAYMENT_IN_TITLE),
    'payment in title → PAYMENT_IN_TITLE'
  );
  const ruMsg = messageForCodeAndLocale(REASON.GIBBERISH_DESCRIPTION, 'ru');
  assert.ok(/описан/i.test(ruMsg), 'ru localized hint');
  console.log('OK edge cases');
} catch (e) {
  failed += 1;
  console.error('FAIL edge', e.message);
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll integrity payment description tests passed.');
