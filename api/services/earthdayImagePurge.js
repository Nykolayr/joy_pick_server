const fs = require('fs');
const path = require('path');

const uploadsRoot = path.join(__dirname, '..', '..', 'uploads');

/** Как в earthdayBulkCreateRequests: путь /uploads/... или абсолютный URL joypick. */
function toUploadPath(imageUrl) {
  if (typeof imageUrl !== 'string') return null;
  const s = imageUrl.trim();
  if (!s) return null;
  if (s.startsWith('/uploads/')) return s;
  try {
    const u = new URL(s);
    if (u.pathname && u.pathname.startsWith('/uploads/')) return u.pathname;
  } catch {
    return null;
  }
  return null;
}

function localFilePathFromUploadUrl(imageUrl) {
  const uploadPath = toUploadPath(imageUrl);
  if (!uploadPath) return null;
  const rel = uploadPath.replace(/^\/uploads\//, '').split('/').filter(Boolean);
  if (rel.length < 2) return null;
  const fp = path.join(uploadsRoot, ...rel);
  return fp;
}

async function isUploadReferencedByRequests(pool, imageUrl) {
  const uploadPath = toUploadPath(imageUrl);
  if (!uploadPath) return false;
  const filename = path.basename(uploadPath);
  if (!filename) return false;
  const like = `%${filename}%`;
  const [rows] = await pool.execute(
    `SELECT id FROM requests
     WHERE photos_before LIKE ? OR photos_after LIKE ?
     LIMIT 1`,
    [like, like]
  );
  return rows.length > 0;
}

/**
 * Удаляет плохую картинку из кэша Earth Day, галереи и с диска (если нет ссылок из requests).
 * @returns {Promise<{ purged: boolean, fileDeleted: boolean, reason?: string }>}
 */
async function purgeBadEarthdayImage(pool, imageUrl, options = {}) {
  const uploadPath = toUploadPath(imageUrl);
  if (!uploadPath) {
    return { purged: false, fileDeleted: false, reason: 'not_upload_path' };
  }

  const referenced = await isUploadReferencedByRequests(pool, uploadPath);
  let fileDeleted = false;
  const filePath = localFilePathFromUploadUrl(uploadPath);

  if (!referenced && filePath) {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        fileDeleted = true;
      }
    } catch (e) {
      console.warn('[earthdayImagePurge] unlink failed:', filePath, e.message);
    }
  }

  await pool.execute('DELETE FROM earthday_image_cache WHERE image_url = ?', [uploadPath]);
  await pool.execute(
    'DELETE FROM request_creation_gallery WHERE image_url = ? OR image_url LIKE ?',
    [uploadPath, `%${path.basename(uploadPath)}`]
  );

  const visionReason = options.visionReason ? String(options.visionReason) : null;
  if (visionReason) {
    console.info('[earthdayImagePurge] removed bad earthday image:', uploadPath, visionReason);
  }

  return {
    purged: true,
    fileDeleted,
    keptFileDueToRequestReference: referenced,
    reason: visionReason || options.reason || null,
  };
}

module.exports = {
  toUploadPath,
  localFilePathFromUploadUrl,
  isUploadReferencedByRequests,
  purgeBadEarthdayImage,
};
