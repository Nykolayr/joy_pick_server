/**
 * Однократно: node scripts/run_migration_045_once.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'migrations', '045_requests_social_share.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  await conn.query(sql);
  const [rows] = await conn.query("SHOW COLUMNS FROM requests LIKE 'social_share_url'");
  await conn.end();
  console.log(rows.length ? 'social_share_*: ok' : 'social_share_*: missing');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
