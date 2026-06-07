const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
/**
 * Ключ только для vision/integrity (Earth Day, фото заявок, text AI create).
 * Support AI использует OPENROUTER_API_KEY отдельно.
 */
function getOpenRouterVisionApiKey() {
  const vision = String(process.env.OPENROUTER_VISION_API_KEY || '').trim();
  if (vision) return vision;
  return String(process.env.OPENROUTER_API_KEY || '').trim();
}

function isOpenRouterVisionConfigured() {
  return Boolean(getOpenRouterVisionApiKey());
}

/** Длинная сторона JPEG для vision (токены ∝ площадь). 512 — компромисс цена/качество для сцен. */
function getVisionMaxEdge(envSpecificDefault) {
  const global = parseInt(process.env.OPENROUTER_VISION_MAX_EDGE, 10);
  if (Number.isFinite(global) && global >= 320) {
    return Math.min(1024, global);
  }
  const local = parseInt(envSpecificDefault, 10);
  const base = Number.isFinite(local) && local >= 320 ? local : 512;
  return Math.min(1024, Math.max(384, base));
}

function getVisionJpegQuality() {
  const q = parseInt(process.env.OPENROUTER_VISION_JPEG_QUALITY, 10);
  if (Number.isFinite(q)) return Math.min(90, Math.max(60, q));
  return 74;
}

async function bufferToVisionJpegDataUrl(inputBuf, maxEdge) {
  const edge = maxEdge || getVisionMaxEdge(512);
  const quality = getVisionJpegQuality();
  const jpeg = await sharp(inputBuf)
    .rotate()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

async function fileToVisionJpegDataUrl(filePath, maxEdge) {
  const buf = await fs.promises.readFile(filePath);
  return bufferToVisionJpegDataUrl(buf, maxEdge);
}

async function fetchImageBufferForVision(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'image/*,*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('empty image');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveVisionSourceBuffer({ imageUrl, filePath, imageBuffer }) {
  if (imageBuffer && Buffer.isBuffer(imageBuffer)) return imageBuffer;
  if (filePath && fs.existsSync(filePath)) return fs.promises.readFile(filePath);
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) return fetchImageBufferForVision(imageUrl);
  return null;
}

function sha256Buffer(buf) {
  if (!buf || !Buffer.isBuffer(buf) || !buf.length) return null;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Локальный файл, HTTP(S) или buffer → сжатый data URL для OpenRouter vision. */
async function resolveVisionImageDataUrl({ imageUrl, filePath, imageBuffer, maxEdge, sourceBuffer }) {
  const buf =
    sourceBuffer && Buffer.isBuffer(sourceBuffer)
      ? sourceBuffer
      : await resolveVisionSourceBuffer({ imageUrl, filePath, imageBuffer });
  if (!buf) return null;
  return bufferToVisionJpegDataUrl(buf, maxEdge);
}
function localPathFromUploadUrl(url, uploadsRoot) {
  const u = String(url || '');
  const m = u.match(/\/uploads\/(photos|general|avatars|logos)\/([^/?#]+)/i);
  if (!m) return null;
  const root = uploadsRoot || path.join(__dirname, '..', '..', 'uploads');
  const fp = path.join(root, m[1], decodeURIComponent(m[2]));
  return fs.existsSync(fp) ? fp : null;
}

module.exports = {
  getOpenRouterVisionApiKey,
  isOpenRouterVisionConfigured,
  getVisionMaxEdge,
  getVisionJpegQuality,
  bufferToVisionJpegDataUrl,
  fileToVisionJpegDataUrl,
  fetchImageBufferForVision,
  resolveVisionSourceBuffer,
  sha256Buffer,
  resolveVisionImageDataUrl,
  localPathFromUploadUrl,
};