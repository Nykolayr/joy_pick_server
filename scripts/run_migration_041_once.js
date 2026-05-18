/**
 * Однократный прогон миграции 041 на сервере: node scripts/run_migration_041_once.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'migrations', '041_support_ai_review_tickets.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  });
  await conn.query(sql);
  const [rows] = await conn.query("SHOW TABLES LIKE 'support_ai_review_tickets'");
  await conn.end();
  console.log(rows.length ? 'support_ai_review_tickets: ok' : 'support_ai_review_tickets: missing');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
