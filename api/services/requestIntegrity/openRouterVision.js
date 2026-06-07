const {
  getOpenRouterVisionApiKey,
  isOpenRouterVisionConfigured,
  getVisionMaxEdge,
  resolveVisionSourceBuffer,
  resolveVisionImageDataUrl,
  sha256Buffer,
  localPathFromUploadUrl,
} = require('../../utils/openRouterVisionClient');
const { getCachedVerdict, setCachedVerdict } = require('./visionVerdictCache');

const DEFAULT_MODEL = process.env.INTEGRITY_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const TIMEOUT_MS = Math.min(20000, Math.max(5000, parseInt(process.env.INTEGRITY_AI_TIMEOUT_MS || '12000', 10) || 12000));
const VISION_MAX_EDGE = getVisionMaxEdge(
  process.env.INTEGRITY_VISION_MAX_EDGE || process.env.OPENROUTER_VISION_MAX_EDGE || '512'
);

function isAiEnabled() {
  if (process.env.INTEGRITY_AI_ENABLED === '0' || process.env.INTEGRITY_AI_ENABLED === 'false') {
    return false;
  }
  return isOpenRouterVisionConfigured();
}

function parseSceneVerdict(raw) {
  const text = String(raw || '')
    .trim()
    .toLowerCase();
  if (text.includes('indoor')) return { verdict: 'indoor', raw };
  if (text.includes('outdoor')) return { verdict: 'outdoor', raw };
  return { verdict: 'uncertain', raw };
}

/**
 * @returns {{ verdict: 'outdoor'|'indoor'|'uncertain'|'skip', raw?: string, cached?: boolean }}
 */
async function classifyPhotoScene({ imageUrl, filePath, category }) {
  if (!isAiEnabled()) return { verdict: 'skip' };

  const apiKey = getOpenRouterVisionApiKey();
  const model = DEFAULT_MODEL;
  let sourceBuffer;
  try {
    const local = filePath || (imageUrl ? localPathFromUploadUrl(imageUrl) : null);
    sourceBuffer = await resolveVisionSourceBuffer({
      imageUrl: local ? null : imageUrl,
      filePath: local,
    });
    if (!sourceBuffer) return { verdict: 'skip' };
  } catch {
    return { verdict: 'skip' };
  }

  const contentSha = sha256Buffer(sourceBuffer);
  const cached = getCachedVerdict('scene', model, contentSha);
  if (cached) return { ...cached, cached: true };

  let imagePart;
  try {
    const dataUrl = await resolveVisionImageDataUrl({
      sourceBuffer,
      maxEdge: VISION_MAX_EDGE,
    });
    if (!dataUrl) return { verdict: 'skip' };
    imagePart = { type: 'image_url', image_url: { url: dataUrl } };
  } catch {
    return { verdict: 'skip' };
  }

  const prompt = `You verify cleanup/event requests. Category: ${category}.
Look at the image. Reply with exactly one word: outdoor, indoor, or uncertain.
outdoor = street, park, trash outside, public place.
indoor = home interior, walls, ceiling, room without outdoor cleanup context.`;

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
        max_tokens: 16,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }, imagePart],
          },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await res.json();
    if (!res.ok) return { verdict: 'skip', raw: json?.error?.message };
    const result = parseSceneVerdict(json?.choices?.[0]?.message?.content);
    setCachedVerdict('scene', model, contentSha, result);
    return result;
  } catch (e) {
    clearTimeout(timer);
    return { verdict: 'skip', raw: e.message };
  }
}

module.exports = {
  isAiEnabled,
  classifyPhotoScene,
};
