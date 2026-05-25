const crypto = require('crypto');
const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');
const { classifyPhotoScene, isAiEnabled } = require('./openRouterVision');

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

async function checkPhotos({
  category,
  phase,
  photosBefore = [],
  photosAfter = [],
  photoFilesBefore = [],
  photoFilesAfter = [],
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

  if (phase === 'moderate') {
    if (cat === 'speedcleanup') {
      if (before.length === 0) {
        issues.push(issue(REASON.MISSING_PHOTOS_BEFORE, 'photos_before', 'reject', 'rules'));
      }
      if (after.length === 0) {
        issues.push(issue(REASON.MISSING_PHOTOS_AFTER, 'photos_after', 'reject', 'rules'));
      }
      if (sameUrlSet(before, after)) {
        issues.push(issue(REASON.PHOTOS_BEFORE_AFTER_SAME, 'photos_after', 'reject', 'rules'));
      }
    }
  }

  const samples = [];
  before.forEach((url, i) => {
    samples.push({ field: 'photos_before', url, filePath: photoFilesBefore[i], index: i });
  });
  after.forEach((url, i) => {
    samples.push({ field: 'photos_after', url, filePath: photoFilesAfter[i], index: i });
  });

  if (!isAiEnabled()) return issues;

  for (const sample of samples.slice(0, 4)) {
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

module.exports = { checkPhotos, sameUrlSet };
