const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');
const { isAiEnabled } = require('./openRouterVision');
const { normalizeLocale } = require('./integrityTranslate');

const DEFAULT_MODEL = process.env.INTEGRITY_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const TIMEOUT_MS = Math.min(25000, Math.max(5000, parseInt(process.env.INTEGRITY_TEXT_AI_TIMEOUT_MS || '15000', 10) || 15000));

function isTextAiEnabled() {
  if (process.env.INTEGRITY_TEXT_AI_ENABLED === '0' || process.env.INTEGRITY_TEXT_AI_ENABLED === 'false') {
    return false;
  }
  return isAiEnabled();
}

function aiIssue(code, field, phase, extra = {}) {
  const severity = phase === 'create' ? 'block' : 'reject';
  return {
    code,
    field,
    severity,
    source: 'ai',
    message_key: messageKeyForCode(code),
    message_en: messageEnForCode(code),
    ...extra,
  };
}

function buildPrompt({ name, description, locale, category }) {
  const loc = normalizeLocale(locale);
  const isRu = loc === 'ru';

  if (isRu) {
    return `Ты модератор заявок на уборку/волонтёрские задачи (категория: ${category}).
Оцени заголовок и описание на русском языке: это осмысленная заявка (место, задача для волонтёров) или бессмыслица/набор символов/спам?

Заголовок: ${JSON.stringify(name)}
Описание: ${JSON.stringify(description)}

Ответь ТОЛЬКО JSON без markdown:
{"ok":true}
или
{"ok":false,"fields":["name"],"fields":["description"] — какие поля плохие, можно оба}`;
  }

  return `You moderate cleanup/volunteer requests (category: ${category}).
User app locale: ${loc} (not Russian). The title and description may be in the user's language.
Step 1: mentally translate them to English if needed.
Step 2: decide if they describe a real outdoor cleanup / volunteer task (clear place or action), or are gibberish/random characters/spam.

Title: ${JSON.stringify(name)}
Description: ${JSON.stringify(description)}

Reply ONLY JSON, no markdown:
{"ok":true}
or
{"ok":false,"fields":["name"]} and/or "description"`;
}

function parseAiJson(raw) {
  const s = String(raw || '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<object[]>} integrity issues
 */
async function checkTextWithAi({ name, description, locale, category, phase }) {
  if (!isTextAiEnabled()) return [];

  const n = String(name || '').trim();
  const d = String(description || '').trim();
  if (!n && !d) return [];

  const apiKey = process.env.OPENROUTER_API_KEY;
  const prompt = buildPrompt({ name: n, description: d, locale, category });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 120,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await res.json();
    if (!res.ok) {
      console.warn('[textAiCheck] OpenRouter error:', json?.error?.message || res.status);
      return [];
    }
    const raw = json?.choices?.[0]?.message?.content;
    const parsed = parseAiJson(raw);
    if (!parsed || parsed.ok === true) return [];

    const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
    const issues = [];
    if (fields.includes('name')) {
      issues.push(aiIssue(REASON.GIBBERISH_NAME, 'name', phase));
    }
    if (fields.includes('description')) {
      issues.push(aiIssue(REASON.GIBBERISH_DESCRIPTION, 'description', phase));
    }
    if (issues.length === 0 && parsed.ok === false) {
      issues.push(aiIssue(REASON.GIBBERISH_DESCRIPTION, 'description', phase));
    }
    return issues;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[textAiCheck]', e.message);
    return [];
  }
}

module.exports = { isTextAiEnabled, checkTextWithAi };
