const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const HALF_WIDTH = OG_WIDTH / 2;
const MAX_BYTES = 300 * 1024;

const PUBLIC_BASE_URL = (process.env.BASE_URL || process.env.APP_URL || 'https://joypick.world').replace(
  /\/+$/,
  ''
);

function uploadsRelativeFromUrl(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw, PUBLIC_BASE_URL);
    const pathname = u.pathname || '';
    const m = pathname.match(/^\/uploads\/(.+)$/i);
    if (m) return m[1].replace(/\\/g, '/');
  } catch {
    // not a URL
  }
  if (raw.startsWith('/uploads/')) return raw.slice('/uploads/'.length);
  if (raw.startsWith('uploads/')) return raw.slice('uploads/'.length);
  return null;
}

async function loadImageBuffer(photoUrl) {
  const rel = uploadsRelativeFromUrl(photoUrl);
  if (rel) {
    const disk = path.join(UPLOADS_ROOT, rel);
    if (fs.existsSync(disk)) {
      return fs.readFileSync(disk);
    }
  }
  const fetchUrl = /^https?:\/\//i.test(photoUrl) ? photoUrl : `${PUBLIC_BASE_URL}${photoUrl.startsWith('/') ? '' : '/'}${photoUrl}`;
  const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch image ${fetchUrl}: ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function resizeCover(buf, width, height) {
  return sharp(buf)
    .rotate()
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

async function encodeOgJpeg(leftBuf, rightBuf) {
  let quality = 82;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const jpeg = await sharp({
      create: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        channels: 3,
        background: { r: 18, g: 18, b: 18 },
      },
    })
      .composite([
        { input: leftBuf, left: 0, top: 0 },
        { input: rightBuf, left: HALF_WIDTH, top: 0 },
      ])
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (jpeg.length <= MAX_BYTES || quality <= 55) return jpeg;
    quality -= 5;
  }
  return sharp({
    create: {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      channels: 3,
      background: { r: 18, g: 18, b: 18 },
    },
  })
    .composite([
      { input: leftBuf, left: 0, top: 0 },
      { input: rightBuf, left: HALF_WIDTH, top: 0 },
    ])
    .jpeg({ quality: 55, mozjpeg: true })
    .toBuffer();
}

/**
 * @returns {{ diskPath: string, publicUrl: string, bytes: number }}
 */
async function generateSocialShareOgImage({ requestId, beforeUrl, afterUrl }) {
  if (!requestId || !beforeUrl || !afterUrl) {
    throw new Error('requestId, beforeUrl and afterUrl are required');
  }

  const [beforeRaw, afterRaw] = await Promise.all([
    loadImageBuffer(beforeUrl),
    loadImageBuffer(afterUrl),
  ]);

  const [leftBuf, rightBuf] = await Promise.all([
    resizeCover(beforeRaw, HALF_WIDTH, OG_HEIGHT),
    resizeCover(afterRaw, HALF_WIDTH, OG_HEIGHT),
  ]);

  const jpeg = await encodeOgJpeg(leftBuf, rightBuf);
  const dir = path.join(UPLOADS_ROOT, 'social', requestId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = 'og.jpg';
  const diskPath = path.join(dir, filename);
  fs.writeFileSync(diskPath, jpeg);

  const publicUrl = `${PUBLIC_BASE_URL}/uploads/social/${requestId}/${filename}`;
  return { diskPath, publicUrl, bytes: jpeg.length };
}

module.exports = {
  generateSocialShareOgImage,
  OG_WIDTH,
  OG_HEIGHT,
  MAX_BYTES,
  uploadsRelativeFromUrl,
};
