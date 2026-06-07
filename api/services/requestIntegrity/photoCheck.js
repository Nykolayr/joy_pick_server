const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');
const { classifyPhotoScene, isAiEnabled } = require('./openRouterVision');

const UPLOADS_ROOT = path.join(__dirname, '../../../uploads');

function issue(code, field, severity, source, extra = {}) {
  return {
    code,
    field,
    severity,
    source,
    message_key: messageKeyForCode(code),
    message_en: messageEnForCode(code),
    ...extra,
  };
}

function urlKey(url) {
  try {
    const u = String(url || '').trim();
    return crypto.createHash('md5').update(u).digest('hex');
  } catch {
    return null;
  }
}

function sameUrlSet(a, b) {
  const ka = new Set((a || []).map(urlKey).filter(Boolean));
  const kb = new Set((b || []).map(urlKey).filter(Boolean));
  if (ka.size === 0 || kb.size === 0) return false;
  for (const k of ka) {
    if (kb.has(k)) return true;
  }
  return false;
}

function sha256FileAt(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/** URL вида …/uploads/photos/{file} → локальный файл на диске сервера. */
function localPathFromUploadUrl(url) {
  const u = String(url || '');
  const m = u.match(/\/uploads\/(photos|general|avatars|logos)\/([^/?#]+)/i);
  if (!m) return null;
  const fp = path.join(UPLOADS_ROOT, m[1], decodeURIComponent(m[2]));
  return fs.existsSync(fp) ? fp : null;
}

function contentHashForPhoto(url, filePath) {
  const fromUpload = sha256FileAt(filePath);
  if (fromUpload) return fromUpload;
  return sha256FileAt(localPathFromUploadUrl(url));
}

function collectContentHashes(urls, filePaths) {
  const hashes = new Set();
  const urlList = urls || [];
  const pathList = filePaths || [];
  for (let i = 0; i < urlList.length; i++) {
    const h = contentHashForPhoto(urlList[i], pathList[i]);
    if (h) hashes.add(h);
  }
  for (let i = urlList.length; i < pathList.length; i++) {
    const h = contentHashForPhoto(null, pathList[i]);
    if (h) hashes.add(h);
  }
  return hashes;
}

/** Один и тот же файл с разными URL (повторная загрузка) — по SHA-256 байтов. */
function samePhotoContent(urlsBefore, urlsAfter, pathsBefore, pathsAfter) {
  const hb = collectContentHashes(urlsBefore, pathsBefore);
  const ha = collectContentHashes(urlsAfter, pathsAfter);
  if (hb.size === 0 || ha.size === 0) return false;
  for (const h of hb) {
    if (ha.has(h)) return true;
  }
  return false;
}

function hasDuplicateBeforeAfterPhotos(before, after, pathsBefore, pathsAfter) {
  if (sameUrlSet(before, after)) return true;
  return samePhotoContent(before, after, pathsBefore, pathsAfter);
}

async function checkPhotos({
  category,
  phase,
  photosBefore = [],
  photosAfter = [],
  photoFilesBefore = [],
  photoFilesAfter = [],
  onlyAfterForUser = false,
}) {
  const issues = [];
  const cat = String(category || '').toLowerCase();
  const before = [...photosBefore];
  const after = [...photosAfter];

  if (cat === 'speedcleanup' && phase === 'create') {
    if (before.length === 0 && photoFilesBefore.length === 0) {
      issues.push(issue(REASON.MISSING_PHOTOS_BEFORE, 'photos_before', 'block', 'rules'));
    }
  }

  if (phase === 'close') {
    if (onlyAfterForUser) {
      if (after.length === 0 && photoFilesAfter.length === 0) {
        issues.push(issue(REASON.MISSING_PHOTOS_AFTER, 'photos_after', 'reject', 'rules'));
      }
    } else if (cat === 'wastelocation' || cat === 'speedcleanup') {
      if (after.length === 0 && photoFilesAfter.length === 0) {
        issues.push(issue(REASON.MISSING_PHOTOS_AFTER, 'photos_after', 'reject', 'rules'));
      }
      if (cat === 'speedcleanup') {
        if (before.length === 0 && photoFilesBefore.length === 0) {
          issues.push(issue(REASON.MISSING_PHOTOS_BEFORE, 'photos_before', 'reject', 'rules'));
        }
      }
      if (hasDuplicateBeforeAfterPhotos(before, after, photoFilesBefore, photoFilesAfter)) {
        issues.push(issue(REASON.PHOTOS_BEFORE_AFTER_SAME, 'photos_after', 'reject', 'rules'));
      }
    }
  }

  if (phase === 'moderate') {
    if (cat === 'speedcleanup' || cat === 'wastelocation') {
      if (cat === 'speedcleanup') {
        if (before.length === 0) {
          issues.push(issue(REASON.MISSING_PHOTOS_BEFORE, 'photos_before', 'reject', 'rules'));
        }
        if (after.length === 0) {
          issues.push(issue(REASON.MISSING_PHOTOS_AFTER, 'photos_after', 'reject', 'rules'));
        }
      }
      if (hasDuplicateBeforeAfterPhotos(before, after, photoFilesBefore, photoFilesAfter)) {
        issues.push(issue(REASON.PHOTOS_BEFORE_AFTER_SAME, 'photos_after', 'reject', 'rules'));
      }
    }
  }

  // Vision (OpenRouter) — только автомодерация на pending; create/close не блокируем по AI.
  if (phase !== 'moderate' || !isAiEnabled()) return issues;

  const visionSamples = [];
  after.forEach((url, i) => {
    visionSamples.push({ field: 'photos_after', url, filePath: photoFilesAfter[i], index: i });
  });
  if (!onlyAfterForUser) {
    before.forEach((url, i) => {
      visionSamples.push({ field: 'photos_before', url, filePath: photoFilesBefore[i], index: i });
    });
  }

  const maxVisionPhotos = Math.min(
    4,
    Math.max(1, parseInt(process.env.INTEGRITY_VISION_MAX_PHOTOS, 10) || 2)
  );

  for (const sample of visionSamples.slice(0, maxVisionPhotos)) {
    const verdict = await classifyPhotoScene({
      imageUrl: sample.url,
      filePath: sample.filePath,
      category,
    });
    if (verdict.verdict === 'indoor') {
      issues.push(
        issue(REASON.INDOOR_PHOTO, sample.field, phase === 'create' ? 'block' : 'reject', 'ai', {
          photo_index: sample.index,
        })
      );
      break;
    }
  }

  return issues;
}

module.exports = {
  checkPhotos,
  sameUrlSet,
  samePhotoContent,
  hasDuplicateBeforeAfterPhotos,
};
