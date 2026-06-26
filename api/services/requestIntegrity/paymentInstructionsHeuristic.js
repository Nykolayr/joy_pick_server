/**
 * Эвристики: платёжные инструкции в описании (Pix, телефон, карта, M-Pesa и т.д.)
 * Stem-поиск без \\b — корректно для кириллицы, CJK, арабского и латиницы.
 */

const PAYMENT_STEMS = [
  'pix',
  'cpf',
  'cnpj',
  'iban',
  'swift',
  'visa',
  'mastercard',
  'paypal',
  'venmo',
  'mpesa',
  'm-pesa',
  'mobile money',
  'bank',
  'banco',
  'account',
  'conta',
  'agencia',
  'agência',
  'transfer',
  'transferencia',
  'transferência',
  'wire',
  'donate',
  'donation',
  'doação',
  'doacao',
  'payout',
  'payment',
  'pagamento',
  'card',
  'cartao',
  'cartão',
  'tarjeta',
  'karte',
  'upi',
  'wechat pay',
  'alipay',
  'chave',
  'cuenta',
  'banque',
  'virement',
  'paiement',
  'compte',
  'überweisung',
  'konto',
  'zahlung',
  'реквизит',
  'счет',
  'счёт',
  'карт',
  'перевод',
  'оплат',
  'телефон',
  'номер',
  'حساب',
  'بطاق',
  'تحويل',
  'دفع',
  '账户',
  '银行',
  '转账',
  '支付',
  '卡号',
  'खात',
  'कार्ड',
  'भुगतान',
  'חשבון',
  'כרטיס',
  'תשלום',
  'העברה',
  'sber',
  'тинькоф',
  'tinkoff',
];

const CLEANUP_STEMS = [
  'clean',
  'cleanup',
  'litter',
  'trash',
  'garbage',
  'waste',
  'beach',
  'park',
  'volunteer',
  'collect',
  'pick up',
  'pickup',
  'recycle',
  'river',
  'forest',
  'street',
  'limpeza',
  'lixo',
  'praia',
  'parque',
  'coleta',
  'volunt',
  'limpieza',
  'basura',
  'playa',
  'nettoyage',
  'dechet',
  'déchet',
  'plage',
  'putz',
  'mull',
  'müll',
  'strand',
  'уборк',
  'мусор',
  'пляж',
  'парк',
  'волонт',
  'субботник',
  'эко',
  '清理',
  '垃圾',
  '海滩',
  '公园',
  '志愿者',
  '清掃',
  'ゴミ',
  'limpiar',
  'recoger',
  'environment',
  'nature',
  'shore',
  'coast',
  'ocean',
  'lake',
  'trail',
  'community',
];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/iu;
const CARD_RE = /\b(?:\d[\s\-]?){15,19}\d\b/u;
const LONG_DIGITS_RE = /(?:\+?\d[\d\s.\-/()]{8,}\d)/u;
const MIN_PAYMENT_DIGIT_RUN = 10;

function normalizeText(text) {
  return String(text || '').trim();
}

function foldForMatch(text) {
  return normalizeText(text).toLowerCase();
}

function containsStem(text, stems) {
  const folded = foldForMatch(text);
  if (!folded) return false;
  return stems.some((stem) => folded.includes(stem.toLowerCase()));
}

function countDigits(text) {
  return (String(text || '').match(/\d/g) || []).length;
}

function countMeaningfulWords(text) {
  return String(text || '')
    .split(/\s+/)
    .filter((w) => w.replace(/[\s\d\p{P}\p{S}]/gu, '').length >= 2).length;
}

function hasLongDigitRun(text) {
  const digitsOnly = String(text || '').replace(/\D/g, '');
  if (digitsOnly.length >= MIN_PAYMENT_DIGIT_RUN) return true;
  return LONG_DIGITS_RE.test(text);
}

/** @returns {boolean} */
function looksLikePaymentInstruction(text) {
  const s = normalizeText(text);
  if (!s) return false;
  if (containsStem(s, PAYMENT_STEMS)) return true;
  if (EMAIL_RE.test(s) && (hasLongDigitRun(s) || containsStem(s, PAYMENT_STEMS) || countDigits(s) >= 6)) {
    return true;
  }
  if (EMAIL_RE.test(s) && countMeaningfulWords(s) <= 8) return true;
  if (CARD_RE.test(s)) return true;
  if (hasLongDigitRun(s) && countMeaningfulWords(s) >= 2) return true;
  const len = s.length;
  if (len >= 20 && countDigits(s) / len >= 0.22 && countMeaningfulWords(s) >= 3) return true;
  return false;
}

/** @returns {boolean} */
function looksLikeCleanupTask(name, description) {
  const n = normalizeText(name);
  const d = normalizeText(description);
  const bundle = `${n}\n${d}`;
  if (containsStem(bundle, CLEANUP_STEMS)) return true;
  if (looksLikePaymentInstruction(bundle) && !containsStem(bundle, CLEANUP_STEMS)) return false;
  if (n.length >= 4 && d.length >= 12 && countMeaningfulWords(d) >= 3) return true;
  return false;
}

/**
 * @param {{ name: string, description: string, nameGibberish: boolean, descriptionGibberish: boolean }} input
 */
function shouldAllowPaymentInstructionsInDescription(input) {
  const name = normalizeText(input.name);
  const description = normalizeText(input.description);
  if (!name || !description) return false;
  if (input.nameGibberish || input.descriptionGibberish) return false;
  if (!looksLikePaymentInstruction(description)) return false;
  if (!looksLikeCleanupTask(name, description)) return false;
  return true;
}

function looksLikePaymentInTitle(name) {
  const n = normalizeText(name);
  if (!n) return false;
  return looksLikePaymentInstruction(n);
}

module.exports = {
  looksLikePaymentInstruction,
  looksLikeCleanupTask,
  shouldAllowPaymentInstructionsInDescription,
  looksLikePaymentInTitle,
};
