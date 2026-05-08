const fs = require('fs');
const path = require('path');

const serverRoot = path.join(__dirname, '..');
const mobileRoot = path.join(serverRoot, '..', 'joy_pick');
const ruPath = path.join(mobileRoot, 'assets', 'l10n', 'ru.json');
const enPath = path.join(mobileRoot, 'assets', 'l10n', 'en.json');
const outPath = path.join(serverRoot, 'docs', 'knowledge', 'support_scope_dictionary.v1.json');

const OFFTOPIC_RU = [
  'погода',
  'температура',
  'прогноз',
  'политика',
  'выборы',
  'президент',
  'война',
  'фильм',
  'кино',
  'сериал',
  'музыка',
  'песня',
  'футбол',
  'баскетбол',
  'хоккей',
  'биткоин',
  'крипта',
  'гороскоп',
  'астрология',
  'анекдот',
  'мем',
  'рецепт'
];

const OFFTOPIC_EN = [
  'weather',
  'temperature',
  'forecast',
  'politics',
  'election',
  'president',
  'war',
  'movie',
  'cinema',
  'series',
  'music',
  'song',
  'football',
  'basketball',
  'hockey',
  'bitcoin',
  'crypto',
  'horoscope',
  'astrology',
  'joke',
  'meme',
  'recipe'
];

const GREETING_RU = ['привет', 'здарова', 'здравствуйте', 'добрый день', 'добрый вечер', 'доброе утро', 'салам'];
const GREETING_EN = ['hi', 'hello', 'hey', 'yo', 'sup'];

const RU_STOP = new Set([
  'и', 'или', 'в', 'во', 'на', 'по', 'к', 'ко', 'от', 'до', 'из', 'за', 'под', 'над', 'не', 'да', 'нет',
  'это', 'этот', 'эта', 'эти', 'для', 'с', 'со', 'у', 'о', 'об', 'что', 'как', 'где', 'когда', 'почему',
  'кто', 'мы', 'вы', 'они', 'он', 'она', 'оно', 'я', 'ты', 'а', 'но', 'ли', 'же', 'бы', 'их', 'его', 'ее',
  'её', 'ваш', 'ваша', 'ваши', 'наш', 'наша', 'наши'
]);

const EN_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'with', 'without', 'from', 'by', 'as', 'that', 'this', 'these', 'those', 'it', 'its',
  'you', 'your', 'yours', 'we', 'our', 'ours', 'they', 'their', 'them', 'he', 'she', 'his', 'her', 'i',
  'me', 'my', 'mine', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might',
  'if', 'then', 'else', 'than', 'so', 'not', 'no', 'yes', 'ok'
]);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function extractWords(dict, locale) {
  const stopPrimary = locale === 'ru' ? RU_STOP : EN_STOP;
  const stopSecondary = locale === 'ru' ? EN_STOP : RU_STOP;
  const words = new Set();
  const addToken = (t) => {
    if (!t || t.length < 3) return;
    if (/^\d+$/.test(t)) return;
    if (stopPrimary.has(t) || stopSecondary.has(t)) return;
    words.add(t);
  };

  for (const [, v] of Object.entries(dict || {})) {
    tokenize(v).forEach(addToken);
  }
  return [...words].sort();
}

function main() {
  if (!fs.existsSync(ruPath) || !fs.existsSync(enPath)) {
    throw new Error(`l10n json not found. expected: ${ruPath} and ${enPath}`);
  }
  const ru = readJson(ruPath);
  const en = readJson(enPath);
  const ruWords = extractWords(ru, 'ru');
  const enWords = extractWords(en, 'en');

  const result = {
    version: '1.1.0',
    updated_at: new Date().toISOString().slice(0, 10),
    source: [ruPath, enPath],
    strategy: 'fail-open',
    priority: ['in_app_strong', 'off_topic_strong', 'in_app_soft', 'unknown'],
    force_in_app_regex: '\\b(app|application)\\b|приложен|апп|апка|joy\\s*pick|joypick|джой\\s*пик|джойпик',
    in_app_strong: { ru: ruWords, en: enWords },
    in_app_soft: {
      ru: ['что насчет приложения', 'что насчёт приложения', 'что это за приложение', 'как пользоваться', 'как работает'],
      en: ['what about this app', 'what about your app', 'what about joypick app', 'what is this app', 'how to use', 'how it works']
    },
    off_topic_strong: { ru: OFFTOPIC_RU, en: OFFTOPIC_EN },
    greeting_only: { ru: GREETING_RU, en: GREETING_EN }
  };

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  const summary = {
    version: result.version,
    in_app_strong_ru: result.in_app_strong.ru.length,
    in_app_strong_en: result.in_app_strong.en.length,
    in_app_soft: result.in_app_soft.ru.length + result.in_app_soft.en.length,
    off_topic_strong: result.off_topic_strong.ru.length + result.off_topic_strong.en.length
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
