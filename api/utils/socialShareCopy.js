/**
 * Тексты share-страницы (ru/en). Остальные locale → en.
 * Плейсхолдеры: <111> заявка, <112> организатор, <113> исполнитель(и).
 */

const TEMPLATES = {
  ru: 'Я провёл эко-уборку в JoyPick! Заявка: <111>. Организатор: <112>. Волонтёр: <113>.',
  en: 'I completed an eco-cleanup with JoyPick! Request: <111>. Organizer: <112>. Volunteer: <113>.',
};

const UI = {
  ru: {
    pageTitle: 'Эко-уборка — JoyPick',
    beforeLabel: 'До',
    afterLabel: 'После',
    supportIntro: 'Поддержать можно',
    supportLinkText: 'по ссылке',
    cityPrefix: 'Город:',
    categoryLabels: {
      wasteLocation: 'Место с мусором',
      speedCleanup: 'Быстрая уборка',
      event: 'Субботник',
    },
    executorsJoiner: ', ',
    noExecutor: '—',
  },
  en: {
    pageTitle: 'Eco cleanup — JoyPick',
    beforeLabel: 'Before',
    afterLabel: 'After',
    supportIntro: 'You can support this cleanup',
    supportLinkText: 'via this link',
    cityPrefix: 'City:',
    categoryLabels: {
      wasteLocation: 'Waste location',
      speedCleanup: 'Speed cleanup',
      event: 'Community cleanup',
    },
    executorsJoiner: ', ',
    noExecutor: '—',
  },
};

function normalizeShareLocale(locale) {
  const l = String(locale || 'en')
    .trim()
    .toLowerCase()
    .split('-')[0];
  return l === 'ru' ? 'ru' : 'en';
}

function pickLocaleFromAcceptLanguage(acceptLanguage) {
  if (!acceptLanguage || typeof acceptLanguage !== 'string') return 'en';
  const tokens = acceptLanguage.split(',').map((p) => p.trim().split(';')[0].toLowerCase());
  for (const t of tokens) {
    if (t.startsWith('ru')) return 'ru';
  }
  return 'en';
}

function resolveShareLocale({ locale, acceptLanguage }) {
  if (locale) return normalizeShareLocale(locale);
  return pickLocaleFromAcceptLanguage(acceptLanguage);
}

function applyShareTemplate({ locale, requestName, organizerName, executorNames }) {
  const loc = normalizeShareLocale(locale);
  const template = TEMPLATES[loc] || TEMPLATES.en;
  const executors =
    Array.isArray(executorNames) && executorNames.length
      ? executorNames.filter(Boolean).join(UI[loc].executorsJoiner)
      : UI[loc].noExecutor;
  const nameQuoted = requestName && String(requestName).trim() ? `"${String(requestName).trim()}"` : '';

  return template
    .replace(/<111>/g, nameQuoted)
    .replace(/<112>/g, organizerName || UI[loc].noExecutor)
    .replace(/<113>/g, executors)
    .trim();
}

function uiCopy(locale) {
  const loc = normalizeShareLocale(locale);
  return UI[loc] || UI.en;
}

module.exports = {
  TEMPLATES,
  UI,
  normalizeShareLocale,
  resolveShareLocale,
  applyShareTemplate,
  uiCopy,
};
