#!/usr/bin/env node
/** Одноразово: joypick:// и прочие legacy → https://joypick.world/social/{id} */
require('dotenv').config();
const pool = require('../api/config/database');
const { normalizeSocialSharePublicUrl } = require('../api/services/requestSocialShareService');

async function main() {
  const [rows] = await pool.execute(
    'SELECT id, social_share_url FROM requests WHERE social_share_url IS NOT NULL AND social_share_url != \'\''
  );
  let repaired = 0;
  for (const row of rows) {
    const { canonical, needsRepair } = normalizeSocialSharePublicUrl(row.id, row.social_share_url);
    if (needsRepair) {
      await pool.execute(
        'UPDATE requests SET social_share_url = ?, updated_at = NOW() WHERE id = ?',
        [canonical, row.id]
      );
      repaired += 1;
      console.log('repaired', row.id, row.social_share_url, '->', canonical);
    }
  }
  console.log(`repair_social_share_urls: scanned=${rows.length} repaired=${repaired}`);
  await pool.end?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
