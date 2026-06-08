#!/usr/bin/env node
/**
 * Восстановление event со start_date в будущем, ошибочно ушедших в rejected (крон 8 дней от created_at).
 * node scripts/restore_future_events_from_rejected.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../api/config/database');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const [rows] = await pool.execute(
    `SELECT id, name, status, start_date, created_at, from_external_source
     FROM requests
     WHERE category = 'event'
       AND status = 'rejected'
       AND start_date IS NOT NULL
       AND start_date > NOW()
     ORDER BY start_date ASC`
  );

  console.log(JSON.stringify({ dryRun, count: rows.length, sample: rows.slice(0, 5) }, null, 2));

  if (dryRun || rows.length === 0) {
    await pool.end();
    return;
  }

  const [result] = await pool.execute(
    `UPDATE requests
     SET status = 'inProgress',
         rejection_reason = NULL,
         rejection_message = NULL,
         updated_at = NOW()
     WHERE category = 'event'
       AND status = 'rejected'
       AND start_date IS NOT NULL
       AND start_date > NOW()`
  );

  console.log(JSON.stringify({ restored: result.affectedRows || 0 }));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
