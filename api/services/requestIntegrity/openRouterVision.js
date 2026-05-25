const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = process.env.INTEGRITY_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const TIMEOUT_MS = Math.min(20000, Math.max(5000, parseInt(process.env.INTEGRITY_AI_TIMEOUT_MS || '12000', 10) || 12000));

function isAiEnabled() {
  if (process.env.INTEGRITY_AI_ENABLED === '0' || process.env.INTEGRITY_AI_ENABLED === 'false') {
    return false;
  }
  return Boolean(process.env.OPENROUTER_API_KEY);
}

async function fileToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const buf = await fs.promises.readFile(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * @returns {{ verdict: 'outdoor'|'indoor'|'uncertain'|'skip', raw?: string }}
 */
async function classifyPhotoScene({ imageUrl, filePath, category }) {
  if (!isAiEnabled()) return { verdict: 'skip' };

  const apiKey = process.env.OPENROUTER_API_KEY;
  let imagePart;
  try {
    if (filePath && fs.existsSync(filePath)) {
      imagePart = { type: 'image_url', image_url: { url: await fileToDataUrl(filePath) } };
    } else if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
      imagePart = { type: 'image_url', image_url: { url: imageUrl } };
    } else {
      return { verdict: 'skip' };
    }
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
        model: DEFAULT_MODEL,
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
    const raw = String(json?.choices?.[0]?.message?.content || '')
      .trim()
      .toLowerCase();
    if (raw.includes('indoor')) return { verdict: 'indoor', raw };
    if (raw.includes('outdoor')) return { verdict: 'outdoor', raw };
    return { verdict: 'uncertain', raw };
  } catch (e) {
    clearTimeout(timer);
    return { verdict: 'skip', raw: e.message };
  }
}

module.exports = {
  isAiEnabled,
  classifyPhotoScene,
};
