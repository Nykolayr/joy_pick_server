const {
  getOpenRouterVisionApiKey,
  isOpenRouterVisionConfigured,
  getVisionMaxEdge,
  resolveVisionSourceBuffer,
  resolveVisionImageDataUrl,
  sha256Buffer,
} = require('../utils/openRouterVisionClient');
const { getCachedVerdict, setCachedVerdict } = require('./requestIntegrity/visionVerdictCache');

const DEFAULT_MODEL = process.env.EARTHDAY_VISION_MODEL
  || process.env.INTEGRITY_OPENROUTER_MODEL
  || process.env.OPENROUTER_MODEL
  || 'openai/gpt-4o-mini';
const TIMEOUT_MS = Math.min(
  20000,
  Math.max(4000, parseInt(process.env.EARTHDAY_VISION_TIMEOUT_MS || '12000', 10) || 12000)
);
const VISION_MAX_EDGE = getVisionMaxEdge(
  process.env.EARTHDAY_VISION_MAX_EDGE || process.env.OPENROUTER_VISION_MAX_EDGE || '512'
);

function isEarthdayVisionEnabled() {
  if (process.env.EARTHDAY_VISION_FILTER === '0' || process.env.EARTHDAY_VISION_FILTER === 'false') {
    return false;
  }
  return isOpenRouterVisionConfigured();
}

function parseVisionJson(raw) {
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

function parseEarthdayVerdict(raw) {
  const parsed = parseVisionJson(raw);
  if (parsed && String(parsed.decision).toLowerCase() === 'accept') {
    return { verdict: 'accept', raw };
  }
  if (parsed && String(parsed.decision).toLowerCase() === 'reject') {
    return {
      verdict: 'reject',
      reason: parsed.reason ? String(parsed.reason) : 'rejected',
      raw,
    };
  }
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('"reject"') || lower.includes('reject')) {
    return { verdict: 'reject', reason: 'heuristic', raw };
  }
  if (lower.includes('"accept"') || lower.includes('accept')) {
    return { verdict: 'accept', raw };
  }
  return { verdict: 'uncertain', raw };
}

const VISION_PROMPT = `You pick cover photos for outdoor cleanup / volunteer events in a mobile app.

REJECT (decision reject) if the image is mainly:
- indoor room, museum, aquarium, zoo exhibit, taxidermy, diorama, display case
- close-up specimen, bird banding, ring on leg, lab, microscope, herbarium sheet
- portrait/selfie, food, document, map, satellite/orbit view, unrelated meme

ACCEPT (decision accept) if it works as an outdoor event cover:
- park, beach, shore, trail, forest, preserve, river/lake shore, landscape
- outdoor cleanup, litter/trash bags, volunteers outside, coastal area
- generic pleasant outdoor nature at the location (even without visible trash)

Reply ONLY valid JSON, no markdown:
{"decision":"accept"}
or
{"decision":"reject","reason":"short_code"}`;

/**
 * @returns {Promise<{ verdict: 'accept'|'reject'|'uncertain'|'skip', reason?: string, raw?: string, cached?: boolean }>}
 */
async function classifyEarthdayCoverImage({ imageUrl, filePath, imageBuffer }) {
  if (!isEarthdayVisionEnabled()) return { verdict: 'skip' };

  const apiKey = getOpenRouterVisionApiKey();
  const model = DEFAULT_MODEL;
  let sourceBuffer;
  try {
    sourceBuffer = await resolveVisionSourceBuffer({ imageUrl, filePath, imageBuffer });
    if (!sourceBuffer) return { verdict: 'skip' };
  } catch (e) {
    return { verdict: 'uncertain', raw: e.message };
  }

  const contentSha = sha256Buffer(sourceBuffer);
  const cached = getCachedVerdict('earthday', model, contentSha);
  if (cached) return { ...cached, cached: true };

  let imagePart;
  try {
    const dataUrl = await resolveVisionImageDataUrl({
      sourceBuffer,
      maxEdge: VISION_MAX_EDGE,
    });
    if (!dataUrl) return { verdict: 'skip' };
    imagePart = { type: 'image_url', image_url: { url: dataUrl } };
  } catch (e) {
    return { verdict: 'uncertain', raw: e.message };
  }

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
        model,
        max_tokens: 80,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: VISION_PROMPT }, imagePart],
          },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await res.json();
    if (!res.ok) {
      console.warn('[earthdayImageVision] OpenRouter error:', json?.error?.message || res.status);
      return { verdict: 'uncertain', raw: json?.error?.message };
    }
    const result = parseEarthdayVerdict(json?.choices?.[0]?.message?.content);
    setCachedVerdict('earthday', model, contentSha, result);
    return result;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[earthdayImageVision]', e.message);
    return { verdict: 'uncertain', raw: e.message };
  }
}

module.exports = {
  isEarthdayVisionEnabled,
  classifyEarthdayCoverImage,
};
