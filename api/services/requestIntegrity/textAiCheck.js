const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');
const { isAiEnabled } = require('./openRouterVision');
const { getOpenRouterVisionApiKey } = require('../../utils/openRouterVisionClient');
const { normalizeLocale } = require('./integrityTranslate');
const { postProcessTextAiIssues, aiIssue } = require('./textIntegrityPostProcess');

const DEFAULT_MODEL = process.env.INTEGRITY_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const TIMEOUT_MS = Math.min(20000, Math.max(4000, parseInt(process.env.INTEGRITY_TEXT_AI_TIMEOUT_MS || '8000', 10) || 8000));

function isTextAiEnabled() {
  if (process.env.INTEGRITY_TEXT_AI_ENABLED === '0' || process.env.INTEGRITY_TEXT_AI_ENABLED === 'false') {
    return false;
  }
  return isAiEnabled();
}

/** Один промпт для всех locale: текст как есть, язык указываем явно (ru, zh, en, …). */
function buildPrompt({ name, description, locale, category }) {
  const loc = normalizeLocale(locale);
  return `You moderate cleanup/volunteer requests in a mobile app.
Category: ${category}
User app locale: ${loc}

The title and description below are written by the user in their language (same as or related to locale ${loc}). Read them as-is — do NOT require English.

Decide: is this a genuine outdoor cleanup / volunteer task (clear place or action), or gibberish / random characters / spam / placeholder?

Important — payment / payout instructions:
- Users in countries without in-app Stripe may put donation or payout details in the DESCRIPTION only: phone numbers, Pix keys, bank accounts, cards, mobile money (M-Pesa, etc.), CPF, IBAN, emails used as payment keys, and similar.
- Do NOT reject a request just because the description contains payment details, digits, or account numbers.
- Reject only if there is NO genuine cleanup/volunteer task, or the text is gibberish/spam.
- Payment details must NOT be in the title. If the title contains phone/card/bank details, reject the title field only.
- If you reject, prefer field "description" over "name" when the title clearly names a place or cleanup task.

Title: ${JSON.stringify(name)}
Description: ${JSON.stringify(description)}

Reply ONLY valid JSON, no markdown:
{"ok":true}
or
{"ok":false,"fields":["name"]}
or
{"ok":false,"fields":["description"]}
or
{"ok":false,"fields":["name","description"]}`;
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

function rawAiIssuesFromParsed(parsed, phase, locale) {
  if (!parsed || parsed.ok === true) return [];

  const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
  const issues = [];
  if (fields.includes('name')) {
    issues.push(aiIssue(REASON.GIBBERISH_NAME, 'name', phase, locale));
  }
  if (fields.includes('description')) {
    issues.push(aiIssue(REASON.GIBBERISH_DESCRIPTION, 'description', phase, locale));
  }
  if (issues.length === 0 && parsed.ok === false) {
    issues.push(aiIssue(REASON.GIBBERISH_DESCRIPTION, 'description', phase, locale));
  }
  return issues;
}

/** @returns {Promise<Array|null>} issues, или null если AI недоступен — fallback на rules */
async function checkTextWithAi({
  name,
  description,
  locale,
  category,
  phase,
  nameGibberish = false,
  descriptionGibberish = false,
}) {
  if (!isTextAiEnabled()) return null;

  const n = String(name || '').trim();
  const d = String(description || '').trim();
  if (!n && !d) return [];

  const apiKey = getOpenRouterVisionApiKey();
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
      return null;
    }
    const raw = json?.choices?.[0]?.message?.content;
    const parsed = parseAiJson(raw);
    const rawIssues = rawAiIssuesFromParsed(parsed, phase, locale);

    return postProcessTextAiIssues({
      name: n,
      description: d,
      nameGibberish: Boolean(nameGibberish),
      descriptionGibberish: Boolean(descriptionGibberish),
      aiIssues: rawIssues,
      phase,
      locale,
    });
  } catch (e) {
    clearTimeout(timer);
    console.warn('[textAiCheck]', e.message);
    return null;
  }
}

module.exports = { isTextAiEnabled, checkTextWithAi, buildPrompt };
