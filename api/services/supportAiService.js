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

function tokenize(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((x) => x.length >= 2);
}

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
    if (titleSet.has(q)) score += 5;
    if (tagsSet.has(q)) score += 4;
    if (textSet.has(q)) score += 1;
  }
  return score;
}

function loadKnowledgeChunks(knowledgePath) {
  if (!fs.existsSync(knowledgePath)) {
    return [];
  }
  const raw = fs.readFileSync(knowledgePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x) => x && x.text);
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
    'If user asks about creating a request without specifying type, first ask a short clarifying question about request type (waste cleanup, speed cleanup, or event).',
    'If user already answered the clarifying question with a short synonym (for example: subbotnik, event, cleanup event), do not repeat the same clarifying question again.',
    'Do not invent screens, buttons, or app behavior.',
    'Keep responses concise and practical.'
  ].join('\n');
}

function detectRequestTypeAlias(value, locale) {
  const text = normalizeText(value).toLowerCase();
  const ruEvent = ['субботник', 'событие', 'ивент', 'мероприятие'];
  const ruWaste = ['уборка мусора', 'мусор', 'waste', 'waste location'];
  const ruSpeed = ['быстрая уборка', 'speed cleanup', 'speed', 'быстрая'];
  const enEvent = ['event', 'cleanup event', 'subbotnik'];
  const enWaste = ['waste cleanup', 'waste', 'garbage', 'trash cleanup'];
  const enSpeed = ['speed cleanup', 'quick cleanup'];
  const has = (arr) => arr.some((x) => text === x || text.includes(x));
  const isRu = locale === 'ru';

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

async function callGeminiAnswer({ question, chunks, answerLanguage, conversationContext }) {
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
          parts: [{ text: buildUserPrompt(question, chunks, conversationContext, answerLanguage) }]
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

async function callOpenRouterAnswer({ question, chunks, answerLanguage, conversationContext }) {
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
        { role: 'user', content: buildUserPrompt(question, chunks, conversationContext, answerLanguage) }
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

async function getSupportAiAnswer({ message, locale, conversationContext = [] }) {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
  const answerLocale = inferAnswerLocale(message, safeLocale);
  if (!isAiEnabled()) {
    return buildUnavailableAnswer(answerLocale, 'ai_disabled');
  }

  const knowledgePath = getKnowledgePathByLocale(answerLocale);
  const { questionForModel } = await normalizeQuestionForRag(message, answerLocale);
  const effectiveQuestion = enrichQuestionWithTypeAlias(questionForModel, answerLocale);
  const chunks = retrieveTopChunks(effectiveQuestion, knowledgePath, DEFAULT_TOP_K);
  const modelLanguage = answerLocale === 'ru' ? 'ru' : 'en';
  let aiResult = null;
  let lastAiError = null;

  try {
    try {
      aiResult = await callGeminiAnswer({
        question: effectiveQuestion,
        chunks,
        answerLanguage: modelLanguage,
        conversationContext
      });
    } catch (geminiErr) {
      lastAiError = geminiErr;
      aiResult = await callOpenRouterAnswer({
        question: effectiveQuestion,
        chunks,
        answerLanguage: modelLanguage,
        conversationContext
      });
    }

    const { answer, model } = aiResult;

    if (answerLocale === 'ru') {
      return {
        answer,
        answer_en: null,
        locale: 'ru',
        model,
        translation_fallback: false,
        sources: chunks.map((x) => x.chunk_id || null).filter(Boolean)
      };
    }

    const localized = await localizeAnswer(answer, answerLocale);

    return {
      answer: localized.answer,
      answer_en: answer,
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
  buildSupportAiTimeoutFallback
};
