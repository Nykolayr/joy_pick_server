const fs = require('fs');
const path = require('path');
const { SUPPORTED_LOCALES, translateOne } = require('./translateNews');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const DEFAULT_TOP_K = Number(process.env.AI_SUPPORT_TOP_K || 3);
// Держим таймаут заметно ниже клиентского (обычно 30s), чтобы вернуть fallback до обрыва запроса в приложении.
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_SUPPORT_TIMEOUT_MS || 12000);
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.AI_SUPPORT_MAX_OUTPUT_TOKENS || 400);
const DEFAULT_TEMPERATURE = Number(process.env.AI_SUPPORT_TEMPERATURE || 0.2);

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
  if (msg.includes('abort') || msg.includes('timed out') || msg.includes('timeout')) return 'AI_TIMEOUT';
  if (msg.includes('api key')) return 'AI_CONFIG_ERROR';
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
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
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
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
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

/** Подмешивает синонимы в строку поиска RAG (не в ответ пользователю), чтобы опечатки и «как …» не теряли тему. */
function enrichQuestionForRetrievalKeywords(question, locale) {
  const raw = normalizeText(question);
  if (!raw) return question;
  const t = raw.toLowerCase();
  const isRu = locale === 'ru';

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
      ? `${question} stripe connect онбординг в приложении профиль выплаты`
      : `${question} stripe connect profile onboarding in app payouts`;
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

function retrieveTopChunks(question, knowledgePath, topK = DEFAULT_TOP_K) {
  const chunks = loadKnowledgeChunks(knowledgePath);
  if (!chunks.length) {
    return [];
  }

  const questionTokens = tokenize(question);
  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: overlapScore(questionTokens, chunk)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));

  if (scored.length > 0) {
    return scored.map((x) => x.chunk);
  }

  // Нет пересечения с базой знаний — не подставляем случайные чанки (иначе модель опирается на нерелевантный текст).
  return [];
}

function buildSystemInstruction(answerLanguage) {
  const languageInstruction =
    answerLanguage === 'ru'
      ? 'Answer in Russian only.'
      : 'Answer in English only.';
  const inAppScopeRule =
    answerLanguage === 'ru'
      ? 'Считай вопрос про приложение, если спрашивают: зачем / для чего Joy Pick, что это за приложение, что делать в приложении, как пользоваться, с чего начать, какие есть функции, как создать заявку — это НЕ оффтоп. Для таких вопросов НИКОГДА не отвечай фразой «вопрос не относится к приложению».'
      : 'Treat as in-app if the user asks what Joy Pick is for, what the app does, what to do in the app, how to use it, how to get started, or what features exist — these are NEVER off-topic. Never reply with «not related to the app» for those.';
  const offTopicRule =
    answerLanguage === 'ru'
      ? 'Фразу «вопрос не относится к приложению Joy Pick» используй только для явного оффтопа: погода, политика, кино, случайная болтовня без связи с уборками/экологией/приложением. Один только «привет» без вопроса по приложению можно ответить коротко дружелюбно и спросить, чем помочь по Joy Pick.'
      : 'Say «not related to the Joy Pick app» only for clear off-topic: weather, politics, random chitchat unrelated to the app. A bare «hello» may get a short friendly reply and an offer to help with Joy Pick.';
  const inAppNoKnowledgeRule =
    answerLanguage === 'ru'
      ? 'Если вопрос про приложение, но в Knowledge нет деталей — ответь по общему назначению Joy Pick (эко-инициативы, карта, заявки, донаты, коины) в пределах известного, без выдуманных кнопок; при необходимости скажи, что точной инструкции в справочнике нет и можно написать в поддержку.'
      : 'If the question is in-scope but Knowledge lacks details, answer with high-level truthful info about Joy Pick (cleanups, map, requests, donations, coins) without inventing UI; say the help base may not cover specifics and support can help.';
  return [
    'You are Joy Pick support assistant.',
    languageInstruction,
    inAppScopeRule,
    offTopicRule,
    inAppNoKnowledgeRule,
    'For in-app questions, rely on the provided Knowledge snippets; do not contradict them.',
    'Do not use Markdown (no **bold**, no *italics*, no backticks). Plain text only so chat UI shows no asterisks.',
    'Ask for request type (waste vs speed vs event) ONLY when the user clearly wants to CREATE a new request but did not name a type.',
    'If the user asks what requests exist, what request types exist, or how to see/browse requests on the map/list, answer immediately: list the three types and say they appear on the main map/list—do NOT use the create-flow clarification question.',
    'If user already answered the clarifying question with a short synonym (for example: subbotnik, event, cleanup event), do not repeat the same clarifying question again.',
    'For money/refund/hold questions, follow Knowledge about donation holds and donor refunds; never replace it with vague «money stays on the platform» or «depends on policy» if Knowledge says otherwise.',
    'Joy Pick does not accumulate user funds as a platform balance: Knowledge describes hold via Stripe and direct distribution after approval (and equal split among Stripe-connected Event participants per Knowledge).',
    'When the user asks what map colors, donation chips, wallet/news buttons, or incomplete banners mean, use the Help/UI Guide chunks and suggest opening Help in the app for the illustrated reference.',
    'For «connect Stripe in profile», explain the in-app profile/payouts flow from Knowledge; do not refuse as if the user asked for external-only Stripe signup.',
    'On follow-up turns, answer the new question first; do not paste the entire previous reply again unless the user explicitly asks to repeat.',
    'Do not invent screens, buttons, or app behavior.',
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
  const ruEvent = ['субботник', 'событие', 'ивент', 'мероприятие'];
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
  const turns = conversationContext
    .map((turn, index) => {
      const userMessage = normalizeText(turn.user_message || '').slice(0, 600);
      const assistantAnswer = normalizeText(turn.answer || '').slice(0, 600);
      return [
        `Turn ${index + 1}:`,
        `${userLabel}: ${userMessage}`,
        `${assistantLabel}: ${assistantAnswer}`
      ].join('\n');
    })
    .join('\n\n');
  return turns ? `Conversation context:\n${turns}` : '';
}

function buildUserPrompt(question, chunks, conversationContext, answerLanguage) {
  const blocks = chunks.map((chunk, index) => {
    const id = chunk.chunk_id || `chunk_${index + 1}`;
    const title = normalizeText(chunk.title || `Knowledge ${index + 1}`);
    const text = normalizeText(chunk.text || '');
    return `[${id}] ${title}\n${text}`;
  });
  const contextBlock = buildConversationContextBlock(conversationContext, answerLanguage);

  const parts = [
    `User question: ${normalizeText(question)}`,
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

async function callGeminiAnswer({ userQuestion, chunks, answerLanguage, conversationContext }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const payload = {
      systemInstruction: {
        parts: [{ text: buildSystemInstruction(answerLanguage) }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: buildUserPrompt(userQuestion, chunks, conversationContext, answerLanguage) }]
        }
      ],
      generationConfig: {
        temperature: DEFAULT_TEMPERATURE,
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const json = await response.json();
    if (!response.ok) {
      const msg = json?.error?.message || `Gemini error ${response.status}`;
      throw new Error(msg);
    }

    const answer = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!answer) {
      throw new Error('Gemini returned empty response');
    }

    return {
      answer: answer.trim(),
      model
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenRouterAnswer({ userQuestion, chunks, answerLanguage, conversationContext }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const payload = {
      model,
      messages: [
        { role: 'system', content: buildSystemInstruction(answerLanguage) },
        { role: 'user', content: buildUserPrompt(userQuestion, chunks, conversationContext, answerLanguage) }
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

/**
 * Топ чанков RAG без вызова LLM (для офлайн-тестов и отладки ретривала).
 */
async function previewSupportRetrieval({ message, locale, topK }) {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
  const answerLocale = inferAnswerLocale(message, safeLocale);
  const knowledgePath = getKnowledgePathByLocale(answerLocale);
  const { questionForModel } = await normalizeQuestionForRag(message, answerLocale);
  const withKeywords = enrichQuestionForRetrievalKeywords(questionForModel, answerLocale);
  const effectiveQuestion = enrichQuestionWithTypeAlias(withKeywords, answerLocale);
  const k = topK != null ? Number(topK) : DEFAULT_TOP_K;
  const chunks = retrieveTopChunks(effectiveQuestion, knowledgePath, k);
  return {
    answerLocale,
    knowledgePath,
    questionForModel,
    effectiveQuestion,
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

  const knowledgePath = getKnowledgePathByLocale(answerLocale);
  const { questionForModel } = await normalizeQuestionForRag(message, answerLocale);
  const withKeywords = enrichQuestionForRetrievalKeywords(questionForModel, answerLocale);
  const effectiveQuestion = enrichQuestionWithTypeAlias(withKeywords, answerLocale);
  const chunks = retrieveTopChunks(effectiveQuestion, knowledgePath, DEFAULT_TOP_K);
  const modelLanguage = answerLocale === 'ru' ? 'ru' : 'en';
  let aiResult = null;
  let lastAiError = null;

  try {
    try {
      aiResult = await callGeminiAnswer({
        userQuestion: questionForModel,
        chunks,
        answerLanguage: modelLanguage,
        conversationContext
      });
    } catch (geminiErr) {
      lastAiError = geminiErr;
      aiResult = await callOpenRouterAnswer({
        userQuestion: questionForModel,
        chunks,
        answerLanguage: modelLanguage,
        conversationContext
      });
    }

    const { answer, model } = aiResult;
    const plainEn = stripSupportAnswerMarkdown(answer);

    if (answerLocale === 'ru') {
      return {
        answer: stripSupportAnswerMarkdown(answer),
        answer_en: null,
        locale: 'ru',
        model,
        translation_fallback: false,
        sources: chunks.map((x) => x.chunk_id || null).filter(Boolean)
      };
    }

    const localized = await localizeAnswer(answer, answerLocale);

    return {
      answer: stripSupportAnswerMarkdown(localized.answer),
      answer_en: plainEn,
      locale: localized.locale,
      model,
      translation_fallback: localized.translationFallback,
      sources: chunks.map((x) => x.chunk_id || null).filter(Boolean)
    };
  } catch (err) {
    const primaryError = (lastAiError && lastAiError.message) ? `gemini: ${lastAiError.message}` : '';
    const currentError = err?.message || 'ai_unavailable';
    const reason = primaryError ? `${primaryError}; openrouter: ${currentError}` : currentError;
    return buildUnavailableAnswer(answerLocale, reason);
  }
}

module.exports = {
  getSupportAiAnswer,
  buildSupportAiTimeoutFallback,
  previewSupportRetrieval
};
