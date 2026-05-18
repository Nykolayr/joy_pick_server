/**
 * Загрузка очереди pending_review с прода.
 * Пишет tmp/support_review_queue.json и печатает JSON в stdout.
 *
 * .env: SUPPORT_REVIEW_AGENT_SECRET, SUPPORT_REVIEW_BASE_URL или SUPPORT_EVAL_BASE_URL
 *
 *   npm run support:review:pull
 *   node scripts/support_review_pull.js --json-only
 */
const fs = require('fs');
const path = require('path');
const { getReviewAgentConfig, assertReviewSecret } = require('./support_review_env');

const OUT_FILE = path.join(__dirname, '..', 'tmp', 'support_review_queue.json');

async function main() {
  const jsonOnly = process.argv.includes('--json-only');
  const config = getReviewAgentConfig();
  assertReviewSecret(config);

  const url = `${config.baseUrl}/admin/support-ai-reviews/agent-queue`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'X-Support-Review-Agent-Secret': config.reviewSecret }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const payload = {
    pulled_at: new Date().toISOString(),
    base_url: config.baseUrl,
    ...json.data
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');

  if (!jsonOnly) {
    console.error(`Saved ${payload.count || 0} ticket(s) to ${OUT_FILE}`);
  }
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
