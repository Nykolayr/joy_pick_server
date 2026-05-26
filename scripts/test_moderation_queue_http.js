/**
 * HTTP smoke: GET /api/admin/requests/moderation-queue (нужен .env + админ в БД).
 * node scripts/test_moderation_queue_http.js
 */
require('dotenv').config();
const http = require('http');
const pool = require('../api/config/database');

function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port: Number(process.env.PORT || 3000),
        path,
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
  });
}

async function main() {
  const [admins] = await pool.execute('SELECT id FROM users WHERE admin = 1 LIMIT 1');
  if (!admins.length) {
    console.error('no admin user');
    process.exit(1);
  }
  const { generateToken } = require('../api/utils/jwt');
  const token = generateToken({
    userId: admins[0].id,
    isAdmin: true,
    isSuperAdmin: false,
  });
  const path =
    '/api/admin/requests/moderation-queue?limit=28&offset=0&sort=finalize_at';
  const { status, body } = await get(path, token);
  console.log('status', status);
  console.log(body.slice(0, 800));
  if (status !== 200) process.exit(1);
  const j = JSON.parse(body);
  if (!j.success) process.exit(1);
  console.log('ok total', j.data?.total);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
