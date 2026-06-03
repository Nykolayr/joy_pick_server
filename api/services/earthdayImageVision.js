const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DEFAULT_MODEL = process.env.EARTHDAY_VISION_MODEL
  || process.env.INTEGRITY_OPENROUTER_MODEL
  || process.env.OPENROUTER_MODEL
  || 'openai/gpt-4o-mini';
const TIMEOUT_MS = Math.min(
  20000,
  Math.max(4000, parseInt(process.env.EARTHDAY_VISION_TIMEOUT_MS || '12000', 10) || 12000)
);
const VISION_MAX_EDGE = Math.min(
  1024,
  Math.max(384, parseInt(process.env.EARTHDAY_VISION_MAX_EDGE || '640', 10) || 640)
);

function isEarthdayVisionEnabled() {
  if (process.env.EARTHDAY_VISION_FILTER === '0' || process.env.EARTHDAY_VISION_FILTER === 'false') {
    return false;
  }
  return Boolean(process.env.OPENROUTER_API_KEY);
}

async function bufferToJpegDataUrl(inputBuf) {
  const jpeg = await sharp(inputBuf)
    .rotate()
    .resize({ width: VISION_MAX_EDGE, height: VISION_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

async function fileToJpegDataUrl(filePath) {
  const buf = await fs.promises.readFile(filePath);
  return bufferToJpegDataUrl(buf);
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
 * @returns {Promise<{ verdict: 'accept'|'reject'|'uncertain'|'skip', reason?: string, raw?: string }>}
 */
async function classifyEarthdayCoverImage({ imageUrl, filePath, imageBuffer }) {
  if (!isEarthdayVisionEnabled()) return { verdict: 'skip' };

  const apiKey = process.env.OPENROUTER_API_KEY;
  let imagePart;

  try {
    if (imageBuffer && Buffer.isBuffer(imageBuffer)) {
      imagePart = {
        type: 'image_url',
        image_url: { url: await bufferToJpegDataUrl(imageBuffer) },
      };
    } else if (filePath && fs.existsSync(filePath)) {
      imagePart = {
        type: 'image_url',
        image_url: { url: await fileToJpegDataUrl(filePath) },
      };
    } else if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
      imagePart = { type: 'image_url', image_url: { url: imageUrl } };
    } else {
      return { verdict: 'skip' };
    }
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
        model: DEFAULT_MODEL,
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
    const raw = json?.choices?.[0]?.message?.content;
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
