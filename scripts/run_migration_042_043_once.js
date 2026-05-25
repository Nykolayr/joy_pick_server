/**
 * Однократно на сервере: node scripts/run_migration_042_043_once.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function runFile(conn, filename) {
  const sqlPath = path.join(__dirname, '..', 'migrations', filename);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await conn.query(sql);
  console.log(`OK: ${filename}`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  await runFile(conn, '042_requests_auto_moderation.sql');
  await runFile(conn, '043_requests_integrity_check.sql');
  await conn.end();
  console.log('migrations 042+043 done');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
