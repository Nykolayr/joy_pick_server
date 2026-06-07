#!/usr/bin/env node
/**
 * Smoke: guest POST → poll → GET history (все страницы).
 * node scripts/support_guest_history_smoke.js [baseUrl]
 */
const crypto = require('crypto');

const base = (process.argv[2] || process.env.SUPPORT_EVAL_BASE_URL || 'https://joypick.world/api').replace(
  /\/$/,
  ''
);
const guestId = crypto.randomUUID();

async function req(method, path, body) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Support-Guest-Id': guestId
    },
    body: body != null ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function pollUntilDone(messageId, maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const { status, json } = await req('GET', `/support/chat/messages/${messageId}`);
    if (status !== 200 || !json.success) {
      throw new Error(`poll failed ${status}: ${JSON.stringify(json)}`);
    }
    const st = json.data?.status;
    if (st === 'done' || st === 'error') return json.data;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('poll timeout');
}

async function loadAllHistory() {
  const limit = 50;
  let offset = 0;
  let total = Infinity;
  const all = [];
  while (offset < total) {
    const { status, json } = await req('GET', `/support/chat/history?limit=${limit}&offset=${offset}`);
    if (status !== 200 || !json.success) {
      throw new Error(`history failed ${status}: ${JSON.stringify(json)}`);
    }
    const data = json.data || {};
    total = Number(data.total) || 0;
    const items = data.items || [];
    all.push(...items);
    if (!items.length) break;
    offset += items.length;
  }
  return { total, all };
}

async function main() {
  console.log('base', base);
  console.log('guest', guestId);

  for (let i = 1; i <= 3; i += 1) {
    const { status, json } = await req('POST', '/support/chat', {
      message: `smoke history ${i} ${Date.now()}`,
      locale: 'ru'
    });
    if (status !== 200 || !json.success) {
      throw new Error(`POST ${i} failed: ${JSON.stringify(json)}`);
    }
    const messageId = json.data?.message_id;
    console.log(`POST ${i} message_id=${messageId}`);
    const done = await pollUntilDone(messageId);
    console.log(`  status=${done.status} answer_len=${String(done.answer || '').length}`);
  }

  const { total, all } = await loadAllHistory();
  console.log('history total=', total, 'loaded=', all.length);
  for (const row of all) {
    console.log(
      `  - ${row.id?.slice(0, 8)}… ${row.user_message?.slice(0, 40)} status=${row.status}`
    );
  }

  if (all.length < 3 || total < 3) {
    console.error('FAIL: expected at least 3 messages in history');
    process.exit(1);
  }
  if (all.length !== total) {
    console.error(`FAIL: loaded ${all.length} !== total ${total}`);
    process.exit(1);
  }
  console.log('OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
