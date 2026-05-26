#!/usr/bin/env node
/**
 * CI/локально: запрет LIMIT ? / OFFSET ? в pool.execute/query (ломает mysqld_stmt_execute на проде).
 * Запуск: node scripts/check_sql_limit_placeholders.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'api');
const BAD = /LIMIT\s+\?\s+OFFSET\s+\?/i;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, 'utf8');
  if (BAD.test(text)) hits.push(path.relative(path.join(__dirname, '..'), file));
}

if (hits.length) {
  console.error('FAIL: LIMIT ? OFFSET ? in:\n' + hits.map((h) => `  - ${h}`).join('\n'));
  console.error('Use: LIMIT ${safeLimit} OFFSET ${safeOffset} with parsed integers.');
  process.exit(1);
}
console.log('OK: no LIMIT ? OFFSET ? in api/');
