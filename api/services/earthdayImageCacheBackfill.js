function normalizeRegionKey(raw) {
  if (raw == null) return '';
  const src = String(raw).toLowerCase();
  const cleaned = src
    .replace(/[0-9]/g, ' ')
    .replace(/[^\p{L}\s,.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const parts = cleaned
    .split(/[,|;·]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  return parts.slice(0, 2).join(' | ').slice(0, 255);
}

function normalizeUploadUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('/uploads/')) return s;
  try {
    const u = new URL(s);
    if (!u.pathname || !u.pathname.startsWith('/uploads/')) return null;
    return u.pathname;
  } catch {
    return null;
  }
}

function parsePhotosBefore(raw) {
  if (raw == null) return [];
  let arr = null;

  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        arr = parsed;
      } else if (typeof parsed === 'string') {
        arr = [parsed];
      } else {
        arr = [s];
      }
    } catch {
      arr = [s];
    }
  } else {
    return [];
  }

  const normalized = [];
  for (const v of arr) {
    const u = normalizeUploadUrl(v);
    if (u) normalized.push(u);
  }
  return [...new Set(normalized)];
}

function getCountryStatsBucket(statsByCountry, country) {
  const key = country || '_unknown';
  if (!statsByCountry[key]) {
    statsByCountry[key] = {
      requests: 0,
      checked_photos: 0,
      inserted: 0,
      existed: 0,
      skipped_no_country_or_region: 0,
      skipped_invalid_photos: 0
    };
  }
  return statsByCountry[key];
}

async function runEarthdayImageCacheBackfill(pool, opts = {}) {
  const dryRun = !!opts.dryRun;
  const rawLimit = Number(opts.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 10000) : null;

  const limitSql = limit ? ` LIMIT ${limit}` : '';
  const [rows] = await pool.execute(
    `SELECT
       r.id AS request_id,
       r.created_at AS request_created_at,
       r.photos_before,
       c.country,
       c.location_hint
     FROM requests r
     LEFT JOIN earthday_cleanups c ON c.objectid = r.earthday_cleanup_objectid
     WHERE r.from_external_source = 1
       AND r.earthday_cleanup_objectid IS NOT NULL
       AND r.photos_before IS NOT NULL
       AND TRIM(r.photos_before) <> ''
     ORDER BY r.created_at DESC${limitSql}`
  );

  const totals = {
    dry_run: dryRun,
    scanned_requests: rows.length,
    requests_with_valid_photos: 0,
    checked_photos: 0,
    inserted: 0,
    existed: 0,
    skipped_no_country_or_region: 0,
    skipped_invalid_photos: 0
  };
  const perCountry = {};
  const aggregatedByTriple = new Map();

  for (const row of rows) {
    const country = row.country != null ? String(row.country).trim().slice(0, 128) : '';
    const hint = row.location_hint != null ? String(row.location_hint).trim() : '';
    const regionKey = normalizeRegionKey(hint || country);
    const photos = parsePhotosBefore(row.photos_before);

    const bucket = getCountryStatsBucket(perCountry, country || null);
    bucket.requests += 1;

    if (photos.length === 0) {
      totals.skipped_invalid_photos += 1;
      bucket.skipped_invalid_photos += 1;
      continue;
    }
    totals.requests_with_valid_photos += 1;

    if (!country || !regionKey) {
      totals.skipped_no_country_or_region += photos.length;
      bucket.skipped_no_country_or_region += photos.length;
      continue;
    }

    const createdAt = row.request_created_at ? new Date(row.request_created_at) : null;
    const createdIso = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString().slice(0, 19).replace('T', ' ') : null;

    for (const imageUrl of photos) {
      const tripleKey = `${country}||${regionKey}||${imageUrl}`;
      const existing = aggregatedByTriple.get(tripleKey);
      if (!existing) {
        aggregatedByTriple.set(tripleKey, {
          country,
          hint: hint || null,
          regionKey,
          imageUrl,
          useCount: 1,
          lastUsedAt: createdIso
        });
      } else {
        existing.useCount += 1;
        if (!existing.lastUsedAt || (createdIso && createdIso > existing.lastUsedAt)) {
          existing.lastUsedAt = createdIso;
        }
      }
    }
  }

  for (const item of aggregatedByTriple.values()) {
    totals.checked_photos += 1;
    const bucket = getCountryStatsBucket(perCountry, item.country || null);
    bucket.checked_photos += 1;

    if (dryRun) continue;

    const [ins] = await pool.execute(
      `INSERT INTO earthday_image_cache
        (image_url, country, location_hint, region_key, use_count, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         location_hint = VALUES(location_hint),
         use_count = GREATEST(use_count, VALUES(use_count)),
         last_used_at = CASE
           WHEN last_used_at IS NULL THEN VALUES(last_used_at)
           WHEN VALUES(last_used_at) IS NULL THEN last_used_at
           ELSE GREATEST(last_used_at, VALUES(last_used_at))
         END`,
      [item.imageUrl, item.country, item.hint, item.regionKey, item.useCount, item.lastUsedAt]
    );

    if (ins && Number(ins.affectedRows) === 1) {
      totals.inserted += 1;
      bucket.inserted += 1;
    } else {
      totals.existed += 1;
      bucket.existed += 1;
    }
  }

  return {
    totals,
    per_country: perCountry
  };
}

module.exports = {
  runEarthdayImageCacheBackfill
};
