const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { parseJsonFieldSafe } = require('../utils/requestPayloadParsers');
const { generateSocialShareOgImage } = require('../utils/socialShareOgImage');
const {
  applyShareTemplate,
  resolveShareLocale,
  normalizeShareLocale,
  uiCopy,
} = require('../utils/socialShareCopy');

const PUBLIC_BASE_URL = (process.env.BASE_URL || process.env.APP_URL || 'https://joypick.world').replace(
  /\/+$/,
  ''
);
const SOCIAL_UPLOADS_ROOT = path.join(__dirname, '../../uploads/social');

const ALLOWED_STATUSES = new Set(['pending', 'approved', 'completed']);
const COMPLETED_PART_STATUSES = new Set(['pending', 'approved']);

const CATEGORY_PATH = {
  wasteLocation: 'waste_location',
  speedCleanup: 'speed_cleanup',
  event: 'event',
};

function toAbsolutePhotoUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/uploads/')) return `${PUBLIC_BASE_URL}${raw}`;
  if (raw.startsWith('uploads/')) return `${PUBLIC_BASE_URL}/${raw}`;
  return raw;
}

function parsePhotoArray(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    return value
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => toAbsolutePhotoUrl(v))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsePhotoArray(parsed);
    } catch {
      return s
        .split(',')
        .map((v) => toAbsolutePhotoUrl(v))
        .filter(Boolean);
    }
  }
  return [];
}

function parseParticipantCompletions(raw) {
  const obj = parseJsonFieldSafe(raw, {});
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
}

function photosFromCompletionEntry(entry) {
  if (!entry || typeof entry !== 'object') return [];
  return parsePhotoArray(entry.photos_after || entry.photosAfter);
}

function participantSubmittedPart(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const status = String(entry.status || '').trim();
  if (!COMPLETED_PART_STATUSES.has(status)) return false;
  if (photosFromCompletionEntry(entry).length > 0) return true;
  if (entry.completed_at) return true;
  return false;
}

/** @returns {{ before: string|null, after: string|null }} */
function resolveSharePhotos(requestRow) {
  const photosBefore = parsePhotoArray(requestRow.photos_before);
  const photosAfter = parsePhotoArray(requestRow.photos_after);
  const merged = parsePhotoArray(requestRow.photos);

  let before = photosBefore[0] || merged[0] || null;
  let after = photosAfter[0] || null;

  if (!after) {
    const pcs = parseParticipantCompletions(requestRow.participant_completions);
    for (const entry of Object.values(pcs)) {
      const pa = photosFromCompletionEntry(entry);
      if (pa.length) {
        after = pa[0];
        break;
      }
    }
  }

  return { before, after };
}

function hasCompletionSharePhotos(requestRow) {
  const { before, after } = resolveSharePhotos(requestRow);
  return Boolean(before && after);
}

function buildSharePageUrl(requestId) {
  return `${PUBLIC_BASE_URL}/social/${encodeURIComponent(requestId)}`;
}

/**
 * Публичный share-URL всегда https://…/social/{id}.
 * В БД могли остаться joypick:// или /request/… — чиним при чтении.
 * @returns {{ canonical: string, needsRepair: boolean }}
 */
function normalizeSocialSharePublicUrl(requestId, storedUrl) {
  const id = String(requestId || '').trim();
  const canonical = id ? buildSharePageUrl(id) : '';
  const raw = String(storedUrl || '').trim();
  if (!canonical) return { canonical: '', needsRepair: false };
  if (!raw || raw === canonical) return { canonical, needsRepair: false };
  return { canonical, needsRepair: true };
}

function buildDeepLinkUrl(category, requestId) {
  const path = CATEGORY_PATH[category] || 'waste_location';
  return `${PUBLIC_BASE_URL}/request/${path}/${encodeURIComponent(requestId)}`;
}

function formatUserName(user) {
  if (!user) return '';
  if (user.display_name && String(user.display_name).trim()) {
    return String(user.display_name).trim();
  }
  const fio = `${user.first_name || ''} ${user.second_name || ''}`.trim();
  if (fio) return fio;
  if (user.email && String(user.email).trim()) return String(user.email).trim();
  return '';
}

async function loadUsersByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return new Map();
  const placeholders = unique.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT id, display_name, first_name, second_name, email FROM users WHERE id IN (${placeholders})`,
    unique
  );
  const map = new Map();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

function resolveExecutorUserIds(requestRow) {
  const category = String(requestRow.category || '');
  if (category === 'event') {
    const pcs = parseParticipantCompletions(requestRow.participant_completions);
    const ids = [];
    for (const [userId, entry] of Object.entries(pcs)) {
      if (!userId || userId === requestRow.created_by) continue;
      if (participantSubmittedPart(entry)) ids.push(userId);
    }
    return ids;
  }
  const single =
    requestRow.joined_user_id || requestRow.taken_by || requestRow.created_by || null;
  return single ? [single] : [];
}

async function resolveShareNames(requestRow) {
  const organizerId = requestRow.created_by;
  const executorIds = resolveExecutorUserIds(requestRow);
  const users = await loadUsersByIds([organizerId, ...executorIds]);
  const organizerName = formatUserName(users.get(organizerId));
  const executorNames = executorIds.map((id) => formatUserName(users.get(id))).filter(Boolean);
  return { organizerName, executorNames };
}

function assertShareEligible(requestRow, userId) {
  if (!requestRow) {
    const err = new Error('Request not found');
    err.statusCode = 404;
    err.errorCode = 'SOCIAL_SHARE_NOT_FOUND';
    throw err;
  }
  if (String(requestRow.created_by) !== String(userId)) {
    const err = new Error('Only the request creator can create a social share page');
    err.statusCode = 403;
    err.errorCode = 'SOCIAL_SHARE_NOT_CREATOR';
    throw err;
  }
  if (!ALLOWED_STATUSES.has(String(requestRow.status || ''))) {
    const err = new Error('Request status does not allow social sharing');
    err.statusCode = 422;
    err.errorCode = 'SOCIAL_SHARE_STATUS_NOT_ALLOWED';
    throw err;
  }
  if (!hasCompletionSharePhotos(requestRow)) {
    const err = new Error('Before and after photos are required for social sharing');
    err.statusCode = 422;
    err.errorCode = 'SOCIAL_SHARE_PHOTOS_REQUIRED';
    throw err;
  }
}

async function fetchRequestRow(requestId) {
  const [rows] = await pool.execute('SELECT * FROM requests WHERE id = ? LIMIT 1', [requestId]);
  return rows[0] || null;
}

/**
 * Сброс share-страницы: поля в БД + og.jpg на диске.
 * Вызывать при архивировании и перед удалением заявки.
 */
async function clearSocialShareForRequest(requestId) {
  const id = String(requestId || '').trim();
  if (!id) return { requestId: id, affectedRows: 0, ogDirRemoved: false };

  const [result] = await pool.execute(
    `UPDATE requests SET
      social_share_url = NULL,
      social_share_created_at = NULL,
      social_share_og_image_url = NULL,
      social_share_locale = NULL,
      updated_at = NOW()
    WHERE id = ?`,
    [id]
  );

  const uploadDir = path.join(SOCIAL_UPLOADS_ROOT, id);
  let ogDirRemoved = false;
  if (fs.existsSync(uploadDir)) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
    ogDirRemoved = true;
  }

  return {
    requestId: id,
    affectedRows: result.affectedRows,
    ogDirRemoved,
  };
}

/**
 * POST /api/requests/:id/social-share
 * @returns {Promise<{ social_share_url: string, created: boolean, social_share_og_image_url?: string }>}
 */
async function ensureSocialSharePage(requestId, userId, options = {}) {
  const row = await fetchRequestRow(requestId);
  assertShareEligible(row, userId);

  const locale = options.locale ? normalizeShareLocale(options.locale) : null;

  if (row.social_share_url && String(row.social_share_url).trim()) {
    const { canonical, needsRepair } = normalizeSocialSharePublicUrl(requestId, row.social_share_url);

    if (needsRepair || locale) {
      await pool.execute(
        `UPDATE requests SET
          social_share_url = ?,
          social_share_locale = COALESCE(?, social_share_locale),
          updated_at = NOW()
        WHERE id = ?`,
        [canonical, locale, requestId]
      );
    }

    return {
      social_share_url: canonical,
      created: false,
      social_share_og_image_url: row.social_share_og_image_url || null,
      social_share_locale: locale || row.social_share_locale || null,
    };
  }

  const { before, after } = resolveSharePhotos(row);
  const og = await generateSocialShareOgImage({
    requestId,
    beforeUrl: before,
    afterUrl: after,
  });

  const shareUrl = buildSharePageUrl(requestId);
  await pool.execute(
    `UPDATE requests SET social_share_url = ?, social_share_created_at = NOW(), social_share_og_image_url = ?, social_share_locale = ?, updated_at = NOW() WHERE id = ?`,
    [shareUrl, og.publicUrl, locale, requestId]
  );

  return {
    social_share_url: shareUrl,
    created: true,
    social_share_og_image_url: og.publicUrl,
    social_share_locale: locale,
  };
}

/**
 * Данные для GET /social/:id (только если share создан).
 */
async function loadPublicSharePage(requestId, options = {}) {
  const row = await fetchRequestRow(requestId);
  if (!row || !row.social_share_url) return null;

  const locale = resolveShareLocale({
    locale: row.social_share_locale || options.locale,
    acceptLanguage: options.acceptLanguage,
  });
  const ui = uiCopy(locale);
  const { before, after } = resolveSharePhotos(row);
  const { organizerName, executorNames } = await resolveShareNames(row);

  const articleText = applyShareTemplate({
    locale,
    requestName: row.name,
    organizerName,
    executorNames,
  });

  const ogImage =
    (row.social_share_og_image_url && String(row.social_share_og_image_url).trim()) ||
    `${PUBLIC_BASE_URL}/uploads/social/${requestId}/og.jpg`;

  const category = String(row.category || '');
  const categoryLabel = ui.categoryLabels[category] || category;

  const { canonical: shareUrl } = normalizeSocialSharePublicUrl(requestId, row.social_share_url);

  return {
    requestId,
    shareUrl,
    locale,
    ui,
    requestName: row.name || '',
    city: row.city || '',
    category,
    categoryLabel,
    articleText,
    beforePhotoUrl: before,
    afterPhotoUrl: after,
    ogImageUrl: ogImage,
    deepLinkUrl: buildDeepLinkUrl(category, requestId),
    ogDescription: articleText.split('\n')[0].slice(0, 200),
    ogTitle: row.name ? `${row.name} — JoyPick` : 'JoyPick — eco cleanup',
  };
}

module.exports = {
  ALLOWED_STATUSES,
  resolveSharePhotos,
  hasCompletionSharePhotos,
  resolveExecutorUserIds,
  assertShareEligible,
  clearSocialShareForRequest,
  ensureSocialSharePage,
  loadPublicSharePage,
  buildSharePageUrl,
  normalizeSocialSharePublicUrl,
  buildDeepLinkUrl,
  CATEGORY_PATH,
};
