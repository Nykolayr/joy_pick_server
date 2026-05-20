/**
 * Smoke-тест черновиков Support AI Review (нужен JWT админа в .env).
 *
 *   SUPPORT_ADMIN_JWT=<token>
 *   SUPPORT_REVIEW_BASE_URL=https://joypick.world/api  (опционально)
 *
 *   node scripts/support_review_draft_smoke.js
 */
const path = require('path');
const { getReviewAgentConfig } = require('./support_review_env');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const jwt = String(process.env.SUPPORT_ADMIN_JWT || '').trim();
const { baseUrl } = getReviewAgentConfig();

async function api(method, urlPath, body) {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${jwt}`
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  if (!jwt) {
    console.error('Задайте SUPPORT_ADMIN_JWT в .env (JWT суперадмина).');
    process.exit(1);
  }

  const stamp = Date.now();
  const question = `smoke draft ${stamp}`;
  const remark1 = `remark create ${stamp}`;
  const remark2 = `remark patch ${stamp}`;

  // 1. POST draft with admin_remark
  const created = await api('POST', '/admin/support-ai-reviews', {
    question,
    ai_answer: 'smoke ai answer',
    ai_sources: ['intent_what_is_app_for_beginners'],
    locale: 'ru',
    model: 'smoke-test',
    admin_remark: remark1
  });
  assert(created.status === 201, `POST expected 201, got ${created.status}`);
  const id = created.json?.data?.id;
  assert(id, 'POST: no id');
  assert(created.json.data.status === 'draft', 'POST: status not draft');
  assert(
    created.json.data.current_round?.admin_remark === remark1,
    'POST: admin_remark not in current_round'
  );
  console.log('OK 1 POST draft + admin_remark');

  // 2. GET by id
  const got = await api('GET', `/admin/support-ai-reviews/${id}`);
  assert(got.status === 200, `GET :id expected 200`);
  assert(got.json.data.current_round?.admin_remark === remark1, 'GET: remark missing');
  console.log('OK 2 GET :id');

  // 3. PATCH question + admin_remark
  const patched = await api('PATCH', `/admin/support-ai-reviews/${id}`, {
    question: `${question} patched`,
    admin_remark: remark2
  });
  assert(patched.status === 200, `PATCH expected 200`);
  assert(patched.json.data.current_round?.question?.includes('patched'), 'PATCH: question');
  assert(patched.json.data.current_round?.admin_remark === remark2, 'PATCH: remark');
  console.log('OK 3 PATCH draft');

  // 4. GET list draft + created_by_admin_id
  const adminId = created.json.data.created_by_admin_id;
  assert(adminId, 'no created_by_admin_id');
  const list = await api(
    'GET',
    `/admin/support-ai-reviews?status=draft&limit=50&created_by_admin_id=${adminId}`
  );
  assert(list.status === 200, 'GET list');
  const items = list.json?.data?.items || [];
  assert(items.some((x) => x.id === id), 'GET list: draft not found');
  assert(items.find((x) => x.id === id).last_question?.includes('patched'), 'list last_question');
  console.log('OK 4 GET list + filter');

  // 5. submit → PATCH must 400
  const submitted = await api('POST', `/admin/support-ai-reviews/${id}/submit`, {
    admin_remark: 'submit remark for agent'
  });
  assert(submitted.status === 200, 'submit');
  const patchAfter = await api('PATCH', `/admin/support-ai-reviews/${id}`, { question: 'x' });
  assert(patchAfter.status === 400, `PATCH pending_review expected 400, got ${patchAfter.status}`);
  console.log('OK 5 PATCH on non-draft → 400');

  // cleanup: cannot DELETE non-draft — skip delete, leave ticket or delete only if still draft
  // For smoke we submitted — ticket stays pending_review (manual cleanup)

  console.log(JSON.stringify({ ok: true, id, baseUrl }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
