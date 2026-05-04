const fs = require('fs');
const path = require('path');
const { SUPPORTED_LOCALES, translateOne } = require('./translateNews');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const DEFAULT_TOP_K = Number(process.env.AI_SUPPORT_TOP_K || 5);
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

/** Если Gemini в регионе недоступен, а OpenRouter есть — удобно для локального eval (`npm run support:eval:direct`). */
function isOpenRouterFirstEnabled() {
  const v = String(process.env.AI_SUPPORT_OPENROUTER_FIRST || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
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
      ? `${question} waste location уборка мусора создатель не исполнитель донаты волонтёр speed event субботник donations_who_receives`
      : `${question} waste location creator not performer volunteer donations speed cleanup event subbotnik donations_who_receives`;
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

function collectPinnedKnowledgeChunkIds(mergedRagText, currentMessage) {
  const ids = [];
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
  return ids;
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
      ? 'Считай вопрос про приложение, если спрашивают: зачем / для чего Joy Pick, что это за приложение, что делать в приложении, как пользоваться, с чего начать, какие есть функции, как создать заявку — это НЕ оффтоп. Для таких вопросов НИКОГДА не отвечай фразой «вопрос не относится к приложению». Слова «субботник», «субботнике», subbotnik — в Joy Pick это тип заявки Event (экран заявки в приложении), а не общая «районная уборка»; не подменяй шаги приложения советами «организаторам во дворе», если в Knowledge есть флоу Event.'
      : 'Treat as in-app if the user asks what Joy Pick is for, what the app does, what to do in the app, how to use it, how to get started, or what features exist — these are NEVER off-topic. Never reply with «not related to the app» for those. Words like subbotnik / «субботник» mean an Event-type in-app request (request details UI), not generic neighborhood cleanup advice—follow Knowledge Event flow; do not answer as if the user asked only a real-world community organizer.';
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
    answerLanguage === 'ru'
      ? 'Критично: для заявки «Уборка мусора» (Waste Location) автор только отмечает точку — он не получает донаты «за одно создание», если сам не был волонтёром-исполнителем. Донаты идут тем, кто пришёл и убрал. Быстрая уборка (Speed) — создатель = исполнитель своей уборки. Субботник/Event — организатор участвует; доли по Knowledge.'
      : 'Critical: for Waste Location (trash pin on map), the creator only reports the spot—they do not automatically receive donation payouts for «just creating» the request if they did not join and perform the cleanup. Donations go to executing volunteers. Speed Cleanup: creator is the performer of their own cleanup. Event/subbotnik: organizer participates; splits per Knowledge.',
    answerLanguage === 'ru'
      ? 'Если спрашивают «присоединился к уборке мусора и забыл / не пришёл»: по Knowledge — автоматическое снятие исполнителя после дедлайна с join (на сервере 24 часа), заявка снова new и снова в выдаче; создатель может снять исполнителя вручную; отдельно есть долгий сценарий 7+1 суток от created_at для зависшего inProgress. Не утверждайте, что «участие ни на что не влияет». Не предлагайте донат как замену физической уборки.'
      : 'If the user joined a Waste Location then forgot or did not show: per Knowledge/backend automation the executor slot is released after the join-based deadline (24 hours from join_date), request returns to new and becomes available again; creator may clear the executor manually; a separate long-stall path warns around 7 days from created_at. Do not claim joining «does not affect» the request. Never suggest donating instead of physically doing the cleanup.',
    'When the user asks what map colors, donation chips, wallet/news buttons, or incomplete banners mean, use the Help/UI Guide chunks and suggest opening Help in the app for the illustrated reference.',
    'For «connect Stripe in profile», explain the in-app profile/payouts flow from Knowledge; do not refuse as if the user asked for external-only Stripe signup.',
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

    const blockReason = json?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error(`Gemini prompt blocked: ${blockReason}`);
    }
    const cand = json?.candidates?.[0];
    if (!cand) {
      throw new Error('Gemini returned no candidates');
    }
    const fr = cand.finishReason;
    if (fr === 'SAFETY' || fr === 'RECITATION' || fr === 'BLOCKLIST') {
      throw new Error(`Gemini finish: ${fr}`);
    }
    const parts = cand?.content?.parts;
    let answer = '';
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (p && typeof p.text === 'string') answer += p.text;
      }
    }
    answer = answer.trim();
    if (!answer) {
      throw new Error(fr ? `Gemini empty (${fr})` : 'Gemini returned empty response');
    }

    return {
      answer,
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
  let aiResult = null;
  let lastAiError = null;
  const primaryProvider = isOpenRouterFirstEnabled() ? 'openrouter' : 'gemini';
  const fallbackProvider = isOpenRouterFirstEnabled() ? 'gemini' : 'openrouter';
  const llmArgs = {
    userQuestion: questionForModel,
    chunks,
    answerLanguage: modelLanguage,
    conversationContext
  };

  try {
    try {
      aiResult = isOpenRouterFirstEnabled()
        ? await callOpenRouterAnswer(llmArgs)
        : await callGeminiAnswer(llmArgs);
    } catch (primaryErr) {
      lastAiError = primaryErr;
      aiResult = isOpenRouterFirstEnabled()
        ? await callGeminiAnswer(llmArgs)
        : await callOpenRouterAnswer(llmArgs);
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
    const primaryError =
      lastAiError && lastAiError.message ? `${primaryProvider}: ${lastAiError.message}` : '';
    const currentError = err?.message || 'ai_unavailable';
    const reason = primaryError ? `${primaryError}; ${fallbackProvider}: ${currentError}` : currentError;
    return buildUnavailableAnswer(answerLocale, reason);
  }
}

module.exports = {
  getSupportAiAnswer,
  buildSupportAiTimeoutFallback,
  previewSupportRetrieval
};
