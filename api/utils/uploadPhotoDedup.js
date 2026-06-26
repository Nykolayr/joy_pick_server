const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INDEX_FILENAME = '_content_hash_index.json';

function isPhotoDedupEnabled() {
  const v = process.env.EARTHDAY_PHOTO_DEDUP;
  return v !== '0' && v !== 'false';
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function indexFilePath(photosDir) {
  return path.join(photosDir, INDEX_FILENAME);
}

function loadHashIndex(photosDir) {
  const indexPath = indexFilePath(photosDir);
  try {
    if (!fs.existsSync(indexPath)) return {};
    const raw = fs.readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveHashIndex(photosDir, index) {
  const indexPath = indexFilePath(photosDir);
  const tmpPath = `${indexPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(index));
  fs.renameSync(tmpPath, indexPath);
}

function findExistingFilenameByHash(photosDir, contentHash) {
  const index = loadHashIndex(photosDir);
  const filename = index[contentHash];
  if (!filename || typeof filename !== 'string') return null;

  const filePath = path.join(photosDir, filename);
  if (!fs.existsSync(filePath)) {
    delete index[contentHash];
    saveHashIndex(photosDir, index);
    return null;
  }
  return filename;
}

/**
 * Сохраняет JPEG в photosDir; при совпадении SHA256 возвращает уже существующий файл.
 * @returns {Promise<{ filename: string, deduplicated: boolean, contentHash: string }>}
 */
async function saveJpegPhotoWithContentDedup(photosDir, jpegBuf, generateFilename) {
  const contentHash = sha256Buffer(jpegBuf);

  if (isPhotoDedupEnabled()) {
    const existing = findExistingFilenameByHash(photosDir, contentHash);
    if (existing) {
      return { filename: existing, deduplicated: true, contentHash };
    }
  }

  const filename = generateFilename();
  const filePath = path.join(photosDir, filename);
  await fs.promises.writeFile(filePath, jpegBuf);

  if (isPhotoDedupEnabled()) {
    const index = loadHashIndex(photosDir);
    if (!index[contentHash]) {
      index[contentHash] = filename;
      saveHashIndex(photosDir, index);
    }
  }

  return { filename, deduplicated: false, contentHash };
}

module.exports = {
  INDEX_FILENAME,
  isPhotoDedupEnabled,
  sha256Buffer,
  findExistingFilenameByHash,
  saveJpegPhotoWithContentDedup,
};
