/**
 * Одноразовая/периодическая чистка earthday_image_cache через OpenRouter vision.
 * Usage: node scripts/earthday_purge_bad_cache_images.js [--dry-run] [--limit N]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const pool = require('../api/config/database');
const { classifyEarthdayCoverImage, isEarthdayVisionEnabled } = require('../api/services/earthdayImageVision');
const {
  localFilePathFromUploadUrl,
  purgeBadEarthdayImage,
} = require('../api/services/earthdayImagePurge');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 100) : 200;

  if (!isEarthdayVisionEnabled()) {
    console.error('Vision off: set OPENROUTER_API_KEY and do not set EARTHDAY_VISION_FILTER=0');
    process.exit(1);
  }

  const [rows] = await pool.execute(
    `SELECT id, image_url, country, region_key
     FROM earthday_image_cache
     ORDER BY id ASC
     LIMIT ${limit}`
  );

  let rejected = 0;
  let kept = 0;
  let missing = 0;

  for (const row of rows) {
    const imageUrl = String(row.image_url);
    const filePath = localFilePathFromUploadUrl(imageUrl);
    if (!filePath || !fs.existsSync(filePath)) {
      missing += 1;
      if (!dryRun) {
        await purgeBadEarthdayImage(pool, imageUrl, { reason: 'missing_file' });
      }
      console.log('missing', imageUrl);
      continue;
    }

    const verdict = await classifyEarthdayCoverImage({ filePath });
    if (verdict.verdict === 'reject') {
      rejected += 1;
      console.log('reject', imageUrl, verdict.reason || '');
      if (!dryRun) {
        await purgeBadEarthdayImage(pool, imageUrl, { visionReason: verdict.reason });
      }
    } else {
      kept += 1;
    }
  }

  console.log(JSON.stringify({ scanned: rows.length, rejected, kept, missing, dry_run: dryRun }));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
