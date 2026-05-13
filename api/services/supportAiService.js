const fs = require('fs');
const path = require('path');
const { SUPPORTED_LOCALES, translateOne } = require('./translateNews');

const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const DEFAULT_TOP_K = Number(process.env.AI_SUPPORT_TOP_K || 5);
// Держим таймаут заметно ниже клиентского (обычно 30s), чтобы вернуть fallback до обрыва запроса в приложении.
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_SUPPORT_TIMEOUT_MS || 12000);
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.AI_SUPPORT_MAX_OUTPUT_TOKENS || 400);
const DEFAULT_TEMPERATURE = Number(process.env.AI_SUPPORT_TEMPERATURE || 0.2);
/** Оценка размера prompt (system + user) для OpenRouter; меньше chars/token = выше оценка (ближе к реальному счёту OR). */
const PROMPT_CHARS_PER_TOKEN_EST = Math.max(1.8, Number(process.env.AI_SUPPORT_PROMPT_CHARS_PER_TOKEN_EST || 2.25));
const OPENROUTER_MAX_PROMPT_TOKENS = Math.max(
  2000,
  Number(process.env.AI_SUPPORT_MAX_PROMPT_TOKENS || 11000)
);
/** Русский system prompt длиннее — жёстче потолок, иначе OpenRouter: prompt > ~11612. */
const OPENROUTER_MAX_PROMPT_TOKENS_RU = Math.max(
  2000,
  Number(process.env.AI_SUPPORT_MAX_PROMPT_TOKENS_RU || 8000)
);
const OPENROUTER_PROMPT_TOKEN_BUFFER = Math.max(0, Number(process.env.AI_SUPPORT_PROMPT_TOKEN_BUFFER || 600));
/** В LLM-пrompt только последние N реплик и укороченный текст — иначе гостевой чат раздувает prompt выше лимита OpenRouter. */
const CONTEXT_PROMPT_MAX_TURNS = Math.min(12, Math.max(1, Number(process.env.AI_SUPPORT_CONTEXT_PROMPT_TURNS || 3)));
const CONTEXT_PROMPT_MAX_FIELD_CHARS = Math.min(800, Math.max(80, Number(process.env.AI_SUPPORT_CONTEXT_PROMPT_FIELD_CHARS || 200)));

const KNOWLEDGE_ROOT = path.join(__dirname, '..', '..', 'docs', 'knowledge');
const KNOWLEDGE_PATH_EN = path.join(KNOWLEDGE_ROOT, 'support_en', 'chunks.json');
const KNOWLEDGE_PATH_RU = path.join(KNOWLEDGE_ROOT, 'support_ru', 'chunks.json');

function isAiEnabled() {
  const value = String(process.env.AI_SUPPORT_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(value);
}

/** Язык ответа по тексту вопроса (не только по locale из запроса). */
function inferAnswerLocale(message, declaredLocale) {
  const safe = SUPPORTED_LOCALES.includes(declaredLocale) ? declaredLocale : 'en';
  const text = String(message || '').trim();
  if (!text) return safe;

  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';

  // Латиница: интерфейс ru, а вопрос по-английски — отвечаем на английском
  if (safe === 'ru' && looksLikeEnglishLatinQuestion(text)) return 'en';

  return safe;
}

function looksLikeEnglishLatinQuestion(text) {
  const t = String(text || '').trim();
  if (/[\u0400-\u04FF]/.test(t)) return false;
  const words = t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1);
  if (!words.length) return false;
  const enHint = new Set([
    'how', 'what', 'when', 'where', 'why', 'who', 'which', 'can', 'could', 'would', 'should', 'does', 'did', 'do', 'is', 'are', 'was', 'were',
    'the', 'you', 'i', 'my', 'a', 'an', 'to', 'for', 'and', 'or', 'not', 'with', 'from', 'in', 'on', 'at', 'it', 'this', 'that',
    'earn', 'money', 'help', 'app', 'request', 'cleanup', 'donate', 'payment', 'please', 'thank', 'get', 'paid', 'work', 'about'
  ]);
  let hits = 0;
  for (const w of words) {
    if (enHint.has(w)) hits++;
  }
  if (words.length <= 10) return hits >= 1;
  return hits >= 2;
}

function normalizeAiErrorCode(reason) {
  const msg = String(reason || '').toLowerCase();
  if (!msg) return 'AI_UNAVAILABLE';
  if (msg.includes('ai_disabled')) return 'AI_DISABLED';
  if (msg.includes('location is not supported')) return 'AI_PROVIDER_REGION_BLOCKED';
  if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource exhausted')) {
    return 'AI_QUOTA_EXCEEDED';
  }
  if (msg.includes('abort') || msg.includes('timed out') || msg.includes('timeout')) return 'AI_TIMEOUT';
  if (msg.includes('api key') || msg.includes('is not configured')) return 'AI_CONFIG_ERROR';
  return 'AI_UNAVAILABLE';
}

function buildUnavailableAnswer(locale, reason) {
  const errorMessage = String(reason || 'ai_unavailable');
  const errorCode = normalizeAiErrorCode(errorMessage);
  const fallbackEn = 'Support AI is temporarily unavailable. Please try again later or contact support.';
  if (locale === 'ru') {
    return {
      answer: 'AI-поддержка временно недоступна. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
      answer_en: fallbackEn,
      locale: 'ru',
      model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
      translation_fallback: false,
      sources: [],
      degraded: true,
      degraded_reason: errorMessage,
      ai_error_code: errorCode,
      ai_error_message: errorMessage
    };
  }

  return {
    answer: fallbackEn,
    answer_en: fallbackEn,
    locale,
    model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
    translation_fallback: locale !== 'en',
    sources: [],
    degraded: true,
    degraded_reason: errorMessage,
    ai_error_code: errorCode,
    ai_error_message: errorMessage
  };
}

function buildSupportAiTimeoutFallback(locale) {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
  return buildUnavailableAnswer(safeLocale, 'ai_total_timeout');
}

function normalizeText(value) {
  return String(value || '').trim();
}

const SUPPORT_SCOPE_DICTIONARY_PATH = path.join(KNOWLEDGE_ROOT, 'support_scope_dictionary.v1.json');
const DEFAULT_SCOPE_DICTIONARY = {
  force_in_app_regex: '\\b(app|application)\\b|приложен|апп|апка|joy\\s*pick|joypick|джой\\s*пик|джойпик',
  in_app_strong: {
    ru: ['joypick', 'joy pick', 'приложен', 'заявк', 'уборк', 'субботник', 'донат', 'выплат'],
    en: ['joypick', 'joy pick', 'app', 'application', 'request', 'cleanup', 'event', 'donation', 'stripe']
  },
  in_app_soft: {
    ru: ['что это за приложение', 'как пользоваться', 'как работает'],
    en: ['what is this app', 'how to use', 'how it works']
  },
  off_topic_strong: {
    ru: ['погода', 'прогноз', 'политик', 'кино', 'фильм', 'гороскоп'],
    en: ['weather', 'forecast', 'politics', 'movie', 'joke', 'horoscope']
  },
  greeting_only: {
    ru: ['привет', 'здравствуйте', 'добрый день'],
    en: ['hi', 'hello', 'hey']
  }
};

let scopeDictionaryCache = null;

function loadScopeDictionary() {
  if (scopeDictionaryCache) return scopeDictionaryCache;
  try {
    if (fs.existsSync(SUPPORT_SCOPE_DICTIONARY_PATH)) {
      const raw = fs.readFileSync(SUPPORT_SCOPE_DICTIONARY_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      scopeDictionaryCache = parsed;
      return parsed;
    }
  } catch (_) {
    // fallback ниже
  }
  scopeDictionaryCache = DEFAULT_SCOPE_DICTIONARY;
  return scopeDictionaryCache;
}

function normalizeScopeTerm(value) {
  return String(value || '').trim().toLowerCase();
}

function flattenScopeTerms(group = {}) {
  const ru = Array.isArray(group.ru) ? group.ru : [];
  const en = Array.isArray(group.en) ? group.en : [];
  return [...ru, ...en].map(normalizeScopeTerm).filter(Boolean);
}

function tokenizeScopeText(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  );
}

function hasAnyScopeTerm(textLower, tokenSet, terms) {
  return terms.some((term) => {
    if (!term) return false;
    if (term.includes(' ')) return textLower.includes(term);
    return tokenSet.has(term);
  });
}

function isGreetingOnly(textLower, greetings) {
  const compact = textLower.replace(/\s+/g, ' ').trim();
  return greetings.some((greet) => {
    const g = String(greet).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!g) return false;
    const re = new RegExp(`^${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[!.?\\s]*$`, 'i');
    return re.test(compact);
  });
}

/**
 * Детерминированный scope-check перед LLM:
 * - блокируем только явный оффтоп;
 * - всё спорное пропускаем дальше (fail-open), чтобы не резать валидные in-app вопросы.
 */
function classifySupportQuestionScope(message) {
  const text = normalizeText(message);
  if (!text) return { scope: 'unknown', reason: 'empty_message' };
  const lower = text.toLowerCase();
  const tokenSet = tokenizeScopeText(lower);
  const dict = loadScopeDictionary();

  // Жесткое правило: любые вопросы с app/application/приложение считаем in-app.
  const forceInAppRe = new RegExp(String(dict.force_in_app_regex || DEFAULT_SCOPE_DICTIONARY.force_in_app_regex), 'i');
  if (forceInAppRe.test(text)) {
    return { scope: 'in_app', reason: 'app_force_in_app' };
  }

  const inAppStrong = flattenScopeTerms(dict.in_app_strong);
  if (hasAnyScopeTerm(lower, tokenSet, inAppStrong)) {
    return { scope: 'in_app', reason: 'has_in_app_hint' };
  }

  const greetings = flattenScopeTerms(dict.greeting_only);
  if (isGreetingOnly(lower, greetings)) {
    return { scope: 'off_topic', reason: 'bare_greeting' };
  }

  const offTopicStrong = flattenScopeTerms(dict.off_topic_strong);
  if (hasAnyScopeTerm(lower, tokenSet, offTopicStrong)) {
    return { scope: 'off_topic', reason: 'clear_offtopic_topic' };
  }

  const inAppSoft = flattenScopeTerms(dict.in_app_soft);
  if (hasAnyScopeTerm(lower, tokenSet, inAppSoft)) {
    return { scope: 'in_app', reason: 'has_in_app_soft_hint' };
  }

  return { scope: 'unknown', reason: 'no_clear_signals' };
}

function buildOffTopicScopeAnswer(locale, scopeReason) {
  if (locale === 'ru') {
    return {
      answer: 'Похоже, это не вопрос о приложении Joy Pick. Я помогаю только с вопросами по Joy Pick — напишите, что именно хотите сделать в приложении.',
      answer_en:
        'It seems this is not about the Joy Pick app. I can help only with Joy Pick app questions—tell me what exactly you want to do in the app.',
      locale: 'ru',
      model: 'scope-guard-v1',
      translation_fallback: false,
      sources: [],
      degraded: false,
      scope_guard: true,
      scope_reason: scopeReason
    };
  }
  const answerEn =
    'It seems this is not about the Joy Pick app. I can help only with Joy Pick app questions—tell me what exactly you want to do in the app.';
  return {
    answer: answerEn,
    answer_en: answerEn,
    locale,
    model: 'scope-guard-v1',
    translation_fallback: locale !== 'en',
    sources: [],
    degraded: false,
    scope_guard: true,
    scope_reason: scopeReason
  };
}

/** Чат на сайте не рендерит Markdown — убираем ** и ` чтобы не показывались «звёздочки». */
function stripSupportAnswerMarkdown(text) {
  let s = String(text || '').trim();
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');
  return s.trim();
}

function tokenize(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((x) => x.length >= 2);
}

/** Слишком частые в словарных заголовках («Как …») — иначе любой вопрос с «как» выталкивает релевантные чанки при top_k. */
const WEAK_TITLE_MATCH_TOKENS = new Set([
  'как',
  'что',
  'где',
  'когда',
  'почему',
  'зачем',
  'куда',
  'кто',
  'how',
  'what',
  'where',
  'when',
  'why',
  'who',
  'which'
]);

function overlapScore(questionTokens, chunk) {
  const titleTokens = tokenize(chunk.title || '');
  const tagsTokens = Array.isArray(chunk.tags)
    ? tokenize(chunk.tags.join(' '))
    : [];
  const textTokens = tokenize(chunk.text || '');

  const titleSet = new Set(titleTokens);
  const tagsSet = new Set(tagsTokens);
  const textSet = new Set(textTokens);

  let score = 0;
  for (const q of questionTokens) {
    if (titleSet.has(q)) score += WEAK_TITLE_MATCH_TOKENS.has(q) ? 1 : 5;
    if (tagsSet.has(q)) score += 4;
    if (textSet.has(q)) score += 1;
  }
  return score;
}

/** Короткий фоллоуап только про деньги/Stripe/донаты — не подмешивать прошлый длинный вопрос в RAG (иначе снова всплывают чанки «никто не пришёл»). */
function isMoneyDominantShortFollowUp(currentMessage) {
  const q = normalizeText(currentMessage).toLowerCase();
  if (!q || q.length > 200) return false;
  const moneyish = /деньг|получу|получит|донат|stripe|выплат|заработ|оплат|paid|payout|donation/i.test(q);
  if (!moneyish) return false;
  const nobodyish = /никто\s+не|не\s+прид|нет\s+участник|no\s+one|nobody/i.test(q);
  const flowish =
    /выполнить|сдач|фото|геолок|закрыть\s+заяв|что\s+делать|как\s+отчит|пришёл|придут|участник|участи|join|perform|complete\s+task/i.test(
      q
    );
  return !nobodyish && !flowish;
}

/** Короткий ответ в цепочке («да», «а через профиль?») — подмешиваем прошлый вопрос только в строку поиска, не в текст для пользователя. */
function augmentMessageForRetrieval(questionForModel, conversationContext) {
  const q = normalizeText(questionForModel);
  if (!q) return q;
  if (isMoneyDominantShortFollowUp(q)) {
    return q;
  }
  const ctx = Array.isArray(conversationContext) ? conversationContext : [];
  if (!ctx.length) return q;
  const last = ctx[ctx.length - 1];
  const prev = normalizeText(last.user_message || '');
  if (prev.length < 8 || prev.length > 800) return q;
  const words = tokenize(q);
  const shortFollowUp = q.length <= 160 && words.length > 0 && words.length <= 14;
  if (!shortFollowUp) return q;
  return `${prev}\n${q}`.slice(0, 2000);
}

/**
 * Несколько формулировок запроса (обогащённые / без контекста): берём максимум скора по чанку — лучше recall и меньше ложных провалов.
 */
function retrieveTopChunksFused(questions, knowledgePath, topK = DEFAULT_TOP_K) {
  const chunks = loadKnowledgeChunks(knowledgePath);
  if (!chunks.length) {
    return [];
  }
  const variantTokens = [];
  const seen = new Set();
  for (const qu of questions) {
    const t = tokenize(normalizeText(qu));
    const key = t.join('\u0001');
    if (!t.length || seen.has(key)) continue;
    seen.add(key);
    variantTokens.push(t);
  }
  if (!variantTokens.length) {
    return [];
  }

  const scored = chunks
    .map((chunk) => {
      let score = 0;
      for (const qt of variantTokens) {
        const s = overlapScore(qt, chunk);
        if (s > score) score = s;
      }
      return { chunk, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));

  if (scored.length > 0) {
    return scored.map((x) => x.chunk);
  }
  return [];
}

/** Подмешивает синонимы в строку поиска RAG (не в ответ пользователю), чтобы опечатки и «как …» не теряли тему. */
function enrichQuestionForRetrievalKeywords(question, locale, conversationContext = []) {
  const raw = normalizeText(question);
  if (!raw) return question;
  const ctxLines = Array.isArray(conversationContext)
    ? conversationContext
        .slice(-4)
        .map((x) => normalizeText(x.user_message || ''))
        .filter(Boolean)
    : [];
  const scoutLower = [...ctxLines, raw].join('\n').toLowerCase();
  const t = raw.toLowerCase();
  const isRu = locale === 'ru';

  if (
    (/деньг|получу|получит|заработ|выплат|stripe|донат|оплат/i.test(scoutLower)) &&
    (/субботник|суботник|subbotnik|\bevent\b|мероприят|ивент|событ/i.test(scoutLower))
  ) {
    return isRu
      ? `${question} event участник одобрение создателя модерация донаты stripe connect доля поровну получу деньги заявка`
      : `${question} event participant creator approval moderation donations stripe connect equal split payout money`;
  }

  if (
    /заказать\s+уборк|оплатить\s+уборк|платн.{0,20}заявк|донатн.{0,20}заявк|создать\s+.*(платн|донатн).{0,20}заявк|can\s+i\s+pay\s+for\s+cleanup|paid\s+request|sponsor\s+cleanup|fund\s+cleanup/i.test(
      scoutLower
    ) &&
    /waste|мусор|уборк|cleanup|request|заявк/i.test(scoutLower)
  ) {
    return isRu
      ? `${question} создатель заказчик платная донатная заявка waste location можно создать и оплатить стимулировать исполнителя донаты получит исполнитель после проверки и модерации stripe`
      : `${question} creator paid donation request waste location can create and fund cleanup to motivate executor donations go to executor after review moderation stripe`;
  }

  if (
    (/никто\s+не\s+прид|никто\s+не\s+приш|не\s+придут|нет\s+участник|no\s+one\s+comes|nobody\s+(came|shows|joins)/i.test(scoutLower)) &&
    (/субботник|суботник|subbotnik|\bevent\b|мероприят|ивент|событ/i.test(scoutLower))
  ) {
    return isRu
      ? `${question} event создатель организатор выполнить один нет волонтёров завершение заявки холд расхолд не подменять`
      : `${question} event creator organizer finish alone no volunteers completion hold refund do not conflate`;
  }

  if (
    (/сколько\s+ждать|когда\s+закр|закрыти|модерац|одобр|how\s+long|moderation|approve/i.test(scoutLower)) &&
    (/быстр|speed\s+cleanup|\bspeed\b|быстрая\s+заявк|quick\s+cleanup|донат|stripe|7\s*дн|seven\s*days/i.test(scoutLower))
  ) {
    return isRu
      ? `${question} модерация администратор pending approved 7 дней донат stripe выплата начало работ закрытие заявки`
      : `${question} admin moderation pending approved 7 days donation stripe payout work started close request`;
  }

  if (
    /registration.{0,40}required|required.{0,24}fields|sign\s*up.{0,30}required|регистрац.{0,40}пол|обязательн.{0,20}пол/i.test(
      t
    )
  ) {
    return isRu
      ? `${question} регистрация email пароль подтверждение terms согласие auth`
      : `${question} registration sign up email password confirmation terms acceptance auth`;
  }

  if (
    (/сообщен|написать|отправить/i.test(t) && /чат/i.test(t) && /заяв|request/i.test(t)) ||
    (/message|send|write/i.test(t) && /chat/i.test(t) && /request|заяв/i.test(t))
  ) {
    return isRu
      ? `${question} чат заявки открыть чат список отправить сообщение ввод текста send chat_open`
      : `${question} request chat open send message input conversation chat list`;
  }

  if (
    /изменить.{0,50}(имя|фамилию|город)|поле\s+about|редактир.{0,24}профил|профил.{0,20}редакт/i.test(t) ||
    /edit.{0,40}(profile|name|city)|change.{0,20}(name|city).{0,30}about/i.test(t)
  ) {
    return isRu
      ? `${question} редактирование профиля имя страна город about социальные ссылки сохранить`
      : `${question} edit profile first last name country city about social links save`;
  }

  if (
    /далеко|слишком\s+далеко|вне\s+радиус|out\s+of\s+radius|cleanup\s+radius/i.test(t) &&
    /точк|уборк|cleanup|мест|location|task/i.test(t)
  ) {
    return isRu
      ? `${question} вне радиуса уборки request_distance_out_of_cleanup_radius вернуться к месту геолокация`
      : `${question} request_distance_out_of_cleanup_radius out of cleanup radius return to spot gps`;
  }

  if (
    /donation\s+failed|payment\s+failed|донат.*не\s+прош|оплат.*не\s+прош|ошибк.*оплат|stripe.*ошибк/i.test(
      t
    )
  ) {
    return isRu
      ? `${question} donation_payment_failed ошибка оплаты доната stripe повторить retry`
      : `${question} donation_payment_failed stripe donation payment error retry`;
  }

  if (
    /машинк|грузовик|фур|пикап|тачк|trash\s*pickup|pickup\s*truck|garbage\s*truck|\bhaul\b|грузович|иконк.*грузов|значок.*грузов|только\s+вывоз|вывоз\s+без\s+уборк/i.test(
      scoutLower
    ) &&
    /иконк|значок|карт|приложен|joy\s*pick|help|что\s+за|what\s+.*icon|созда|заяв|map|мусор|уборк|waste|event|событ|точк/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} только вывоз мусора trash pickup pickup icon грузовик машинка help_trash_pickup белый круг waste location trash_pickup_only pickup.png индикатор`
      : `${question} trash pickup only truck icon pickup help_trash_pickup white circle waste location haul away garbage truck trash_pickup_only`;
  }

  if (
    /доллар|бакс|баксы|знак\s*\$|\$\s*под|green\s+dollar|dollar\s+sign\s+under|money\s+under\s+(pin|icon|marker)|donation\s+marker/i.test(
      scoutLower
    ) &&
    /иконк|значок|карт|map|заяв|маркер|help|что\s+за|what.*icon|pin/i.test(scoutLower)
  ) {
    return isRu
      ? `${question} зелёный доллар под иконкой заявка с донатами help_synonyms_dollar_on_map donation map marker stripe`
      : `${question} green dollar under icon donation request map marker help_synonyms_dollar_on_map stripe`;
  }

  if (
    /серый\s+круг|серое\s+кольцо|серый\s+ободок|gray\s+circle|grey\s+(circle|ring)|halo\s+around|ореол/i.test(
      scoutLower
    ) &&
    /иконк|карт|map|заяв|маркер|help|что\s+за|what.*mean/i.test(scoutLower)
  ) {
    return isRu
      ? `${question} серый круг вокруг иконки просрочена одобрена завершена help_synonyms_gray_circle map`
      : `${question} gray circle around icon overdue approved completed help_synonyms_gray_circle map`;
  }

  if (
    /зелён|зелен|green\s+border|green\s+card|зелёная\s+рамка|зеленый\s+бордер|зелёный\s+бордер/i.test(
      scoutLower
    ) &&
    /рамк|бордер|border|обводк|контур|окантовк|вокруг\s+заявк/i.test(scoutLower)
  ) {
    return isRu
      ? `${question} зелёная рамка созданные вами автор help_border_green help_green_border_is_creator_not_donation не путать с донатом зелёный доллар под иконкой отдельно`
      : `${question} green border your created requests creator help_border_green help_green_border_is_creator_not_donation not donation by border green dollar under icon`;
  }

  if (
    /цвет\s+рамки|рамк.*зелён|рамк.*оранж|рамк.*жёлт|рамк.*фиолет|рамк.*черн|border\s+color|green\s+border|purple\s+border|orange\s+border/i.test(
      scoutLower
    ) &&
    /карт|map|заяв|карточк|help|что\s+за|what.*color/i.test(scoutLower)
  ) {
    return isRu
      ? `${question} цвета рамок карточки зелёная мои оранжевая участие жёлтая донат фиолетовая 7 дней чёрная остальные help_map_border_colors`
      : `${question} card border colors green orange yellow purple black creator joined donated help_map_border_colors`;
  }

  if (
    /посадк.*дерев|сажен|plant\s+tree|sapling|seedling|дерев.*белом\s+круге|tree\s+icon.*white/i.test(scoutLower) &&
    /иконк|значок|что\s+за|help|карт|субботник|event|событ|map|заяв/i.test(scoutLower)
  ) {
    return isRu
      ? `${question} посадка дерева event субботник help_plant_tree tree.png белый круг help_synonyms_tree_planting не waste location`
      : `${question} plant tree event subbotnik help_plant_tree tree.png white circle help_synonyms_tree_planting not waste location`;
  }

  if (
    /оранжев.*чип|жёлт.*чип|orange\s+chip|yellow\s+chip|чип\s+сумм|donation\s+chip|расстояние\s+км|distance\s+chip/i.test(
      scoutLower
    ) &&
    /донат|donat|карт|card|заяв|help|что\s+за/i.test(scoutLower)
  ) {
    return isRu
      ? `${question} оранжевый жёлтый чип донатов сумма расстояние км help_donation_chips_orange_vs_yellow`
      : `${question} orange yellow donation chip total distance help_donation_chips_orange_vs_yellow`;
  }

  if (
    /кошелёк\s+(сверху|на\s+главн)|wallet\s+(header|top)|новости\s+точк|news\s+pulse|обновить\s+список\s+заявк|иконк.*чат.*списк/i.test(
      scoutLower
    ) &&
    /главн|home|map|help|что\s+за|верх/i.test(scoutLower)
  ) {
    return isRu
      ? `${question} чат обновить новости кошелёк верх экрана профиль список QR выплаты help_synonyms_top_bar_and_profile_icons`
      : `${question} chat refresh news wallet top bar profile list qr payouts help_synonyms_top_bar_and_profile_icons`;
  }

  if (
    /раздел.{0,16}(хелп|справк|help)|оглавлен.*help|какие\s+разделы\s+(в\s+)?(справк|help|руководств)|sections\s+in\s+(the\s+)?(help|ui\s+guide)|ui\s+guide\s+(outline|sections)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} help_ui_guide_sections_outline значки типов заявок доллар серый круг рамки чипы расстояние посадка дерева только вывоз кнопки главный экран профиль`
      : `${question} help_ui_guide_sections_outline request types dollar gray circle borders chips distance plant tree pickup top buttons profile`;
  }

  // Узкие формулировки по пунктам меню / карточкам профиля (чанки profile_menu_*)
  if (
    /(?:ваши\s+выплат|карточк.{0,16}выплат|блок.{0,12}выплат|your\s+payouts|payouts?\s+card).*(?:профил|profile)|(?:профил|profile).{0,48}(?:выплат|доступн.{0,16}баланс|withdraw|payout)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_menu_card_payouts выплаты карточка профиль`
      : `${question} profile_menu_card_payouts payouts card profile`;
  }

  if (
    /joy\s*coins?|joycoin|(?:монет|коин).{0,16}(?:профил|profile)|(?:профил|profile).{0,36}(?:монет|joycoin|joy\s*coins)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_menu_card_joycoins монеты профиль`
      : `${question} profile_menu_card_joycoins coins profile`;
  }

  if (
    /(?:волонт.{0,16}час|volunteer\s+hours)/i.test(scoutLower) &&
    /(?:профил|profile|меню|tab)/i.test(scoutLower)
  ) {
    return isRu
      ? `${question} profile_menu_card_volunteer_hours волонтёрские часы`
      : `${question} profile_menu_card_volunteer_hours volunteer hours`;
  }

  if (
    /сколько\s+язык|какие\s+язык|перечисл.{0,30}язык|список\s+язык|полн.{0,8}список.{0,12}язык|поддерживаем.{0,20}язык|поддерж.{0,24}приложен.{0,16}язык|интерфейс.{0,20}язык|локал.{0,16}(приложен|joy)|все\s+язык|язык.{0,20}joy\s*pick|how\s+many\s+languages?|which\s+languages?|what\s+languages?|list\s+of\s+languages?|supported\s+languages?|language\s+support|available\s+languages?|how\s+many\s+locales?/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} app_supported_languages_list десять языков en ru es ar zh hi fr pt he de`
      : `${question} app_supported_languages_list ten languages en ru es ar zh hi fr pt he de`;
  }

  if (
    /(?:мой\s+аккаунт|my\s+account).*(?:профил|меню|profile)|(?:пункт|меню|пункте).{0,16}(?:мой\s+аккаунт|my\s+account)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_menu_item_my_account_edit редактирование профиля`
      : `${question} profile_menu_item_my_account_edit edit profile`;
  }

  if (
    /(?:язык|language|локал|locale).*(?:профил|приложен|profile)|(?:профил|profile).{0,28}(?:язык|language|locale)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_menu_item_language app_supported_languages_list смена языка`
      : `${question} profile_menu_item_language app_supported_languages_list language picker`;
  }

  if (
    /(?:мои\s+заявк|my\s+requests).*(?:профил|меню|profile)|(?:профил|profile).{0,36}(?:мои\s+заявк|my\s+requests)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_menu_item_my_requests список заявок`
      : `${question} profile_menu_item_my_requests user requests list`;
  }

  if (
    /(?:уведомлен|notifications?).*(?:профил|меню|profile)|(?:профил|profile).{0,28}(?:уведомлен|notifications)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_menu_item_notifications экран уведомлений`
      : `${question} profile_menu_item_notifications notifications screen`;
  }

  if (
    /(?:поддержк|support).*(?:оператор|оператором|human|живой|человек)|(?:оператор).*(?:профил|чат)|(?:профил|profile).{0,40}(?:поддержк.{0,24}оператор|human\s+support)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_menu_item_support_operator чат оператор не support ai`
      : `${question} profile_menu_item_support_operator human operator chat not support ai`;
  }

  if (
    /(?:выйти из аккаунта|выход из приложения|log\s*out|sign\s*out).*(?:профил|profile)|(?:профил|profile).{0,24}(?:выйти|выход|log\s*out|sign\s*out)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_menu_item_log_out выход`
      : `${question} profile_menu_item_log_out logout`;
  }

  if (
    /удалить.{0,16}(?:аккаунт|профил)|delete.{0,16}(?:account|profile)|(?:профил|profile).{0,24}(?:удалить\s+аккаунт|delete\s+account)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_menu_item_delete_account удаление аккаунта`
      : `${question} profile_menu_item_delete_account delete account`;
  }

  if (
    /(?:админ|admin).{0,24}(?:профил|панел|panel)|(?:панел.{0,16}админ).*(?:профил|profile)/i.test(scoutLower)
  ) {
    return isRu
      ? `${question} profile_more_admin_panel администратор`
      : `${question} profile_more_admin_panel admin panel`;
  }

  if (
    /Help\.?joypick@gmail|help\.joypick|помощь.{0,20}поддержк.{0,20}(?:почт|email)|(?:ещё|ещё\s+раздел|раздел\s+ещё).{0,16}(?:помощь|support\s+email)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_more_help_email почта помощь`
      : `${question} profile_more_help_email help email`;
  }

  if (
    /(?:поделиться).{0,28}(?:приложен|магазин|app\s+store|google\s+play).*(?:профил|profile)|(?:профил|profile).{0,36}(?:поделиться.{0,16}приложен|share\s+app)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} profile_more_share_app ссылки магазины`
      : `${question} profile_more_share_app app store play`;
  }

  if (
    /что\s+(можно|есть)\s+(в\s+)?профил|что\s+делать\s+в\s+профил|функци.{0,24}профил|возможност.{0,16}профил|что\s+в\s+профиле|экран\s+профил|what\s+(can\s+i\s+do|is\s+there)\s+(in\s+|on\s+)?(the\s+)?profile|profile\s+(features|screen|menu)/i.test(
      scoutLower
    )
  ) {
    return isRu
      ? `${question} профиль вкладка выплаты монеты волонтёрские часы мои заявки язык уведомления поддержка оператор stripe редактирование выход удалить поделиться ещё profile_menu_items_index app_supported_languages_list product_profile_screen_full_features_list`
      : `${question} profile tab payouts coins volunteer hours my requests language notifications human support stripe edit logout delete share more profile_menu_items_index app_supported_languages_list product_profile_screen_full_features_list`;
  }

  // \w не матчит кириллицу — используем \p{L} для слов «заявки», «заявок» и т.д.
  if (
    /какие.{0,40}(заяв[\p{L}\p{N}_]*|запрос[\p{L}\p{N}_]*)|что\s+за\s+(заяв[\p{L}\p{N}_]*|запрос[\p{L}\p{N}_]*)|виды\s+(заяв[\p{L}\p{N}_]*|запрос[\p{L}\p{N}_]*)|список\s+(заяв[\p{L}\p{N}_]*|запрос[\p{L}\p{N}_]*)/iu.test(
      t
    ) ||
    /what\s+((kinds?\s+of|types?\s+of)\s+)?requests?\b|what\s+requests?\s+(exist|are\s+there)/i.test(t)
  ) {
    return isRu
      ? `${question} типы заявок существующие заявки карта список waste location speed cleanup event перечислить без уточнения создания`
      : `${question} request types browse map list waste location speed cleanup event existing requests`;
  }

  if (
    /по\s+заявк|в\s+заявк|в\s+карточк|на\s+деталях|details\s+screen|request\s+details/i.test(t) &&
    /что\s+можно\s+сделать|что\s+делать|какие\s+действия|what\s+can\s+i\s+do|available\s+actions/i.test(t)
  ) {
    if (/waste|мусор|уборк/i.test(t)) {
      return isRu
        ? `${question} действия в существующей waste заявке карточка детали app_flow_waste_details_bottom_actions join unjoin выполнить задачу продолжить отменить донат не создание`
        : `${question} existing waste request details actions app_flow_waste_details_bottom_actions join unjoin perform task continue cancel donate not create`;
    }
    if (/speed|быстр/i.test(t)) {
      return isRu
        ? `${question} действия в существующей speed заявке карточка детали app_flow_speed_cleanup_start_timer_moderation start таймер сдача pending донат не создание`
        : `${question} existing speed request details actions app_flow_speed_cleanup_start_timer_moderation start timer submit pending donate not create`;
    }
    if (/event|субботник|событ|ивент/i.test(t)) {
      return isRu
        ? `${question} действия в существующей event заявке карточка детали join unjoin выполнить задачу закрыть событие review участника не создание`
        : `${question} existing event request details actions join unjoin perform task close request participant review not create`;
    }
    return isRu
      ? `${question} действия в существующей заявке карточка детали доступные кнопки роли создатель исполнитель участник не создание`
      : `${question} existing request details available actions by role creator executor participant not creation`;
  }

  if (
    /хелп|справк|руководств[\p{L}\p{N}_]*\s+по\s+интерфейс|цвет[\p{L}\p{N}_]*\s+рамк|рамк[\p{L}\p{N}_]*\s+заяв|сер[\p{L}\p{N}_]*\s+круг|чип[\p{L}\p{N}_]*\s+донат|оранжев[\p{L}\p{N}_]*\s+рамк|жёлт[\p{L}\p{N}_]*\s+рамк|фиолет[\p{L}\p{N}_]*\s+рамк|зелён[\p{L}\p{N}_]*\s+рамк|кошелёк[\p{L}\p{N}_]*\s+на\s+главн|незаверш[\p{L}\p{N}_]*\s+баннер|посадк[\p{L}\p{N}_]*\s+дерев|только\s+вывоз|иконк[\p{L}\p{N}_]*\s+грузовик|\bhelp\b.*\b(ui|map|border|chip|guide)/iu.test(
      t
    ) ||
    /ui\s*guide|border\s*color|donation\s*chip|incomplete.*banner|what\s+.*\s+border|plant\s+tree|tree\s+planting|trash\s+pickup|haul\s*away|truck\s+icon/i.test(
      t
    )
  ) {
    return isRu
      ? `${question} раздел help руководство интерфейс карта рамка чип донат кошелёк посадка дерева вывоз грузовик`
      : `${question} help ui guide map border donation chip wallet home banner plant tree trash pickup truck`;
  }

  if (
    /холд|расхолд|возврат|не\s+выполн|никто\s+не|платн|донатн|куда\s+деньг|остались\s+деньги|остаются\s+деньги|вернут|списыва|платеж|могу\s+ли\s+я\s+вернуть/i.test(
      t
    ) ||
    /hold|refund|unfulfilled|not\s+completed|nobody|where\s+(does|do)\s+money|money\s+(stay|goes|remains)|debited|charged|get\s+my\s+money/i.test(
      t
    )
  ) {
    return isRu
      ? `${question} холд донатер расхолд возврат донат донатная платная заявка не выполнена`
      : `${question} donation hold donor release refund paid donation request unfulfilled`;
  }

  if (
    /новост|newsid|\/news\/|\bnews\b/i.test(t) &&
    /deeplink|диплин|ссылк|link|открыть|open/i.test(t)
  ) {
    return isRu
      ? `${question} deeplink новостей открыть экран новости newsId маршрут`
      : `${question} news deeplink open news details newsId route`;
  }

  if (
    (/\bjoin\b/i.test(t) || /присоедин/i.test(t)) &&
    (/waste|speed|garbage|trash|уборк|мусор|cleanup\s+request|обычн|участник|participant|details/i.test(t)) &&
    !/\bevent\b|мероприят|ивент|субботник|событие/i.test(t)
  ) {
    return isRu
      ? `${question} join request details участие waste speed не event`
      : `${question} join request details participation waste speed cleanup`;
  }

  if (
    (/участник|participant/i.test(t) && /завершен|completion|отправить|submit|mark\s+completed|результат/i.test(t)) ||
    /participant\s+completion|завершение\s+участником/i.test(t)
  ) {
    return isRu
      ? `${question} завершение участником отправка результата participant completion фото после`
      : `${question} participant completion submit result after photo evidence`;
  }

  if (/chatid|\/chat\/|маршрут\s+чат|open\s+chat\s+route|chat\s+deep\s*link/i.test(t)) {
    return isRu
      ? `${question} deeplink чата chatId маршрут /chat/ navigation`
      : `${question} chat deeplink chatId route /chat/ navigation`;
  }

  if (
    /поделиться|поделит|ссылк[\p{L}\p{N}_]*\s+на\s+заяв|сообщить[\p{L}\p{N}_]*\s+о\s+заяв|диплин|дипссыл|получить\s+так[\p{L}\p{N}_]*\s+ссылк/i.test(
      t
    ) ||
    /share\s+(a\s+)?request|request\s+link|deeplink|deep\s*link|get\s+(such\s+)?a?\s*link/i.test(t)
  ) {
    return isRu
      ? `${question} поделиться ссылка диплинк заявка детали магазин приложения`
      : `${question} share request deeplink app stores request details`;
  }

  if (/stripe|стрип/i.test(t) && /профил|подключ|connect|выплат|profile|payout/i.test(t)) {
    return isRu
      ? `${question} profile_menu_item_stripe stripe connect онбординг в приложении профиль выплаты`
      : `${question} profile_menu_item_stripe stripe connect profile onboarding in app payouts`;
  }

  if (
    /минимум.{0,40}донат|донат.{0,40}минимум|ниже\s+минимум|minimum.{0,30}donation|donation.{0,20}minimum/i.test(t)
  ) {
    return isRu
      ? `${question} минимальная сумма доната лимит 1 доллар stripe`
      : `${question} minimum donation amount limit 1.00 stripe`;
  }

  if (
    /отказаться|отменить участие|выйти из заяв|больше не участв|unjoin|cancel\s+participation|leave\s+(the\s+)?request/i.test(
      t
    ) &&
    /заяв|request|участ|joined|принял/i.test(t)
  ) {
    return isRu
      ? `${question} unjoin отменить участие детали заявки исполнитель`
      : `${question} unjoin cancel participation request details executor`;
  }

  if (/забыл.{0,20}парол|forgot.{0,20}password|восстановить.{0,30}доступ|recover.{0,20}account/i.test(t)) {
    return isRu
      ? `${question} сброс пароля forgot password экран вход auth`
      : `${question} password reset forgot password auth screen login`;
  }

  if (
    (/участ|присоедин|нажал/i.test(t) && /забыл|не приш|не пришёл|forgot/i.test(t) && /мусор|waste|уборк/i.test(t)) ||
    (/participat|joined|accepted/i.test(t) && /forgot|did not show|no show/i.test(t) && /waste|garbage|trash/i.test(t))
  ) {
    return isRu
      ? `${question} waste location join_date 24 часа статус new исполнитель снят снова в списке крон напоминание создатель снять исполнителя не донат`
      : `${question} waste location join_date 24 hours status new executor cleared list again cron reminder creator remove executor not donation substitute`;
  }

  if (
    (/создал|создала|создали|автор|только создал|не участвую/i.test(t) &&
      /заяв|уборк|мусор|waste|точк|деньг|донат|получ|положен/i.test(t)) ||
    (/created.{0,40}request|only created|not participate|did not participate|creator/i.test(t) &&
      /money|donat|payout|waste|garbage|cleanup|who gets/i.test(t))
  ) {
    return isRu
      ? `${question} waste location уборка мусора создатель не исполнитель донаты исполнитель участник speed event субботник donations_who_receives`
      : `${question} waste location creator not performer executor participant donations speed cleanup event subbotnik donations_who_receives`;
  }

  if (/галере|gallery|из\s+галере|from\s+gallery|стандартн.{0,12}фото/i.test(t)) {
    return isRu
      ? `${question} создание заявки сдача работы фото галерея камера разные экраны product_photos`
      : `${question} create request vs submit work gallery camera different screens product_photos`;
  }

  if (/новостн|новостная\s+лента|\bnews\s+feed\b|news\s+tab|есть\s+ли\s+лента/i.test(t)) {
    return isRu
      ? `${question} вкладка News новости карта список заявок отдельно обновить список`
      : `${question} News tab map list requests separate refresh list`;
  }

  if (/сортиров|обнов.{0,8}список|refresh.{0,12}list|новые\s+заявк.{0,20}верх/i.test(t)) {
    return isRu
      ? `${question} refresh список группы сортировка archived rejected completed`
      : `${question} refresh list sort groups archived rejected completed`;
  }

  if (
    (/волонт|volunteer/i.test(t) && /час|hours/i.test(t)) &&
    (/зачем|для чего|отслежив|учёт|учет|справк|принтер|pdf|why\s+track|what.{0,25}for|printer|certificat/i.test(t) ||
      /track(ing)?\s+volunteer|volunteer\s+hours.{0,30}(why|what|for)/i.test(t))
  ) {
    return isRu
      ? `${question} волонтёрские часы собственный учёт принтер pdf справка уборка мусора не донаты`
      : `${question} volunteer hours personal tally printer pdf certificate trash cleanup not donations`;
  }

  if (
    /вкладк|tab|главн|main\s+screen|unified|партн|станц|support\s+ai|психолог|news|новост/i.test(t) &&
    /как(ая|ой|ие|ое)\s+(вкладк|таб)|нумер|порядок|where\s+(is|are)|which\s+tab|four\s+tabs|сколько\s+вклад/i.test(t)
  ) {
    return isRu
      ? `${question} atlas четыре таба карта партнёры новости профиль support ai плюс создание`
      : `${question} atlas four tabs map partners news profile support ai plus create`;
  }

  if (/выплат|payout|кошел|wallet/i.test(t) && /карт|map|список|list|шапк|header|где\s+найти|where/i.test(t)) {
    return isRu
      ? `${question} выплаты шапка карты списка профиль payouts`
      : `${question} payouts map tab header profile atlas`;
  }

  if (
    /койн|joycoin|joy\s*coin|\bcoins?\b|монет/i.test(t) &&
    (/зачем|для чего|что такое|что значит|куда трат|обмен|спецмагаз|партн|нужн|использов|трат|why|what\s+(are|do)|purpose|spend|redeem/i.test(t) ||
      (/донат|donat|privilege|привилег/i.test(t) && /койн|joycoin|coin|коин/i.test(t)))
  ) {
    return isRu
      ? `${question} joycoins партнёры спецмагазины обмен не донаты stripe отдельно joycoins_purpose`
      : `${question} joycoins partner shops redemption not donations stripe separate joycoins_purpose`;
  }

  if (
    /когда.{0,50}деньг|деньг.{0,40}убор|скоро.{0,30}получ|ваш[ии]\s+выплат|your\s+payouts|выплат.{0,15}профил/i.test(t)
  ) {
    return isRu
      ? `${question} 7 дней ваши выплаты профиль модерация уборка коины отдельно партнёры`
      : `${question} 7 days your payouts profile moderation cleanup coins separate partners`;
  }

  if (/донат|donat|донейш|пожертв|donation|donate/i.test(t)) {
    return isRu
      ? `${question} донат donation donate детали деталей заявки заявку пожертвование отправить донат`
      : `${question} donation donate request details payment send donation`;
  }
  return question;
}

const knowledgeChunksCache = new Map();

function loadKnowledgeChunks(knowledgePath) {
  if (knowledgeChunksCache.has(knowledgePath)) {
    return knowledgeChunksCache.get(knowledgePath);
  }
  if (!fs.existsSync(knowledgePath)) {
    return [];
  }
  const raw = fs.readFileSync(knowledgePath, 'utf8');
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed.filter((x) => x && x.text) : [];
  knowledgeChunksCache.set(knowledgePath, list);
  return list;
}

/** Часто «субботник» + top_k=3: в промпт не попадал product_event… из‑за шума deeplink/каталога на токене event. */
const PINNED_EVENT_PARTICIPANT_CHUNK_ID = 'product_event_group_chat_share';
const PINNED_EVENT_MONEY_QA_CHUNK_ID = 'qa_event_money_after_approval_donations_stripe';
const PINNED_EVENT_NOBODY_JOINED_CHUNK_ID = 'qa_event_nobody_joined_creator_can_still_finish';
const PINNED_MODERATION_7DAY_CHUNK_ID = 'qa_moderation_7day_stripe_all_requests';
const PINNED_PHOTOS_GALLERY_CHUNK_ID = 'product_photos_gallery_vs_in_app_depends_on_screen';
const PINNED_NEWS_TAB_CHUNK_ID = 'product_news_tab_and_requests_are_different';
const PINNED_TERMINOLOGY_CHUNK_ID = 'support_terminology_executor_participant_not_volunteer';
const PINNED_LIST_SORT_CHUNK_ID = 'list_requests_filters_sorting_groups_refresh_button';
const PINNED_COMPLETED_VISIBILITY_CHUNK_ID = 'map_list_completed_requests_7_days_profile_my_requests';
const PINNED_MONEY_CLEANING_PAYOUT_QA_CHUNK_ID = 'qa_when_money_cleaning_profile_your_payouts_joycoins';
const PINNED_JOYCOINS_PURPOSE_CHUNK_ID = 'joycoins_purpose_partner_shops_only_not_donations';
const PINNED_VOLUNTEER_HOURS_PURPOSE_CHUNK_ID = 'qa_volunteer_hours_self_tracking_pdf_printer';
const PINNED_COMPANY_ABOUT_CHUNK_ID = 'company_joyvee_mission_and_what_company_does';
const PINNED_TYPES_FLOW_CHUNK_ID = 'flow_types_waste_speed_event_roles_and_lifecycle';
const PINNED_CREATOR_PAID_REQUEST_CHUNK_ID = 'request_donation_paid_map_list_badges';
const PINNED_DONATIONS_RECEIVER_FORMULA_CHUNK_ID = 'donations_who_receives_waste_vs_speed_event';
const PINNED_STRIPE_SETUP_REQUIREMENT_CHUNK_ID = 'stripe_executor_setup_requirement';
const PINNED_PAYOUTS_TABS_CHUNK_ID = 'payout_page_available_and_history_tabs';
const MAX_PINNED_KNOWLEDGE_CHUNKS = 8;

function buildUserContextLinesForPinning(conversationContext) {
  if (!Array.isArray(conversationContext) || !conversationContext.length) return '';
  return conversationContext
    .map((x) => normalizeText(x.user_message || ''))
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
}

function buildMergedRagTextForPinning(message, effectiveAug, effectiveRaw, conversationContext) {
  const userCtx = buildUserContextLinesForPinning(conversationContext);
  return [userCtx, message, effectiveAug, effectiveRaw].map(normalizeText).filter(Boolean).join('\n');
}

function shouldPinEventMoneyQaKnowledge(mergedText) {
  const t = String(mergedText || '').toLowerCase();
  const hasEvent = /субботник|суботник|subbotnik|мероприят|ивент|событ(ие|ия|ию|ием)?|\bevent\b/.test(t);
  const hasMoney = /деньг|получу|получит|заработ|выплат|stripe|донат|оплат/i.test(t);
  if (!hasEvent || !hasMoney) return false;
  if (
    /как\s+создать\s+(новую\s+)?(заявк|субботник)|хочу\s+(создать|добавить)\s+заявк|how\s+to\s+create\s+(a\s+)?(new\s+)?(request|cleanup|event)/i.test(
      t
    )
  ) {
    return false;
  }
  return true;
}

function shouldPinModeration7DayKnowledge(mergedRagText, currentMessage) {
  const bundle = `${String(currentMessage || '')}\n${String(mergedRagText || '')}`.toLowerCase();
  const asksTimingOrClose =
    /сколько\s+ждать|когда\s+закр|закрыти|модерац|одобр|how\s+long|moderation|approve|close\s+the\s+request/i.test(
      bundle
    );
  const mentionsSpeedOrPayoutContext =
    /быстр|speed\s+cleanup|\bspeed\b|быстрая\s+заявк|quick\s+cleanup|донат|stripe|7\s*дн|seven\s*days/i.test(bundle);
  return Boolean(asksTimingOrClose && mentionsSpeedOrPayoutContext);
}

function shouldPinEventNobodyJoinedKnowledge(mergedText, currentMessage) {
  if (isMoneyDominantShortFollowUp(currentMessage)) {
    return false;
  }
  const t = String(mergedText || '').toLowerCase();
  const hasEvent = /субботник|суботник|subbotnik|мероприят|ивент|событ(ие|ия|ию|ием)?|\bevent\b/.test(t);
  const nobody =
    /никто\s+не\s+прид|никто\s+не\s+приш|не\s+придут|не\s+пришл|нет\s+участник|ни\s+один\s+не\s+приш|no\s+one\s+comes|nobody\s+(came|shows|joins)/i.test(
      t
    );
  return hasEvent && nobody;
}

function shouldPinEventParticipantKnowledge(mergedText, currentMessage) {
  if (isMoneyDominantShortFollowUp(currentMessage)) {
    return false;
  }
  const t = String(mergedText || '').toLowerCase();
  const hasEventLexem =
    /субботник|суботник|subbotnik|мероприят|ивент|событ(ие|ия|ию|ием)?|\bevent\b/.test(t);
  if (!hasEventLexem) return false;
  if (
    /как\s+создать\s+(новую\s+)?(заявк|субботник)|хочу\s+(создать|добавить)\s+заявк|новая\s+заявк|добавить\s+заявк|how\s+to\s+create\s+(a\s+)?(new\s+)?(request|cleanup|event)|want\s+to\s+(create|add)\s+(a\s+)?request|creating\s+an?\s+event/i.test(
      t
    )
  ) {
    return false;
  }
  return /участник|отчит|проделан|работ(е|у|ы)?|что\s+(мне\s+)?делать|как\s+действовать|приехать|прийти|фотоотч|фото\s*после|закрыть\s+(сво[её]\s+)?участ|выйти\s+из\s+участ|подтвержд.{0,16}создател|ожидает\s+создател|выполнить\s+задач|сдач[аи]\s+работ|submit\s+work|perform\s+task|photo\s+(after|report)|wait(ing)?\s+for\s+the\s+creator|close\s+(my\s+)?participation/i.test(
    t
  );
}

function shouldPinPhotosGalleryKnowledge(bundleLower) {
  return /галере|gallery|из\s+галере|from\s+gallery|стандартн.{0,16}фото|iphone\s+photos|native\s+camera/i.test(
    bundleLower
  );
}

function shouldPinNewsTabKnowledge(bundleLower) {
  return (
    /новостн|новостная\s+лента|лента\s+новост|таб\s+новост|\bnews\s+tab\b|news\s+feed|no\s+separate\s+news|нет\s+отдельн.{0,20}новост/i.test(
      bundleLower
    ) ||
    (/узнают.{0,40}нов|новые\s+заявк.{0,40}уведом|volunteers.{0,40}find.{0,30}new\s+requests/i.test(bundleLower) &&
      !/deeplink|диплин|\/news\//i.test(bundleLower))
  );
}

function shouldPinTerminologyVolunteerKnowledge(bundleLower) {
  const moneyish = /деньг|money|stripe|paid|payout|donat|donation|получу|заработ/i.test(bundleLower);
  const volunteerLex = /волонт|volunteer/i.test(bundleLower);
  const completedClaim = /выполнил|completed|finished|сделал\s+работ/i.test(bundleLower);
  return volunteerLex || (moneyish && completedClaim);
}

function shouldPinListSortingKnowledge(bundleLower) {
  return /сортиров|обнов|refresh|список.{0,20}заяв|новые\s+заявк.{0,30}верх|появляются\s+сверху|как\s+(найти|увидеть).{0,25}нов/i.test(
    bundleLower
  );
}

function shouldPinCompletedVisibilityKnowledge(bundleLower) {
  return /выполнен|completed\s+requests|только\s+активн|only\s+active|где\s+.{0,20}выполнен|архив.{0,12}заяв/i.test(
    bundleLower
  );
}

/** Зачем коины / не путать с донатами — только партнёрские магазины. */
function shouldPinJoyCoinsPurposeKnowledge(bundleLower) {
  const hasCoin = /койн|joycoin|joy\s*coin|\bcoins?\b|монет|коинов/i.test(bundleLower);
  if (!hasCoin) return false;
  const asksPurpose =
    /зачем|для чего|что такое|что значит|куда трат|обмен|спецмагаз|партн.{0,12}магаз|нужн.{0,15}коин|использов|тратить|why\s+.*coin|what\s+(are|do).{0,12}coins|purpose|spend|redeem|partner\s+shop/i.test(
      bundleLower
    );
  const coinsVsDonations =
    /донат|donation|привилег|privilege/i.test(bundleLower) && /койн|joycoin|coin|коин/i.test(bundleLower);
  return asksPurpose || coinsVsDonations;
}

/** Зачем волонтёрские часы — учёт + PDF по принтеру; не донаты. */
function shouldPinVolunteerHoursPurposeKnowledge(bundleLower) {
  const volHours =
    (/волонт/i.test(bundleLower) && /час|hours/i.test(bundleLower)) ||
    /volunteer\s+hours/i.test(bundleLower);
  if (!volHours) return false;
  const asksPurpose =
    /зачем|для чего|отслежив|надо\s+ли\s+отслеж|why\s+track|what.{0,35}(for|purpose)|purpose\s+of/i.test(
      bundleLower
    );
  const docPdf = /принтер|print|pdf|справк|certificat|letter\s+hours/i.test(bundleLower);
  return asksPurpose || docPdf;
}

/** «Когда деньги за уборку» / сроки выплат — 7 дней, блок «Ваши выплаты» (не пинить только из‑за слова joycoins — см. отдельный чанк про назначение коинов). */
function shouldPinMoneyCleaningPayoutKnowledge(bundleLower) {
  if (/субботник|subbotnik|\bevent\b|мероприят|ивент/i.test(bundleLower)) {
    return false;
  }
  const moneyTiming =
    /когда.{0,40}деньг|деньг.{0,30}убор|скоро.{0,25}получ|получу.{0,20}деньг|получить.{0,15}деньг|how\s+soon.{0,30}money|money\s+for\s+clean|get\s+paid.{0,20}clean|when.{0,25}payout/i.test(
      bundleLower
    );
  const cleanupCtx =
    /уборк|clean|cleanup|убрал|выполнил.{0,15}работ|деньг\s+за\s+убор/i.test(bundleLower);
  const payoutsHelp = /ваш[ии]\s+выплат|your\s+payouts/i.test(bundleLower);
  return (moneyTiming && cleanupCtx) || payoutsHelp;
}

function shouldPinCompanyKnowledge(bundleLower) {
  return /joyvee|компан|about\s+.*company|what\s+does\s+your\s+company\s+do|who\s+are\s+you|чем\s+занимаетесь|кто\s+вы/i.test(
    bundleLower
  );
}

function shouldPinTypesFlowKnowledge(bundleLower) {
  return /по\s+типам|типы\s+заяв|не\s+путай|waste\s+location|speed\s+cleanup|субботник|event|roles?\s+and\s+lifecycle|difference\s+between\s+waste\s+speed\s+event/i.test(
    bundleLower
  );
}

function shouldPinCreatorPaidRequestKnowledge(bundleLower) {
  return /заказать\s+уборк|оплатить\s+уборк|платн.{0,20}заявк|донатн.{0,20}заявк|создать\s+.*(платн|донатн).{0,20}заявк|can\s+i\s+pay\s+for\s+cleanup|paid\s+request|sponsor\s+cleanup|fund\s+cleanup/i.test(
    bundleLower
  );
}

function shouldPinDonationAmountFormulaKnowledge(bundleLower) {
  const asksAmount =
    /какую\s+сумм|какая\s+сумм|сколько\s+получ|сколько\s+денег|сумма\s+выплат|amount\s+will\s+i\s+get|how\s+much\s+will\s+i\s+get|payout\s+amount|how\s+much\s+money/i.test(
      bundleLower
    );
  const donationPayoutContext =
    /донат|donat|donation|выплат|payout|stripe|уборк|cleanup|заявк|request|исполн|participant|участник/i.test(
      bundleLower
    );
  return asksAmount && donationPayoutContext;
}

function shouldPinPayoutBlockedKnowledge(bundleLower) {
  const asksTimingOrMissing =
    /когда.{0,40}(выплат|деньг)|почему.{0,40}(не\s+приш|нет\s+выплат|не\s+выплат)|где\s+выплат|waiting\s+for\s+payout|when.{0,30}payout|why.{0,30}(not\s+paid|no\s+payout)|payout\s+(missing|blocked)|no\s+funds|pending/i.test(
      bundleLower
    );
  const payoutCtx = /выплат|донат|stripe|payout|donation|withdraw|available|history/i.test(bundleLower);
  return asksTimingOrMissing && payoutCtx;
}

function shouldPinStageActionsKnowledge(bundleLower) {
  const asksNextAction =
    /что\s+дальше|что\s+теперь|какой\s+следующ|что\s+делать\s+дальше|next\s+step|what\s+next|what\s+should\s+i\s+do\s+next|what\s+to\s+do\s+now/i.test(
      bundleLower
    );
  const hasStageSignals =
    /присоединил|joined|выполняю|in\s+progress|сдал|submitted|жду\s+создател|waiting\s+creator|pending|жду\s+модерац|waiting\s+moderation|отправил.*модерац|submitted\s+for\s+moderation|одобрен|approved|отклонен|отклонили|rejected|24\s*час|auto.*released|завершил|completed/i.test(
      bundleLower
    );
  return asksNextAction || hasStageSignals;
}

function collectPinnedKnowledgeChunkIds(mergedRagText, currentMessage) {
  const bundle = `${String(currentMessage || '')}\n${String(mergedRagText || '')}`.toLowerCase();
  const ids = [];
  if (shouldPinCreatorPaidRequestKnowledge(bundle)) {
    ids.push(PINNED_CREATOR_PAID_REQUEST_CHUNK_ID);
  }
  if (shouldPinDonationAmountFormulaKnowledge(bundle)) {
    ids.push(PINNED_DONATIONS_RECEIVER_FORMULA_CHUNK_ID);
  }
  if (shouldPinPayoutBlockedKnowledge(bundle)) {
    ids.push(PINNED_MODERATION_7DAY_CHUNK_ID);
    ids.push(PINNED_MONEY_CLEANING_PAYOUT_QA_CHUNK_ID);
    ids.push(PINNED_STRIPE_SETUP_REQUIREMENT_CHUNK_ID);
    ids.push(PINNED_PAYOUTS_TABS_CHUNK_ID);
  }
  if (shouldPinStageActionsKnowledge(bundle)) {
    ids.push(PINNED_TYPES_FLOW_CHUNK_ID);
    ids.push(PINNED_EVENT_PARTICIPANT_CHUNK_ID);
  }
  if (shouldPinTypesFlowKnowledge(bundle)) {
    ids.push(PINNED_TYPES_FLOW_CHUNK_ID);
  }
  if (shouldPinCompanyKnowledge(bundle)) {
    ids.push(PINNED_COMPANY_ABOUT_CHUNK_ID);
  }
  if (shouldPinJoyCoinsPurposeKnowledge(bundle)) {
    ids.push(PINNED_JOYCOINS_PURPOSE_CHUNK_ID);
  }
  if (shouldPinVolunteerHoursPurposeKnowledge(bundle)) {
    ids.push(PINNED_VOLUNTEER_HOURS_PURPOSE_CHUNK_ID);
  }
  if (shouldPinPhotosGalleryKnowledge(bundle)) {
    ids.push(PINNED_PHOTOS_GALLERY_CHUNK_ID);
  }
  if (shouldPinNewsTabKnowledge(bundle)) {
    ids.push(PINNED_NEWS_TAB_CHUNK_ID);
  }
  if (shouldPinTerminologyVolunteerKnowledge(bundle)) {
    ids.push(PINNED_TERMINOLOGY_CHUNK_ID);
  }
  if (shouldPinListSortingKnowledge(bundle)) {
    ids.push(PINNED_LIST_SORT_CHUNK_ID);
  }
  if (shouldPinCompletedVisibilityKnowledge(bundle)) {
    ids.push(PINNED_COMPLETED_VISIBILITY_CHUNK_ID);
  }
  if (shouldPinMoneyCleaningPayoutKnowledge(bundle)) {
    ids.push(PINNED_MONEY_CLEANING_PAYOUT_QA_CHUNK_ID);
  }
  if (shouldPinModeration7DayKnowledge(mergedRagText, currentMessage)) {
    ids.push(PINNED_MODERATION_7DAY_CHUNK_ID);
  }
  if (shouldPinEventNobodyJoinedKnowledge(mergedRagText, currentMessage)) {
    ids.push(PINNED_EVENT_NOBODY_JOINED_CHUNK_ID);
  }
  if (shouldPinEventMoneyQaKnowledge(mergedRagText)) {
    ids.push(PINNED_EVENT_MONEY_QA_CHUNK_ID);
  }
  if (shouldPinEventParticipantKnowledge(mergedRagText, currentMessage)) {
    ids.push(PINNED_EVENT_PARTICIPANT_CHUNK_ID);
  }
  return ids.slice(0, MAX_PINNED_KNOWLEDGE_CHUNKS);
}

/** У денежного фоллоуапа убираем из RAG «длинный флоу» и «никто не пришёл» — иначе модель снова их пересказывает. */
function filterRetrievalNoiseForMoneyFollowUp(chunks, currentMessage) {
  if (!isMoneyDominantShortFollowUp(currentMessage) || !Array.isArray(chunks)) {
    return chunks;
  }
  const drop = new Set([PINNED_EVENT_PARTICIPANT_CHUNK_ID, PINNED_EVENT_NOBODY_JOINED_CHUNK_ID]);
  return chunks.filter((c) => c && !drop.has(c.chunk_id));
}

function applyPinnedKnowledgeChunks(chunks, knowledgePath, mergedRagText, topK, currentMessage) {
  const k = Math.max(1, Number(topK) || DEFAULT_TOP_K);
  const base = filterRetrievalNoiseForMoneyFollowUp(Array.isArray(chunks) ? [...chunks] : [], currentMessage);
  const pinIds = collectPinnedKnowledgeChunkIds(mergedRagText, currentMessage);
  if (!pinIds.length) {
    return base.slice(0, k);
  }
  const all = loadKnowledgeChunks(knowledgePath);
  const pinnedList = [];
  const seen = new Set();
  for (const id of pinIds) {
    const c = all.find((x) => x && x.chunk_id === id);
    if (c && !seen.has(id)) {
      pinnedList.push(c);
      seen.add(id);
    }
  }
  if (!pinnedList.length) {
    return base.slice(0, k);
  }
  const pinIdSet = new Set(pinIds);
  const rest = base.filter((c) => !pinIdSet.has(c.chunk_id));
  return [...pinnedList, ...rest].slice(0, k);
}

function retrieveTopChunks(question, knowledgePath, topK = DEFAULT_TOP_K) {
  return retrieveTopChunksFused([question], knowledgePath, topK);
}

function buildSystemInstruction(answerLanguage) {
  const languageInstruction =
    answerLanguage === 'ru'
      ? 'Answer in Russian only.'
      : 'Answer in English only.';
  const inAppScopeRule =
    answerLanguage === 'ru'
      ? 'Считай вопрос про приложение, если спрашивают: зачем / для чего Joy Pick, что это за приложение, что делать в приложении, как пользоваться, с чего начать, какие есть функции, как создать заявку — это НЕ оффтоп. Короткие формулировки вроде «что насчёт приложения?», «что насчёт вашего/этого app?», «what about this app?», «what about your app?», «what about JoyPick app?» тоже всегда про приложение. Вопросы о компании Joyvee (например «чем занимается ваша компания?») тоже в рамках поддержки: кратко ответь о миссии компании и свяжи с приложением Joy Pick. Для таких вопросов НИКОГДА не отвечай фразой «вопрос не относится к приложению». Слова «субботник», «субботнике», subbotnik — в Joy Pick это тип заявки Event (экран заявки в приложении), а не общая «районная уборка»; не подменяй шаги приложения советами «организаторам во дворе», если в Knowledge есть флоу Event.'
      : 'Treat as in-app if the user asks what Joy Pick is for, what the app does, what to do in the app, how to use it, how to get started, or what features exist — these are NEVER off-topic. Short phrasings like "what about this app?", "what about your app?", and "what about JoyPick app?" are also always in-app. Questions about Joyvee company (for example, "what does your company do?") are also in-scope: answer briefly about the company mission, then connect it to Joy Pick app capabilities. Never reply with «not related to the app» for those. Words like subbotnik / «субботник» mean an Event-type in-app request (request details UI), not generic neighborhood cleanup advice—follow Knowledge Event flow; do not answer as if the user asked only a real-world community organizer.';
  const offTopicRule =
    answerLanguage === 'ru'
      ? 'Явный оффтоп (погода, политика, кино, случайная болтовня, бытовой small talk, одно только приветствие без вопроса по Joy Pick — всё, что не про приложение): не начинай с «Привет» и не отвечай как на дружескую болтовню. Кратко и по делу: сообщение не относится к приложению Joy Pick; ты отвечаешь только на вопросы по приложению; предложи задать вопрос по Joy Pick. Эту формулировку не используй для вопросов про само приложение (см. правило выше про «что это за приложение», функции, заявки).'
      : 'Clear off-topic (weather, politics, movies, random chitchat, small talk, or a bare greeting with no Joy Pick question): do NOT open with «Hello» or chat casually. Briefly state the message is not about the Joy Pick app; you only answer questions about the app; invite an app-related question. Never use this wording for genuine in-app questions (see the rule above about what Joy Pick is, features, requests).';
  const inAppNoKnowledgeRule =
    answerLanguage === 'ru'
      ? 'Если вопрос про приложение, но в Knowledge нет деталей — ответь по общему назначению Joy Pick (эко-инициативы, карта, заявки, донаты, коины) в пределах известного, без выдуманных кнопок; при необходимости скажи, что точной инструкции в справочнике нет и можно написать в поддержку.'
      : 'If the question is in-scope but Knowledge lacks details, answer with high-level truthful info about Joy Pick (cleanups, map, requests, donations, coins) without inventing UI; say the help base may not cover specifics and support can help.';
  const joyCoinsVsDonationsRule =
    answerLanguage === 'ru'
      ? 'JoyCoins (коины): только обмен у партнёров в специальных магазинах (блок монет в профиле, QR). Никогда не пиши, что коины нужны для получения донатов или «привилегий» в денежном смысле — донаты это Stripe и «Ваши выплаты», отдельно от коинов. Если пользователь уточняет формулировку про коины и донаты — ответь по сути новым текстом, не повторяй предыдущий ответ дословно.'
      : 'JoyCoins are redeemed only at partner shops (Profile coins block / QR). Never claim coins are for receiving donations or cash-like «privileges»—donations use Stripe / Your payouts, separate from coins. If the user clarifies coins vs donations, answer directly with new wording—do not repeat the previous reply verbatim.';
  const volunteerHoursVsDonationsRule =
    answerLanguage === 'ru'
      ? 'Волонтёрские часы: учёт времени для себя; PDF-справка по иконке принтера в профиле о участии в уборке мусора для предъявления третьим лицам. Не связывай учёт часов с донатами или «привилегиями» выплат.'
      : 'Volunteer hours are a personal time tally; the printer icon in Profile gives a PDF certificate of trash-cleanup participation for third parties. Never tie hours tracking to donations or payout privileges.';
  const directQuestionFirstRule =
    answerLanguage === 'ru'
      ? 'Сначала отвечай на фактический смысл вопроса (общий контекст, бытовая или предметная тема, условия и т.п.). Развёрнутые пошаговые инструкции по приложению (экраны, кнопки, типы заявок, как создать или изменить заявку) давай только если пользователь явно или недвусмысленно спрашивает действие внутри Joy Pick: навигация, создание заявки, где найти функцию. Если вопрос сформулирован обще или про реальный мир без запроса сценария в приложении — не подменяй ответ длинным туториалом; при необходимости добавь краткую связку с приложением в конце (одно-два предложения), без пронумерованного чеклиста создания заявки и без выдуманного контекста («например под окном»), которого не было в вопросе.'
      : 'Answer the user’s actual question first (general context, everyday or topical question, conditions, etc.). Give long step-by-step in-app instructions (screens, buttons, request types, how to create or edit a request) only when they clearly ask for something inside Joy Pick: navigation, creating a request, where to find a feature. For general or real-world questions that do not ask for an in-app walkthrough, do not replace the answer with a full tutorial; at most add a short app-related closing note (one or two sentences)—no numbered create-request checklist and no invented scenario details the user did not mention.';
  return [
    'You are Joy Pick support assistant.',
    languageInstruction,
    inAppScopeRule,
    offTopicRule,
    inAppNoKnowledgeRule,
    joyCoinsVsDonationsRule,
    volunteerHoursVsDonationsRule,
    directQuestionFirstRule,
    'For in-app questions, rely on the provided Knowledge snippets; do not contradict them.',
    'Do not use Markdown (no **bold**, no *italics*, no backticks). Plain text only so chat UI shows no asterisks.',
    'Ask for request type (waste vs speed vs event) ONLY when the user clearly wants to CREATE a new request but did not name a type.',
    'If the user asks what requests exist, what request types exist, or how to see/browse requests on the map/list, answer immediately: list the three types and say they appear on the main map/list—do NOT use the create-flow clarification question.',
    'If user already answered the clarifying question with a short synonym (for example: subbotnik, event, cleanup event), do not repeat the same clarifying question again.',
    answerLanguage === 'ru'
      ? 'Если спрашивают, как привлечь людей на уборку территории: отвечай короткими предложениями. Субботник для времени и места, присоединение из карточки, расшарить через «Поделиться» в деталях, для срочной точки на карте часто уборка мусора с донатом. Соцсети не делай центром ответа.'
      : 'If asked how to attract people to a territory cleanup: short sentences. Subbotnik for time and place, join from the card, share from details, for a map pin often trash cleanup with donation. Do not center social media.',
    'For money/refund/hold questions, follow Knowledge about donation holds and donor refunds; never replace it with vague «money stays on the platform» or «depends on policy» if Knowledge says otherwise.',
    'Joy Pick does not accumulate user funds as a platform balance: Knowledge describes hold via Stripe and direct distribution after approval. For Event, payout logic follows the chain: participant submits result -> creator approves participant result -> moderation/approval -> split among eligible Stripe-connected participants per Knowledge.',
    answerLanguage === 'ru'
      ? 'Критично: для Waste Location автор точки не получает донаты «за одно создание», если сам не был исполнителем уборки. Донаты идут исполнителю, который убрал и прошёл проверку. Не называйте роль «волонтёр» — в продукте «исполнитель» и «участник». Speed: создатель = исполнитель своей уборки. Event: организатор участвует; доли по Knowledge.'
      : 'Critical: for Waste Location the pin creator does not get donation payouts for creating the pin alone if they did not execute the cleanup. Donations go to the executor who cleaned and passed review. Do not call users «volunteers» as a role—use executor and participant. Speed Cleanup: creator is the performer. For payout timing/conditions, use chain by type: Waste/Event -> submit result -> creator acceptance -> moderation/approval -> payouts by Stripe rules; Speed -> submit own result -> moderation/approval -> payouts by Stripe rules.',
    answerLanguage === 'ru'
      ? 'Для вопросов про конкретную сумму («какую сумму получу», «сколько денег получу») не отвечай расплывчато «зависит от случаев/факторов». Базовая формула: исполнитель/участник получает всю донатную сумму, которая положена ему по типу заявки, за вычетом **сначала** комиссии **Stripe**, **затем** инфраструктурного сбора Joy Pick (~7%, не «прибыль приложения»); для Event с несколькими участниками сумма сначала делится по правилам заявки (равные доли среди участников с подключённым Stripe), затем применяются комиссии.'
      : 'For concrete amount questions ("how much will I get"), do not answer vaguely with "it depends". Base formula: executor/participant gets the donation amount assigned to them by request type **minus Stripe processing first**, **then** the Joy Pick infrastructure fee (~7%, not “app profit”); for Event with multiple participants, split by request rules first (equal shares among Stripe-connected participants), then fees apply.',
    answerLanguage === 'ru'
      ? 'Для вопросов «когда придёт выплата» и «почему не пришла выплата» отвечай чеклистом причин, а не общими фразами: (1) сдан ли результат; (2) есть ли подтверждение создателем для Waste/Event; (3) пройдена ли модерация; (4) прошло ли окно 7 дней от первой сдачи; (5) подключён ли Stripe; (6) есть ли сумма в Profile -> Ваши выплаты (Available).'
      : 'For “when payout arrives” and “why payout did not arrive” questions, answer with a concrete checklist, not generic wording: (1) result submitted; (2) creator acceptance for Waste/Event; (3) moderation passed; (4) 7-day window from first submission elapsed; (5) Stripe connected; (6) amount visible in Profile -> Your payouts (Available).',
    answerLanguage === 'ru'
      ? 'Для вопросов по стадии («что дальше», «я уже присоединился/выполняю/сдал/жду») отвечай только следующим шагом текущей стадии и не предлагай шаги из прошлых стадий. Карта по стадиям: joined_not_started -> начать выполнение; in_progress -> сдать результат; submitted_waiting_creator -> ждать/получить подтверждение создателя (Waste/Event); submitted_waiting_moderation -> ждать модерацию; approved_waiting_payout_window -> ждать окно выплат и смотреть «Ваши выплаты»; rejected -> исправить и пересдать по доступным действиям; timeout_auto_released -> снова присоединиться к доступной заявке.'
      : 'For stage questions ("what next", "I already joined/in progress/submitted/waiting"), answer only with the immediate next step for the current stage and do not suggest earlier-stage actions. Stage map: joined_not_started -> start work; in_progress -> submit result; submitted_waiting_creator -> wait for/get creator acceptance (Waste/Event); submitted_waiting_moderation -> wait for moderation; approved_waiting_payout_window -> wait payout window and check Your payouts; rejected -> fix and resubmit per available actions; timeout_auto_released -> re-join an available request.',
    answerLanguage === 'ru'
      ? 'Если спрашивают «присоединился к уборке мусора и забыл / не пришёл»: по Knowledge — автоматическое снятие исполнителя после дедлайна с join (на сервере 24 часа), заявка снова new и снова в выдаче; создатель может снять исполнителя вручную; отдельно есть долгий сценарий 7+1 суток от created_at для зависшего inProgress. Не утверждайте, что «участие ни на что не влияет». Не предлагайте донат как замену физической уборки.'
      : 'If the user joined a Waste Location then forgot or did not show: per Knowledge/backend automation the executor slot is released after the join-based deadline (24 hours from join_date), request returns to new and becomes available again; creator may clear the executor manually; a separate long-stall path warns around 7 days from created_at. Do not claim joining «does not affect» the request. Never suggest donating instead of physically doing the cleanup.',
    'When the user asks what map colors, donation chips, wallet/news buttons, or incomplete banners mean, use the Help/UI Guide chunks and suggest opening Help in the app for the illustrated reference.',
    answerLanguage === 'ru'
      ? 'Значок дерева по Help — это индикатор «Посадка дерева» для события (Event / субботник) и опции при создании события; это не тип заявки «Уборка мусора» (Waste Location). Не утверждай, что дерево означает именно мусорную заявку.'
      : 'Per Help, the tree icon is the Plant Tree indicator for Events (including the toggle when creating an Event)—not the Waste Location request type. Do not claim the tree icon means trash-cleanup request type.',
    answerLanguage === 'ru'
      ? 'Зелёная рамка карточки заявки по Help означает «ваши заявки — созданные вами» (вы автор). Не говори, что зелёная рамка сама по себе означает «донатную» или «платную» заявку. Признак донатов на карте — зелёный знак доллара под иконкой маркера; жёлтая рамка — вы задонатили в эту заявку.'
      : 'Per Help, a green card border means requests you created (you are the creator). Do not claim the green border alone means a donation/paid request. Donations on the map are shown by the green $ under the marker; yellow border means you donated to that request.',
    'For «connect Stripe in profile», explain the in-app profile/payouts flow from Knowledge; do not refuse as if the user asked for external-only Stripe signup.',
    answerLanguage === 'ru'
      ? 'Когда спрашивают «куда переводятся деньги со Stripe / на какие реквизиты», формулируйте точно: выплаты идут на подключенный в Stripe банковский счёт или карту для payouts (согласно настройкам Stripe). Избегайте расплывчатой формулировки «на счёт, подключённый через Stripe».'
      : 'When asked where Stripe money is transferred, answer precisely: payouts go to the bank account or payout card connected in Stripe (per Stripe payout settings). Avoid vague wording like "to an account connected through Stripe."',
    answerLanguage === 'ru'
      ? 'На фоллоуапе отвечайте в первую очередь на НОВЫЙ вопрос; не копируйте целиком прошлый ответ. Если новый вопрос только про деньги/донаты/Stripe — не повторяйте абзац «никто не пришёл — выполните одни»; кратко по деньгам, условия — в одной-двух фразах.'
      : 'On follow-ups, answer the NEW question first; do not restate the full prior reply. If the new question is only about money/donations/Stripe, do not repeat the «nobody came—finish alone» paragraph; answer payments concisely (conditions in one or two short sentences).',
    'Use Conversation context to resolve short follow-ups (yes/no, «а где?», «через профиль?»): they refer to the previous topic unless the user clearly switches subject.',
    answerLanguage === 'ru'
      ? 'Если в Conversation уже шли про Event/субботник, а новый короткий вопрос про деньги («получу?», «а деньги?») — отвечайте по цепочке Event: сдача, одобрение создателя, модерация, донаты, Stripe; не начинайте с ответа про Waste Location «не пришёл за 24 часа», если пользователь не переключился на уборку мусора.'
      : 'If Conversation was about Event/subbotnik and the user asks a short money follow-up, answer with the Event chain (submission, creator approval, moderation, donations, Stripe); do not lead with the Waste Location 24-hour no-show rule unless they clearly switched to trash-pin cleanups.',
    answerLanguage === 'ru'
      ? 'Для Event вопрос «никто не пришёл / не придут участники» не равен «заявка не выполнена — донаты всем вернутся»: создатель может выполнить работу в приложении сам; возврат с холда — про реально невыполненную заявку по правилам, не про низкую явку.'
      : 'For Event questions, «nobody came / no volunteers» is not the same as «unfulfilled—donors get refunded»: the creator can still complete the in-app work alone; donor hold release applies to truly unfulfilled requests per rules, not low attendance.',
    answerLanguage === 'ru'
      ? 'Если пользователь спрашивает «как зарабатывать / как получать деньги в приложении», отвечай структурно по 3 типам: Waste Location (исполнитель: сдача результата -> подтверждение создателем -> модерация -> выплата при Stripe), Speed Cleanup (исполнитель/создатель в одном лице: сдача -> модерация -> выплата при Stripe), Event (участник: сдача результата -> подтверждение создателем -> модерация -> доля при Stripe). Не пропускай шаг подтверждения создателем для Waste/Event.'
      : 'If the user asks how to earn/get money in the app, answer by all 3 request types: Waste Location (executor: submit result -> creator acceptance -> moderation -> payout with Stripe), Speed Cleanup (creator=performer: submit -> moderation -> payout with Stripe), Event (participant: submit result -> creator acceptance -> moderation -> share with Stripe). Do not omit creator acceptance for Waste/Event.',
    answerLanguage === 'ru'
      ? 'Если вопрос про различия типов заявок (Waste/Speed/Event), отвечай строго по типам и ролям (создатель/исполнитель/участник), не смешивай шаги между типами. Для Event не подставляй правило Waste «24 часа join», а для Waste не подставляй event-цепочку с групповым закрытием.'
      : 'If asked about differences between request types (Waste/Speed/Event), answer strictly by type and role (creator/executor/participant), and do not mix steps across types. Do not inject Waste 24h join timeout into Event answers, and do not inject Event group-close chain into Waste answers.',
    answerLanguage === 'ru'
      ? 'Если пользователь спрашивает про УЖЕ существующую заявку («по заявке…», «в заявке…», «что можно сделать в этой заявке»), отвечай по действиям на экране деталей этой заявки (доступные кнопки и роли) и НЕ предлагай создание новой заявки, если пользователь явно не спрашивал «как создать».'
      : 'If user asks about an ALREADY existing request ("in this request", "what can be done in this request"), answer with actions available on that request details screen (buttons and roles), and do NOT suggest creating a new request unless the user explicitly asked how to create one.',
    answerLanguage === 'ru'
      ? 'Используй подсказку роли пользователя из промпта (исполнитель / создатель / донатер / интересующийся): сначала отвечай с позиции этой роли. Если роль исполнитель, не начинай ответ с действий создателя, если пользователь этого не спрашивал.'
      : 'Use the user role hint from the prompt (executor / creator / donor / general user): answer from that role first. If role is executor, do not lead with creator actions unless explicitly asked.',
    answerLanguage === 'ru'
      ? 'Используй также подсказку стадии из промпта (не взялся / присоединился но не начал / выполняет / сдал и ждёт / одобрено / отклонено и т.д.). Не предлагай действия из предыдущей стадии: если стадия «выполняет», не предлагай «присоединиться»; если стадия «сдал», не предлагай «выполнить задачу заново», если пользователь это явно не просил.'
      : 'Use the stage hint from the prompt as well (not joined / joined not started / in progress / submitted waiting / approved / rejected, etc.). Do not suggest actions from earlier stages: if stage is in_progress, do not suggest joining; if stage is submitted, do not suggest taking/starting again unless explicitly asked.',
    answerLanguage === 'ru'
      ? 'Если роль в подсказке — «исполнитель_в_процессе», считай, что пользователь уже взял задачу: не предлагай «стать исполнителем», «присоединиться» или «взять заявку». Отвечай следующими шагами этой стадии: завершение, сдача результата, подтверждение создателем (для Waste/Event), модерация, условия выплат.'
      : 'If role hint is executor_in_progress, user already took the task: do not suggest becoming executor, joining, or taking the request. Answer with next-stage steps only: completion submission, moderation, payout conditions.',
    answerLanguage === 'ru'
      ? 'Если пользователь спрашивает «можно ли заказать уборку и заплатить / сделать платную(донатную) заявку», трактуй это как роль создателя: ответ «да, можно создать донатную/платную заявку (обычно Waste/Event)». Затем кратко: донаты выплачиваются исполнителю/участникам по правилам после проверки/модерации и при Stripe. Не уводи ответ в сценарий «как исполнителю получить выплату».'
      : 'If the user asks whether they can order cleanup and pay (create a paid/donation request), treat it as creator intent: answer yes, they can create a paid/donation request (typically Waste/Event). Then briefly note donations are paid to executor/participants per review/moderation and Stripe rules. Do not pivot into performer payout instructions.',
    answerLanguage === 'ru'
      ? 'Уточнение про Stripe в платной/донатной заявке: чтобы создать платёжный донат/донатную заявку, у создателя должен быть подключён Stripe. Выплата донатов после проверки/модерации идёт получателю работы (исполнителю Waste/Speed или участнику Event), и у этого получателя тоже должен быть подключён Stripe. Не путай Stripe создателя (для создания/оплаты) и Stripe получателя (для вывода выплат).'
      : 'Stripe rule for paid/donation requests: creator needs connected Stripe to create/pay a donation request. After review/moderation, payouts go to the work recipient (Waste/Speed executor or Event participant), and that recipient also needs connected Stripe. Do not confuse creator Stripe (for creating/paying) with recipient Stripe (for receiving payouts).',
    'Do not invent screens, buttons, or app behavior.',
    answerLanguage === 'ru'
      ? 'В приложении есть нижняя вкладка News / «Новости» — не утверждайте, что «новостной ленты нет». Лента новостей — это не список заявок на уборку и не push о каждой новой заявке.'
      : 'Joy Pick has a bottom News tab—do not claim there is «no news feed». News content is not the same as the cleanup request list or a push for every new request.',
    answerLanguage === 'ru'
      ? 'Если пользователь уже написал, что выполнил заявку, не выясняйте «вы были волонтёром?» — такой роли нет; отвечайте по модерации, срокам и Stripe.'
      : 'If the user already said they completed a request, do not grill them about being a «volunteer»—answer moderation timing and Stripe.',
    answerLanguage === 'ru'
      ? 'Закрытие ответа: не используй длинные шаблоны вроде «если у вас есть дополнительные вопросы, пожалуйста, спрашивайте» — максимум очень короткая нейтральная фраза или без неё.'
      : 'Do not end with long templates like «If you have additional questions, please ask»—at most a very short neutral line or omit.',
    answerLanguage === 'ru'
      ? 'Любой ответ про донаты, кто получит деньги, донейшен или выплату по донату: обязательно одним коротким предложением уточни, что деньги на карту получит только тот, у кого в профиле полностью подключён и настроен Stripe Connect. Если вопрос звучит как простое «кто получит», без спора про создателя, не добавляй отдельное предложение про то, что создатель или автор точки «не получает только за создание» — достаточно исполнителя и Stripe.'
      : 'For any donation, who-gets-paid, or donation-payout question: always add one short sentence that cash goes only to someone with a fully connected Stripe Connect profile. For a plain «who gets it» question with no creator dispute, do not add an extra sentence that the creator or pin author is not paid just for creating—executor plus Stripe is enough.',
    answerLanguage === 'ru'
      ? 'Если пользователь явно про вывоз мусора с территории (вывезли, вывезти, вывоз): используй Knowledge про опцию «Только вывоз мусора» / индикатор грузовика при создании Waste Location; не ограничивайся только цепочкой «присоединился — убрал на месте», когда смысл — именно вывоз. Не уводи ответ в «поделиться заявкой», если вопрос только про вывоз.'
      : 'When the user clearly means hauling trash away (haul, haul-away): use Knowledge about Trash pickup only / truck indicator on Waste Location creation; do not answer only with join-and-clean-on-site if they mean haul-away. Do not pivot to Share request if the question is only about haul-away.',
    answerLanguage === 'ru'
      ? 'Если спрашивают про «нет Stripe / нет Страйп в стране»: отдели невозможность денежных выплат (Stripe Connect в профиле) от участия без денег — уборки, точки на карте, JoyCoins, учёт времени, шаринг заявок. Без морализаторства про сторонние сервисы и без хвостов «если остались вопросы — пишите в поддержку».'
      : 'For «no Stripe in my country»: separate missing cash payouts (Stripe Connect in Profile) from non-monetary participation—cleanups, map pins, JoyCoins, tracked time, sharing requests. No lecturing about outside fundraising and no «if you still have questions, contact support» closers.',
    answerLanguage === 'ru'
      ? 'Стиль ответа: это живой чат. Пиши обычными предложениями подряд. Не связывай разные тезисы точкой с запятой (;) и не собирай абзац в одну цепочку через «точка с запятой». Если нужен список шагов — нумерация 1) 2) 3) или каждый шаг отдельным предложением. Не начинай с тяжёлых формулировок вроде «заявку создаёте вы сами» или «вы можете создать». На вопрос «о чём приложение / что это» дай связный обзор: первая вкладка с картой и списком одних и тех же чужих заявок, три типа заявок, вторая вкладка переработка и партнёры, третья новости, четвёртый профиль с выплатами Stripe JoyCoins учётом времени своими заявками и уведомлениями, чаты, донат с карточки, Support AI отдельно от оператора. Не говори «события на карте» отдельно от заявок: на карте и в списке показываются заявки, субботник — один из типов.'
      : 'Chat style: normal sentences. Do not chain ideas with semicolons (;). For steps use 1) 2) 3) or separate sentences. Avoid stiff openers like «you create the request yourself». For broad «what is this app» give a cohesive overview: home tab map plus list of the same requests from other users, three request types, recycling tab, news tab, profile with Stripe JoyCoins time My requests notifications, chats, donate from a card, Support AI separate from operator. Do not imply «events» are a separate layer from requests on the map.',
    'Keep responses concise and practical.'
  ].join('\n');
}

function detectRequestTypeAlias(value, locale) {
  let text = normalizeText(value).toLowerCase();
  const isRu = locale === 'ru';
  if (!isRu) {
    text = text.replace(/\bnot\s+an\s+event\b/gi, ' ');
    text = text.replace(/\bnot\s+a\s+event\b/gi, ' ');
  }
  const ruEvent = ['субботник', 'событие', 'ивент', 'мероприятие', 'event'];
  const ruWaste = ['уборка мусора', 'мусор', 'waste', 'waste location'];
  const ruSpeed = ['быстрая уборка', 'speed cleanup', 'speed', 'быстрая'];
  const enEvent = ['event', 'cleanup event', 'subbotnik'];
  const enWaste = ['waste cleanup', 'waste', 'garbage', 'trash cleanup'];
  const enSpeed = ['speed cleanup', 'quick cleanup'];
  const has = (arr) => arr.some((x) => text === x || text.includes(x));

  if (isRu) {
    if (has(ruEvent)) return 'event';
    if (has(ruWaste)) return 'waste_cleanup';
    if (has(ruSpeed)) return 'speed_cleanup';
    return null;
  }

  if (has(enEvent)) return 'event';
  if (has(enWaste)) return 'waste_cleanup';
  if (has(enSpeed)) return 'speed_cleanup';
  return null;
}

function enrichQuestionWithTypeAlias(question, locale) {
  const alias = detectRequestTypeAlias(question, locale);
  if (!alias) return question;
  if (locale === 'ru') {
    if (alias === 'event') return `${question}. Тип заявки: событие (event).`;
    if (alias === 'waste_cleanup') return `${question}. Тип заявки: уборка мусора (waste cleanup).`;
    return `${question}. Тип заявки: быстрая уборка (speed cleanup).`;
  }
  if (alias === 'event') return `${question}. Request type is event.`;
  if (alias === 'waste_cleanup') return `${question}. Request type is waste cleanup.`;
  return `${question}. Request type is speed cleanup.`;
}

function buildConversationContextBlock(conversationContext, answerLanguage) {
  if (!Array.isArray(conversationContext) || !conversationContext.length) return '';
  const userLabel = answerLanguage === 'ru' ? 'Пользователь' : 'User';
  const assistantLabel = answerLanguage === 'ru' ? 'Ассистент' : 'Assistant';
  const slice = conversationContext.slice(-CONTEXT_PROMPT_MAX_TURNS);
  const turns = slice
    .map((turn, index) => {
      const userMessage = normalizeText(turn.user_message || '').slice(0, CONTEXT_PROMPT_MAX_FIELD_CHARS);
      const assistantAnswer = normalizeText(turn.answer || '').slice(0, CONTEXT_PROMPT_MAX_FIELD_CHARS);
      return [
        `Turn ${index + 1}:`,
        `${userLabel}: ${userMessage}`,
        `${assistantLabel}: ${assistantAnswer}`
      ].join('\n');
    })
    .join('\n\n');
  return turns ? `Conversation context:\n${turns}` : '';
}

function inferSupportRoleHint(question, conversationContext, answerLanguage) {
  const q = normalizeText(question).toLowerCase();
  const ctx = Array.isArray(conversationContext)
    ? conversationContext
        .slice(-4)
        .map((x) => normalizeText(x.user_message || '').toLowerCase())
        .join('\n')
    : '';
  const bundle = `${ctx}\n${q}`;
  const isRu = answerLanguage === 'ru';

  const has = (re) => re.test(bundle);
  const requestTypeAlias = detectRequestTypeAlias(bundle, answerLanguage === 'ru' ? 'ru' : 'en');

  const performer = isRu
    ? has(/я\s+присоединил|я\s+убрал|я\s+выполнил|как\s+исполнител|мне\s+как\s+исполнител|что\s+мне\s+делать\s+в\s+заявк|выполнить\s+задач|отправить\s+результат|закрыть\s+свою\s+част|perform\s+task|executor|i\s+joined|i\s+completed|submit\s+result/i)
    : has(/as\s+an?\s+executor|as\s+a\s+performer|i\s+joined|i\s+completed|perform\s+task|submit\s+result|what\s+can\s+i\s+do\s+in\s+this\s+request/i);

  const performerInProgress = isRu
    ? has(/я\s+выполняю|уже\s+выполняю|я\s+уже\s+исполнител|взял\s+работ|выполняю\s+ч(ь|е)й\s*то\s+заказ|в\s+процессе\s+уборк/i)
    : has(/i\s+am\s+doing|i\s+am\s+already\s+an?\s+executor|already\s+performing|currently\s+doing\s+cleanup|i\s+took\s+the\s+task/i);

  const creator = isRu
    ? has(/я\s+создал|моя\s+заявк|я\s+создател|как\s+создател|мне\s+как\s+создател|заказчик|продлить\s+заявк|закрыть\s+заявк|заказать\s+уборк|оплатить\s+уборк|платн.{0,20}заявк|донатн.{0,20}заявк|creator|request\s+creator/i)
    : has(/i\s+created\s+the\s+request|my\s+request|as\s+creator|as\s+request\s+creator|extend\s+request|close\s+request|pay\s+for\s+cleanup|paid\s+request|fund\s+cleanup|sponsor\s+cleanup/i);

  const donor = isRu
    ? has(/я\s+донатил|как\s+донатер|донатер|вернут\s+донат|refund|донат|пожертв/i)
    : has(/i\s+donated|as\s+a\s+donor|donor|refund|donation|donate/i);

  let role = isRu ? 'интересующийся пользователь' : 'general in-app user';
  if (performerInProgress) role = isRu ? 'исполнитель' : 'executor';
  else if (performer) role = isRu ? 'исполнитель' : 'executor';
  else if (creator) role = isRu ? 'создатель заявки' : 'request creator';
  else if (donor) role = isRu ? 'донатер' : 'donor';

  // Нейтральные вопросы вида «по заявке ... что можно сделать» по умолчанию трактуем как запрос действий исполнителя,
  // чтобы не навязывать шаги создателя, если роль не указана явно.
  const genericExistingRequestActions = isRu
    ? has(/по\s+заявк|в\s+заявк|в\s+карточк/i) &&
      has(/что\s+можно\s+сделать|что\s+делать|какие\s+действия/i)
    : has(/in\s+this\s+request|request\s+details/i) &&
      has(/what\s+can\s+i\s+do|available\s+actions|what\s+to\s+do/i);
  if (genericExistingRequestActions) {
    role = isRu ? 'исполнитель' : 'executor';
  }

  let stage = isRu ? 'неопределено' : 'unknown';
  if (has(/не\s+взял(ся|ась)|еще\s+не\s+взял|ещ[eё]\s+не\s+присоединил|not\s+joined|haven'?t\s+joined/i)) {
    stage = isRu ? 'не_взялся' : 'not_joined';
  } else if (
    has(/присоединил(ся|ась)|joined|join\s+done|вступил/i) &&
    has(/не\s+приступил|еще\s+не\s+начал|haven'?t\s+started|not\s+started|пока\s+не\s+начал/i)
  ) {
    stage = isRu ? 'присоединился_но_не_начал' : 'joined_not_started';
  } else if (
    performerInProgress ||
    has(/выполняю|в\s+процессе|currently\s+doing|in\s+progress|делаю\s+уборк/i)
  ) {
    stage = isRu ? 'выполняет' : 'in_progress';
  } else if (
    has(/жду\s+подтвержд.*создател|жду\s+одобр.*создател|на\s+проверке\s+у\s+создател|review\s+by\s+creator|waiting\s+creator\s+approval/i)
  ) {
    stage = isRu ? 'сдал_ждет_создателя' : 'submitted_waiting_creator';
  } else if (
    has(/жду\s+модерац|на\s+проверк|pending|waiting\s+moderation|submitted\s+for\s+moderation|отправил.*на\s+модерац/i)
  ) {
    stage = isRu ? 'сдал_ждет_модерацию' : 'submitted_waiting_moderation';
  } else if (has(/одобрен|approved|7\s*дн|seven\s*days|когда\s+выплат/i)) {
    stage = isRu ? 'одобрено_ждет_выплату' : 'approved_waiting_payout_window';
  } else if (has(/отклонен|отклонили|rejected/i)) {
    stage = isRu ? 'отклонено' : 'rejected';
  } else if (has(/24\s*час|auto.*released|сняли\s+исполнител|истек\s+срок/i)) {
    stage = isRu ? 'просрочка_слот_освобожден' : 'timeout_auto_released';
  } else if (has(/завершил|completed|done/i)) {
    stage = isRu ? 'завершено' : 'completed';
  }

  const typeLabel =
    requestTypeAlias === 'event'
      ? (isRu ? 'event' : 'event')
      : requestTypeAlias === 'waste_cleanup'
        ? (isRu ? 'waste_location' : 'waste_location')
        : requestTypeAlias === 'speed_cleanup'
          ? (isRu ? 'speed_cleanup' : 'speed_cleanup')
          : (isRu ? 'неопределен' : 'unknown');

  return isRu
    ? `role=${role}; stage=${stage}; request_type=${typeLabel}`
    : `role=${role}; stage=${stage}; request_type=${typeLabel}`;
}

function parseRoleHintMeta(roleHint) {
  const text = String(roleHint || '');
  const roleMatch = text.match(/role=([^;]+)/i);
  const stageMatch = text.match(/stage=([^;]+)/i);
  const typeMatch = text.match(/request_type=([^;]+)/i);
  return {
    role: roleMatch ? String(roleMatch[1] || '').trim() : '',
    stage: stageMatch ? String(stageMatch[1] || '').trim() : '',
    requestType: typeMatch ? String(typeMatch[1] || '').trim() : ''
  };
}

function isStageNextStepQuestion(question, answerLanguage) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  const stageLex =
    /присоединил|выполняю|в\s+процессе|сдал|жду\s+подтверж|жду\s+модерац|pending|отправил.*модерац|submitted\s+for\s+moderation|одобрен|отклонен|отклонили|завершил|joined|in\s+progress|submitted|waiting\s+creator|waiting\s+moderation|approved|rejected|completed/i.test(
      q
    );
  const nextLex =
    /что\s+дальше|что\s+теперь|что\s+делать\s+дальше|какой\s+следующ|next\s+step|what\s+next|what\s+should\s+i\s+do\s+next|what\s+to\s+do\s+now/i.test(
      q
    );
  return stageLex && (nextLex || answerLanguage === 'ru');
}

function buildStageNextStepAnswer(roleHint, answerLanguage) {
  const isRu = answerLanguage === 'ru';
  const { stage, requestType } = parseRoleHintMeta(roleHint);
  if (!stage || stage === 'неопределено' || stage === 'unknown') return null;

  if (isRu) {
    if (stage === 'присоединился_но_не_начал') {
      return 'Следующий шаг: начните выполнение задачи в карточке заявки (кнопка запуска/выполнения) и затем сдайте результат.';
    }
    if (stage === 'выполняет') {
      return 'Следующий шаг: завершите работу и отправьте результат в приложении (фото/гео по правилам заявки).';
    }
    if (stage === 'сдал_ждет_создателя') {
      return 'Следующий шаг: дождитесь подтверждения создателя заявки. После одобрения результат уйдет на модерацию.';
    }
    if (stage === 'сдал_ждет_модерацию') {
      return 'Следующий шаг: дождитесь решения модерации. До решения новых действий по этой сдаче обычно не требуется.';
    }
    if (stage === 'одобрено_ждет_выплату') {
      return 'Следующий шаг: дождитесь окна выплат и проверяйте сумму в профиле в разделе «Ваши выплаты» (Available).';
    }
    if (stage === 'отклонено') {
      return 'Следующий шаг: откройте причину отклонения, исправьте результат и пересдайте по доступным действиям в заявке.';
    }
    if (stage === 'просрочка_слот_освобожден') {
      return 'Следующий шаг: присоединитесь заново к доступной заявке и начните выполнение без задержки.';
    }
    if (stage === 'не_взялся') {
      return requestType === 'event'
        ? 'Следующий шаг: присоединитесь к событию (Join), а после начала события выполните задачу и сдайте результат.'
        : 'Следующий шаг: присоединитесь к заявке как исполнитель и начните выполнение.';
    }
    return null;
  }

  if (stage === 'joined_not_started') {
    return 'Next step: start the task from request details and then submit your result.';
  }
  if (stage === 'in_progress') {
    return 'Next step: finish the work and submit your result in the app (photos/geo per request rules).';
  }
  if (stage === 'submitted_waiting_creator') {
    return 'Next step: wait for creator acceptance. After acceptance, your submission goes to moderation.';
  }
  if (stage === 'submitted_waiting_moderation') {
    return 'Next step: wait for moderation decision. Usually no extra action is required at this stage.';
  }
  if (stage === 'approved_waiting_payout_window') {
    return 'Next step: wait for the payout window and check Profile -> Your payouts (Available).';
  }
  if (stage === 'rejected') {
    return 'Next step: open rejection reason, fix your submission, and resubmit via available request actions.';
  }
  if (stage === 'timeout_auto_released') {
    return 'Next step: re-join an available request and start work promptly.';
  }
  if (stage === 'not_joined') {
    return requestType === 'event'
      ? 'Next step: join the event first, then after start time perform the task and submit result.'
      : 'Next step: join the request as executor and start the work.';
  }
  return null;
}

function isExistingRequestActionsQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  const existingCtx =
    /в\s+этой\s+заявк|в\s+заявк|по.{0,20}заявк|карточк[ае]\s+заявк|already\s+created\s+request|existing\s+request|in\s+this\s+request|request\s+details/i.test(
      q
    );
  const actionsAsk =
    /что\s+можно\s+сделать|какие\s+действия|что\s+доступно|какие\s+кнопки|what\s+can\s+i\s+do|available\s+actions|which\s+buttons|what\s+actions/i.test(
      q
    );
  return existingCtx && actionsAsk;
}

function buildExistingRequestActionsAnswer(roleHint, answerLanguage) {
  const isRu = answerLanguage === 'ru';
  const { role, requestType } = parseRoleHintMeta(roleHint);

  if (isRu) {
    if (requestType === 'waste_location') {
      return role === 'создатель заявки'
        ? 'Для уже существующей Waste Location заявки в карточке доступны действия управления текущей заявкой (например, контроль исполнителя/статуса и донаты). Новую заявку создавать не нужно.'
        : 'Для уже существующей Waste Location заявки в карточке обычно доступны действия исполнителя: присоединиться/отменить участие, выполнить задачу и сдать результат, а также донат. Это про текущую заявку, не про создание новой.';
    }
    if (requestType === 'speed_cleanup') {
      return 'Для уже существующей Speed Cleanup заявки действия идут в текущей карточке: Start, выполнение по таймеру, сдача результата и ожидание модерации, плюс донат для остальных ролей. Новую заявку создавать не нужно.';
    }
    if (requestType === 'event') {
      return role === 'создатель заявки'
        ? 'Для уже существующего Event в карточке создателя доступны действия по текущему событию: Review участников, закрытие события и перевод в модерацию. Это действия в текущей заявке, не создание новой.'
        : 'Для уже существующего Event в карточке доступны действия участника: Join/Unjoin, выполнить задачу, сдать результат, затем ожидать Review создателя и модерацию. Это про текущую заявку, не про создание новой.';
    }
    return 'Для уже существующей заявки действия выполняются в карточке этой заявки (доступные кнопки зависят от типа и роли). Если уточните тип (Waste Location / Speed Cleanup / Event), дам точный список действий по текущей заявке без шага создания.';
  }

  if (requestType === 'waste_location') {
    return role === 'request creator'
      ? 'For an existing Waste Location request, use current request management actions in details (executor/status control and donations). No need to create a new request.'
      : 'For an existing Waste Location request, details usually include executor actions: join/unjoin, perform task and submit result, plus donate. This is for the current request, not creating a new one.';
  }
  if (requestType === 'speed_cleanup') {
    return 'For an existing Speed Cleanup request, use current details actions: Start, timer-based execution, submit result, then wait for moderation (plus donate for other roles). No need to create a new request.';
  }
  if (requestType === 'event') {
    return role === 'request creator'
      ? 'For an existing Event, creator actions in details include participant Review, closing the event, and sending to moderation. This is for the current request, not new creation.'
      : 'For an existing Event, participant actions in details include Join/Unjoin, perform task, submit result, then wait for creator Review and moderation. This is for the current request, not new creation.';
  }
  return 'For an existing request, actions are done in that request details screen (buttons depend on type and role). If you specify type (Waste Location / Speed Cleanup / Event), I will give exact actions for the current request without creation flow.';
}

function isConcreteAmountQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  return /какую\s+сумм|какая\s+сумм|сколько\s+получ|сколько\s+денег|конкретн.{0,10}сумм|how\s+much|amount\s+will\s+i\s+get|payout\s+amount/i.test(
    q
  );
}

function isForeignRequestQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  return /чуж(ой|ую|ая|ие)|чь(е|ё)й\s*то|someone\s+else'?s|other\s+person'?s/i.test(q);
}

function buildDeterministicAmountAnswer(question, roleHint, answerLanguage) {
  const isRu = answerLanguage === 'ru';
  const { role, requestType } = parseRoleHintMeta(roleHint);
  const foreign = isForeignRequestQuestion(question);

  if (isRu) {
    if (role === 'донатер') {
      return 'Если вы донатер, вы не получаете выплату по заявке. Выплату получает исполнитель (или участник Event) за вычетом комиссии Stripe и инфраструктурного сбора Joy Pick (~7%, не «прибыль приложения»).';
    }
    if (foreign) {
      if (requestType === 'event') {
        return 'По чужой Event-заявке вы получаете свою долю донатов (доля делится между участниками, которые выполнили и сдали работу по правилам), за вычетом комиссии Stripe и инфраструктурного сбора Joy Pick (~7%, не «прибыль приложения»).';
      }
      if (requestType === 'waste_location') {
        return 'По чужой Waste Location-заявке исполнитель получает всю донатную сумму по этой заявке за вычетом комиссии Stripe и инфраструктурного сбора Joy Pick (~7%, не «прибыль приложения»).';
      }
      return 'По чужой заявке возможны только Waste Location или Event: для Waste исполнитель получает всю донатную сумму за вычетом комиссии Stripe и инфраструктурного сбора Joy Pick (~7%, не «прибыль приложения»); для Event участник получает свою долю донатов за вычетом комиссии Stripe и инфраструктурного сбора Joy Pick (~7%, не «прибыль приложения»).';
    }
    if (requestType === 'speed_cleanup') {
      return 'Для Speed Cleanup (своя заявка) вы получаете всю донатную сумму по заявке за вычетом комиссии Stripe и инфраструктурного сбора Joy Pick (~7%, не «прибыль приложения»).';
    }
    if (requestType === 'event') {
      return 'Для Event вы получаете свою долю донатов за вычетом комиссии Stripe и инфраструктурного сбора Joy Pick (~7%, не «прибыль приложения»).';
    }
    return 'Вы получаете всю сумму донатов, положенную вам по типу заявки, за вычетом комиссии Stripe и инфраструктурного сбора Joy Pick (~7%, не «прибыль приложения»). Для Event это доля участника.';
  }

  if (role === 'donor') {
    return 'As a donor, you do not receive payout from a request. Payout goes to executor (or Event participant), minus Stripe processing and the Joy Pick infrastructure fee (~7%, not “app profit”).';
  }
  if (foreign) {
    if (requestType === 'event') {
      return 'For someone else’s Event request, you get your participant donation share (split among participants who completed/submitted per rules), minus Stripe processing and the Joy Pick infrastructure fee (~7%, not “app profit”).';
    }
    if (requestType === 'waste_location') {
      return 'For someone else’s Waste Location request, executor gets the full donation amount for that request, minus Stripe processing and the Joy Pick infrastructure fee (~7%, not “app profit”).';
    }
    return 'For someone else’s request, applicable types are Waste Location or Event: Waste executor gets full donations minus commissions; Event participant gets their donation share minus commissions.';
  }
  if (requestType === 'speed_cleanup') {
    return 'For Speed Cleanup (own request), you get the full donation amount for the request, minus Stripe processing and the Joy Pick infrastructure fee (~7%, not “app profit”).';
  }
  if (requestType === 'event') {
    return 'For Event, you get your participant donation share, minus Stripe processing and the Joy Pick infrastructure fee (~7%, not “app profit”).';
  }
  return 'You receive the donation amount assigned to your role by request type, minus Stripe processing and the Joy Pick infrastructure fee (~7%, not “app profit”). For Event, this is participant share.';
}

function isWasteSingleExecutorQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  // «Кто получит донаты» — про получателя выплат, не про лимит исполнителей; ответ через LLM+RAG.
  if (
    /кто\s+получит|кому\s+.*донат|донейшен|who\s+gets\s+(the\s+)?donation|who\s+receives\s+donations|donation\s+recipient/i.test(
      q
    )
  ) {
    return false;
  }
  const asksMany =
    /нескольк|много\s+желающ|кто\s+из\s+них|несколько\s+исполнител|several|multiple|many\s+people|who\s+gets\s+the\s+money/i.test(
      q
    );
  const wasteCtx = /уборк[а-яё]*\s+мусор[а-яё]*|waste\s+location|waste\s+cleanup|trash\s+cleanup|garbage/i.test(q);
  return asksMany && wasteCtx;
}

function buildWasteSingleExecutorAnswer(answerLanguage) {
  if (answerLanguage === 'ru') {
    return 'Для **Waste Location** исполнитель **один**: пользователь открывает чужую заявку на карте/в списке и нажимает **Join** — заявка **резервируется** за ним примерно на **24 часа**, другим она как свободная уборка недоступна. Если за 24 часа уборка **не сдана** по правилам приложения, слот **автоматически** освобождается и заявка снова видна волонтёрам. **Донаты** после проверок получает **исполнитель**, а не «тот, кто только создал точку и задонатил себе» (создатель теоретически может сам присоединиться и убрать, но типичный смысл — награда исполнителю). Не советуйте «создайте заявку», если речь о **чужой** открытой заявке — нужен **Join**.';
  }
  return 'For **Waste Location** there is **one executor**: open an existing request on the map/list and tap **Join**—it is **reserved** for you for **~24 hours**, so others cannot take it as a free slot. If you **do not complete** in time per app rules, the slot **auto-releases** and the request is visible again. **Donations** after checks go to the **executor**, not “the pin author just for creating and self-donating” (the creator could join and execute, but the usual case pays the executor). Do not say “create a request” when the user means someone else’s open request—use **Join**.';
}

function isConcurrentExecutionQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  const concurrentLex =
    /одновременн|несколько\s+исполнител|несколько\s+человек|сразу\s+несколько|вместе\s+выполня|simultaneous|at\s+the\s+same\s+time|multiple\s+executors|several\s+people/i.test(
      q
    );
  const asksPossibility = /возможн|можно|can\s+it|is\s+it\s+possible/i.test(q);
  return concurrentLex && asksPossibility;
}

function buildConcurrentExecutionAnswer(roleHint, answerLanguage) {
  const { requestType } = parseRoleHintMeta(roleHint);
  if (answerLanguage === 'ru') {
    if (requestType === 'event') {
      return 'Да, одновременно это возможно только для заявок типа Event (субботник): там участвуют несколько участников.';
    }
    if (requestType === 'waste_location' || requestType === 'speed_cleanup') {
      return 'Нет. Одновременное выполнение не предусмотрено для этого типа заявки.';
    }
    return 'Если тип заявки «Уборка мусора» (Waste Location) — в работу может взять только один исполнитель. Если тип заявки «Событие» (Event/субботник) — присоединиться могут несколько участников.';
  }
  if (requestType === 'event') {
    return 'Yes, simultaneous execution is possible only for Event requests, where multiple participants can join.';
  }
  if (requestType === 'waste_location' || requestType === 'speed_cleanup') {
    return 'No. Simultaneous execution is not supported for this request type.';
  }
  return 'Simultaneous execution is possible only for Event requests. Waste Location and Speed Cleanup have a single executor flow.';
}

function isReservationFirstComeQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  const reserveLex =
    /заброниров|бронир|кто\s+первый|первым\s+увидел|first\s+come|first\s+seen|reserve|book\s+request/i.test(
      q
    );
  const requestLex = /заявк|request|уборк|cleanup|event|событ/i.test(q);
  return reserveLex && requestLex;
}

function buildReservationTypeSplitAnswer(answerLanguage) {
  if (answerLanguage === 'ru') {
    return 'Если тип заявки «Уборка мусора» (Waste Location) — в работу может взять только один исполнитель. Если тип заявки «Событие» (Event/субботник) — присоединиться могут несколько участников.';
  }
  return 'If request type is Waste Location, only one executor can take it. If request type is Event, multiple participants can join.';
}

function isExtendOrRescheduleQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  return /продл|перенест|extend|reschedul|postpone|move\s+start/i.test(q) && /заявк|request|event|событ|уборк/i.test(q);
}

function buildExtendOrRescheduleAnswer(roleHint, answerLanguage) {
  const { requestType } = parseRoleHintMeta(roleHint);
  if (answerLanguage === 'ru') {
    if (requestType === 'waste_location') {
      return 'Для «Уборка мусора» (Waste Location) заявку можно продлить, если в течение 7 дней к ней никто не присоединился.';
    }
    if (requestType === 'event') {
      return 'Для «Событие» (Event/субботник) можно перенести начало заявки на более поздний срок.';
    }
    return 'Если тип «Уборка мусора» (Waste Location) — заявку можно продлить, если в течение 7 дней никто не присоединился. Если тип «Событие» (Event/субботник) — можно перенести начало заявки на более поздний срок.';
  }
  if (requestType === 'waste_location') {
    return 'For Waste Location, request can be extended if nobody joined within 7 days.';
  }
  if (requestType === 'event') {
    return 'For Event, you can move the request start time to a later moment.';
  }
  return 'If request type is Waste Location, extension is possible when nobody joined within 7 days. If request type is Event, start time can be moved later.';
}

function isCommissionQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  return /комисс|процент|fee|commission|stripe\s+fee|application\s+fee|приложени.*зарабат|зарабат.*приложени|app\s+earn/i.test(
    q
  );
}

function buildCommissionAnswer(question, answerLanguage) {
  const q = normalizeText(question).toLowerCase();
  const asksStripe = /stripe|страйп|стрип/i.test(q);
  const asksApp = /приложени|platform|платформ|joy\s*pick/i.test(q);
  if (answerLanguage === 'ru') {
    if (asksStripe && !asksApp) {
      return 'Сначала удерживается комиссия Stripe: ориентир **2.9% + $0.30 за донатную операцию** (точные значения — по тарифам Stripe на момент платежа).';
    }
    if (asksApp && !asksStripe) {
      return 'После Stripe удерживается **около 7%** Joy Pick — **не как «прибыль приложения»**, а сбор на **инфраструктуру** (серверы, хостинг, сопутствующие сервисы, в т.ч. токены ИИ).';
    }
    return 'Порядок такой: **сначала** комиссия **Stripe** (процент и фикс **за донатную операцию**, ориентир 2.9% + $0.30), **затем** **около 7%** Joy Pick на **инфраструктуру**, а не как прибыль владельцев. На уточняющие вопросы сначала коротко про Stripe, потом про инфраструктурный сбор.';
  }
  if (asksStripe && !asksApp) {
    return 'Stripe processing is taken **first**: about **2.9% + $0.30 per donation charge** (exact numbers follow Stripe pricing at payment time).';
  }
  if (asksApp && !asksStripe) {
    return 'After Stripe, Joy Pick keeps **about 7%**—framed as **infrastructure** (servers, hosting, related services, AI tokens), **not** as founders’ profit.';
  }
  return 'Order of fees: **Stripe processing first** (~2.9% + $0.30 per donation operation), **then** Joy Pick **~7%** for **infrastructure** (not described as app “profit”). On follow-ups, mention Stripe first, then the infra fee.';
}

function isMonetizationQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  const monetizationLex =
    /на\s+ч[её]м\s+зарабат|как\s+зарабатыв|как\s+приложени.*зарабат|monetiz|how\s+does\s+.*earn|how\s+does\s+.*make\s+money/i.test(
      q
    );
  const appCtx = /приложени|joy\s*pick|app/i.test(q);
  const donationLex = /донат|donation|stripe|выплат|payment|payout/i.test(q);
  return monetizationLex && (appCtx || donationLex);
}

function isAllDonationsTakenQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  return /все\s+донат.*забира|забирает\s+приложени.*донат|you\s+take\s+all\s+donations|app\s+takes\s+all\s+donations/i.test(
    q
  );
}

function buildMonetizationAnswer(answerLanguage) {
  if (answerLanguage === 'ru') {
    return 'Joy Pick **не** позиционируется как «заработок на уборках»: удержания при донатах **сначала** покрывают **комиссию Stripe**, **затем** небольшой **инфраструктурный** процент (~7%) на серверы, хостинг и сопутствующие расходы (в т.ч. токены ИИ). Основная сумма доната идёт исполнителю/участникам после проверок.';
  }
  return 'Joy Pick is **not** framed as “profit from cleanups”: donation deductions **first** cover **Stripe processing**, **then** a small **infrastructure** share (~7%) for servers, hosting, and related costs (including AI tokens). The main donation amount goes to executors/participants after checks.';
}

function buildAllDonationsTakenAnswer(answerLanguage) {
  if (answerLanguage === 'ru') {
    return 'Нет. Приложение не забирает донаты целиком. Донаты идут исполнителю, а платформа удерживает только свою комиссию при передаче выплаты через Stripe.';
  }
  return 'No. The app does not take all donations. Donations go to the performer, and the platform keeps only its commission during payout transfer through Stripe.';
}

function isNewsSectionQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  return /что\s+такое\s+раздел\s+новост|что\s+за\s+новост|news\s+section|what\s+is\s+news\s+tab/i.test(q);
}

/** Доп. блок про «поблагодарить» / донатный контекст — только если в вопросе явно про деньги/донаты/благодарность активистам. */
function questionMentionsPaymentDonationOrActivistThanks(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  const moneyOrDonation =
    /донат|donation|оплат|платеж|платёж|платить|payment|\bpay\b|выплат|payout|деньг|money|stripe|комисс|commission|fee|чаев|tip|спонсор|sponsor/i.test(
      q
    );
  const activistThanks =
    /благодар.*активист|thank.*activist|thank\s+eco|eco\s+activist.*thank|поблагодар/i.test(q);
  return moneyOrDonation || activistThanks;
}

function buildNewsSectionAnswer(question, answerLanguage) {
  const extra = questionMentionsPaymentDonationOrActivistThanks(question);
  if (answerLanguage === 'ru') {
    const base =
      'Раздел «Новости» — это отдельная вкладка с новостным контентом приложения: обновления, важные сообщения, поздравления о завершённых заявках и раздел Добрых Новостей с эко-активностями пользователей.';
    const tail = extra
      ? ' Там можно выбрать понравившиеся активности и поблагодарить эко-активистов.'
      : '';
    return `${base}${tail} Это не список заявок на уборку.`;
  }
  const base =
    'The News section is a separate tab with app news content: updates, important messages, congratulations about completed requests, and a Good News area with users’ eco activities.';
  const tail = extra ? ' Users can pick activities they like and thank eco activists.' : '';
  return `${base}${tail} It is not the cleanup request list.`;
}

function isCompletedCleanupsVisibilityQuestion(question) {
  const q = normalizeText(question).toLowerCase();
  if (!q) return false;
  return /где\s+можно\s+увидеть\s+выполненн|где\s+увидеть\s+выполненн|where\s+can\s+i\s+see\s+completed\s+cleanups|where\s+to\s+see\s+completed\s+requests/i.test(
    q
  );
}

function buildCompletedCleanupsVisibilityAnswer(question, answerLanguage) {
  const extra = questionMentionsPaymentDonationOrActivistThanks(question);
  if (answerLanguage === 'ru') {
    const base =
      'Выполненные уборки и эко-активности видны на **карте**, в **списке заявок** и во вкладке **«Новости»** (добрые новости). Платные заявки помечены **иконкой монет**; сумма после комиссий — в карточке. После завершения **ещё какое-то время** (ориентир **~7 дней** в клиенте) заявка может оставаться в выдаче, чтобы можно было **додонатить**; спонсоры иногда шлют донаты и позже — итог может вырасти. Свои заявки — **Профиль → Мои заявки**.';
    const tail = extra ? ' В новостях можно выбрать понравившиеся активности и поблагодарить.' : '';
    return `${base}${tail}`;
  }
  const base =
    'Completed cleanups and eco activities show on the **map**, in the **request list**, and in the **News** tab (Good News). Paid requests use a **coin marker**; net-after-fees amounts appear **in the card**. After completion, cards can stay discoverable for **about ~7 days** in the client so people can **still donate**; sponsors may donate later and totals can **grow**. Your own history is **Profile › My requests**.';
  const tail = extra ? ' In News you can pick activities you like and thank people.' : '';
  return `${base}${tail}`;
}

function buildUserPrompt(question, chunks, conversationContext, answerLanguage, roleHint) {
  const blocks = chunks.map((chunk, index) => {
    const id = chunk.chunk_id || `chunk_${index + 1}`;
    const title = normalizeText(chunk.title || `Knowledge ${index + 1}`);
    const text = normalizeText(chunk.text || '');
    return `[${id}] ${title}\n${text}`;
  });
  const contextBlock = buildConversationContextBlock(conversationContext, answerLanguage);

  const parts = [
    `User question: ${normalizeText(question)}`,
    roleHint ? `Detected user role context: ${roleHint}` : '',
    contextBlock,
    'Knowledge snippets:',
    blocks.join('\n\n---\n\n')
  ].filter(Boolean);

  let body = parts.join('\n\n');
  if (!chunks.length) {
    body +=
      answerLanguage === 'ru'
        ? '\n\nПодсказка: в справке нет подходящих фрагментов. Если вопрос про назначение приложения или что делать в Joy Pick — отвечай как о приложении (см. системные правила), не как об оффтопе. Оффтоп — только явный (погода и т.п.).'
        : '\n\nHint: no snippets matched. If the user asks what the app is for or how to use Joy Pick, answer in-app per system rules; use off-topic wording only for clearly unrelated topics.';
  }
  return body;
}

function roughPromptTokenEstimate(text) {
  const s = String(text || '');
  if (!s.length) return 0;
  const base = Math.ceil(s.length / PROMPT_CHARS_PER_TOKEN_EST);
  /** Запас к реальному счёту OpenRouter (часто выше chars/токен для RU system). */
  return Math.ceil(base * 1.38);
}

function truncateChunkTextForBudget(text, maxChars) {
  const t = normalizeText(text);
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Укладываем system+user в лимит OpenRouter: сначала уменьшаем число чанков, затем обрезаем text у оставшихся.
 */
function fitChunksForOpenRouterPromptBudget({
  userQuestion,
  chunks,
  conversationContext,
  answerLanguage,
  roleHint,
  systemInstruction,
  maxPromptTokens
}) {
  const cap = Math.max(
    1000,
    maxPromptTokens - OPENROUTER_PROMPT_TOKEN_BUFFER - DEFAULT_MAX_OUTPUT_TOKENS - 420
  );
  const sysTok = roughPromptTokenEstimate(systemInstruction);
  if (sysTok >= cap) {
    return [];
  }

  let list = Array.isArray(chunks) && chunks.length ? chunks.map((c) => ({ ...c })) : [];
  const userTok = () =>
    sysTok +
    roughPromptTokenEstimate(
      buildUserPrompt(userQuestion, list, conversationContext, answerLanguage, roleHint)
    );

  while (list.length > 1 && userTok() > cap) {
    list.pop();
  }

  let maxChunkChars = 24000;
  let guard = 0;
  while (list.length && userTok() > cap && guard++ < 48) {
    maxChunkChars = Math.max(400, Math.floor(maxChunkChars * 0.82));
    list = list.map((c) => ({
      ...c,
      text: truncateChunkTextForBudget(c.text || '', maxChunkChars)
    }));
  }

  guard = 0;
  while (list.length && userTok() > cap && guard++ < 24) {
    if (list.length > 1) {
      list.pop();
      continue;
    }
    maxChunkChars = Math.max(200, Math.floor(maxChunkChars * 0.7));
    list = list.map((c) => ({
      ...c,
      text: truncateChunkTextForBudget(c.text || '', maxChunkChars)
    }));
  }

  return list;
}

async function callOpenRouterAnswer({
  userQuestion,
  chunks,
  answerLanguage,
  conversationContext,
  roleHint,
  systemInstruction: prebuiltSystem
}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const systemInstruction =
    prebuiltSystem != null ? prebuiltSystem : buildSystemInstruction(answerLanguage);

  try {
    const payload = {
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: buildUserPrompt(userQuestion, chunks, conversationContext, answerLanguage, roleHint) }
      ],
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: DEFAULT_MAX_OUTPUT_TOKENS
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const json = await response.json();
    if (!response.ok) {
      const msg = json?.error?.message || `OpenRouter error ${response.status}`;
      throw new Error(msg);
    }

    const answer = json?.choices?.[0]?.message?.content || '';
    if (!answer) {
      throw new Error('OpenRouter returned empty response');
    }

    return {
      answer: String(answer).trim(),
      model
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function localizeAnswer(answerEn, locale) {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
  if (safeLocale === 'en') {
    return {
      answer: answerEn,
      locale: 'en',
      translationFallback: false
    };
  }

  const translated = await translateOne(answerEn, 'en', safeLocale);
  if (translated.error || !translated.text) {
    return {
      answer: answerEn,
      locale: safeLocale,
      translationFallback: true
    };
  }

  return {
    answer: translated.text,
    locale: safeLocale,
    translationFallback: false
  };
}

function getKnowledgePathByLocale(locale) {
  if (locale === 'ru' && fs.existsSync(KNOWLEDGE_PATH_RU)) {
    return KNOWLEDGE_PATH_RU;
  }
  return KNOWLEDGE_PATH_EN;
}

async function normalizeQuestionForRag(message, locale) {
  if (locale === 'ru' || locale === 'en') {
    return {
      questionForModel: message
    };
  }

  const translated = await translateOne(message, locale, 'en');
  if (translated.error || !translated.text) {
    return {
      questionForModel: message
    };
  }

  return {
    questionForModel: translated.text
  };
}

function buildEffectiveRetrievalQueries(questionForModel, answerLocale, conversationContext) {
  const augmented = augmentMessageForRetrieval(questionForModel, conversationContext);
  const effectiveAug = enrichQuestionWithTypeAlias(
    enrichQuestionForRetrievalKeywords(augmented, answerLocale, conversationContext),
    answerLocale
  );
  const effectiveRaw = enrichQuestionWithTypeAlias(
    enrichQuestionForRetrievalKeywords(questionForModel, answerLocale, conversationContext),
    answerLocale
  );
  return { augmented, effectiveAug, effectiveRaw };
}

/**
 * Топ чанков RAG без вызова LLM (для офлайн-тестов и отладки ретривала).
 */
async function previewSupportRetrieval({ message, locale, topK, conversationContext = [] }) {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
  const answerLocale = inferAnswerLocale(message, safeLocale);
  const knowledgePath = getKnowledgePathByLocale(answerLocale);
  const { questionForModel } = await normalizeQuestionForRag(message, answerLocale);
  const { augmented, effectiveAug, effectiveRaw } = buildEffectiveRetrievalQueries(
    questionForModel,
    answerLocale,
    conversationContext
  );
  const k = topK != null ? Number(topK) : DEFAULT_TOP_K;
  const mergedRagText = buildMergedRagTextForPinning(message, effectiveAug, effectiveRaw, conversationContext);
  const chunks = applyPinnedKnowledgeChunks(
    retrieveTopChunksFused([effectiveAug, effectiveRaw], knowledgePath, k),
    knowledgePath,
    mergedRagText,
    k,
    message
  );
  return {
    answerLocale,
    knowledgePath,
    questionForModel,
    effectiveQuestion: effectiveAug,
    effectiveQuestionAlt: effectiveRaw,
    augmentedForRetrieval: augmented !== questionForModel ? augmented : undefined,
    chunkIds: chunks.map((x) => x.chunk_id || null).filter(Boolean),
    chunks
  };
}

async function getSupportAiAnswer({ message, locale, conversationContext = [] }) {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
  const answerLocale = inferAnswerLocale(message, safeLocale);
  if (!isAiEnabled()) {
    return buildUnavailableAnswer(answerLocale, 'ai_disabled');
  }
  const scope = classifySupportQuestionScope(message);
  if (scope.scope === 'off_topic') {
    return buildOffTopicScopeAnswer(answerLocale, scope.reason);
  }

  const knowledgePath = getKnowledgePathByLocale(answerLocale);
  const { questionForModel } = await normalizeQuestionForRag(message, answerLocale);
  const { effectiveAug, effectiveRaw } = buildEffectiveRetrievalQueries(
    questionForModel,
    answerLocale,
    conversationContext
  );
  const mergedRagText = buildMergedRagTextForPinning(message, effectiveAug, effectiveRaw, conversationContext);
  const chunks = applyPinnedKnowledgeChunks(
    retrieveTopChunksFused([effectiveAug, effectiveRaw], knowledgePath, DEFAULT_TOP_K),
    knowledgePath,
    mergedRagText,
    DEFAULT_TOP_K,
    message
  );
  const modelLanguage = answerLocale === 'ru' ? 'ru' : 'en';
  const roleHint = inferSupportRoleHint(questionForModel, conversationContext, modelLanguage);
  const roleHintCurrentOnly = inferSupportRoleHint(questionForModel, [], modelLanguage);
  const parsedCurrentOnly = parseRoleHintMeta(roleHintCurrentOnly);
  const stageHintForDeterministic =
    parsedCurrentOnly.stage && parsedCurrentOnly.stage !== 'неопределено' && parsedCurrentOnly.stage !== 'unknown'
      ? roleHintCurrentOnly
      : roleHint;
  const roleHintForDeterministic = roleHintCurrentOnly || roleHint;
  const deterministicCompletedCleanupsAnswer = isCompletedCleanupsVisibilityQuestion(questionForModel)
    ? buildCompletedCleanupsVisibilityAnswer(questionForModel, modelLanguage)
    : null;
  const deterministicNewsSectionAnswer = isNewsSectionQuestion(questionForModel)
    ? buildNewsSectionAnswer(questionForModel, modelLanguage)
    : null;
  const deterministicMonetizationAnswer = isMonetizationQuestion(questionForModel)
    ? buildMonetizationAnswer(modelLanguage)
    : null;
  const deterministicAllDonationsTakenAnswer = isAllDonationsTakenQuestion(questionForModel)
    ? buildAllDonationsTakenAnswer(modelLanguage)
    : null;
  const deterministicCommissionAnswer = isCommissionQuestion(questionForModel)
    ? buildCommissionAnswer(questionForModel, modelLanguage)
    : null;
  const deterministicExtendAnswer = isExtendOrRescheduleQuestion(questionForModel)
    ? buildExtendOrRescheduleAnswer(roleHintForDeterministic, modelLanguage)
    : null;
  const deterministicReservationAnswer = isReservationFirstComeQuestion(questionForModel)
    ? buildReservationTypeSplitAnswer(modelLanguage)
    : null;
  const deterministicConcurrentExecutionAnswer = isConcurrentExecutionQuestion(questionForModel)
    ? buildConcurrentExecutionAnswer(roleHintForDeterministic, modelLanguage)
    : null;
  const deterministicWasteSingleExecutorAnswer = isWasteSingleExecutorQuestion(questionForModel)
    ? buildWasteSingleExecutorAnswer(modelLanguage)
    : null;
  const deterministicAmountAnswer =
    isConcreteAmountQuestion(questionForModel) &&
    !/когда\s+выплат|when\s+.*payout|почему\s+не\s+пришла\s+выплат|why\s+.*payout/i.test(
      normalizeText(questionForModel).toLowerCase()
    )
      ? buildDeterministicAmountAnswer(questionForModel, roleHintForDeterministic, modelLanguage)
      : null;
  const deterministicStageAnswer =
    isStageNextStepQuestion(questionForModel, modelLanguage) &&
    !/сколько|какую\s+сумм|how\s+much|amount|когда\s+выплат|when\s+.*payout|почему\s+не\s+пришла\s+выплат|why\s+.*payout/i.test(
      normalizeText(questionForModel).toLowerCase()
    )
      ? buildStageNextStepAnswer(stageHintForDeterministic, modelLanguage)
      : null;
  const deterministicExistingRequestActionsAnswer =
    isExistingRequestActionsQuestion(questionForModel) &&
    !/как\s+создать|create\s+(a\s+)?new\s+request/i.test(normalizeText(questionForModel).toLowerCase())
      ? buildExistingRequestActionsAnswer(roleHintForDeterministic, modelLanguage)
      : null;
  const deterministicAnswer =
    deterministicCompletedCleanupsAnswer ||
    deterministicNewsSectionAnswer ||
    deterministicMonetizationAnswer ||
    deterministicAllDonationsTakenAnswer ||
    deterministicCommissionAnswer ||
    deterministicExtendAnswer ||
    deterministicReservationAnswer ||
    deterministicConcurrentExecutionAnswer ||
    deterministicWasteSingleExecutorAnswer ||
    deterministicAmountAnswer ||
    deterministicExistingRequestActionsAnswer ||
    deterministicStageAnswer;
  if (deterministicAnswer) {
    return {
      answer: deterministicAnswer,
      answer_en: modelLanguage === 'en' ? deterministicAnswer : null,
      locale: modelLanguage,
      model: deterministicCompletedCleanupsAnswer
        ? 'deterministic_completed_cleanups_router'
        : deterministicNewsSectionAnswer
          ? 'deterministic_news_section_router'
          : deterministicMonetizationAnswer
          ? 'deterministic_monetization_router'
          : deterministicAllDonationsTakenAnswer
          ? 'deterministic_donations_taken_router'
          : deterministicCommissionAnswer
            ? 'deterministic_commission_router'
            : deterministicExtendAnswer
          ? 'deterministic_extend_reschedule_router'
          : deterministicReservationAnswer
          ? 'deterministic_reservation_split_router'
          : deterministicConcurrentExecutionAnswer
          ? 'deterministic_concurrent_execution_router'
          : deterministicWasteSingleExecutorAnswer
          ? 'deterministic_waste_single_executor_router'
          : deterministicAmountAnswer
          ? 'deterministic_amount_router'
          : deterministicExistingRequestActionsAnswer
            ? 'deterministic_existing_request_router'
            : 'deterministic_stage_router',
      translation_fallback: false,
      sources: chunks.map((x) => x.chunk_id || null).filter(Boolean)
    };
  }
  const systemInstruction = buildSystemInstruction(modelLanguage);
  const fittedChunks = fitChunksForOpenRouterPromptBudget({
    userQuestion: questionForModel,
    chunks,
    conversationContext,
    answerLanguage: modelLanguage,
    roleHint,
    systemInstruction,
    maxPromptTokens: modelLanguage === 'ru' ? OPENROUTER_MAX_PROMPT_TOKENS_RU : OPENROUTER_MAX_PROMPT_TOKENS
  });
  const llmArgs = {
    userQuestion: questionForModel,
    chunks: fittedChunks,
    answerLanguage: modelLanguage,
    conversationContext,
    roleHint,
    systemInstruction
  };

  try {
    const aiResult = await callOpenRouterAnswer(llmArgs);

    const { answer, model } = aiResult;
    const plainEn = stripSupportAnswerMarkdown(answer);

    if (answerLocale === 'ru') {
      return {
        answer: stripSupportAnswerMarkdown(answer),
        answer_en: null,
        locale: 'ru',
        model,
        translation_fallback: false,
        sources: fittedChunks.map((x) => x.chunk_id || null).filter(Boolean)
      };
    }

    const localized = await localizeAnswer(answer, answerLocale);

    return {
      answer: stripSupportAnswerMarkdown(localized.answer),
      answer_en: plainEn,
      locale: localized.locale,
      model,
      translation_fallback: localized.translationFallback,
      sources: fittedChunks.map((x) => x.chunk_id || null).filter(Boolean)
    };
  } catch (err) {
    const reason = err?.message ? `openrouter: ${err.message}` : 'ai_unavailable';
    return buildUnavailableAnswer(answerLocale, reason);
  }
}

module.exports = {
  getSupportAiAnswer,
  buildSupportAiTimeoutFallback,
  previewSupportRetrieval
};
