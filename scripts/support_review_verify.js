/**
 * Для каждого тикета в очереди: eval-reply на проде → PATCH agent-complete.
 *
 * .env: SUPPORT_REVIEW_AGENT_SECRET, SUPPORT_EVAL_SECRET,
 *       SUPPORT_REVIEW_BASE_URL или SUPPORT_EVAL_BASE_URL
 *
 *   npm run support:review:verify
 *   npm run support:review:verify -- --pull-first
 *   node scripts/support_review_verify.js --id=<uuid>
 */
const fs = require('fs');
const path = require('path');
const { getReviewAgentConfig, assertReviewSecret, assertEvalSecret } = require('./support_review_env');

const QUEUE_FILE = path.join(__dirname, '..', 'tmp', 'support_review_queue.json');

async function pullQueue(config) {
  const url = `${config.baseUrl}/admin/support-ai-reviews/agent-queue`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'X-Support-Review-Agent-Secret': config.reviewSecret }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(`agent-queue failed: ${JSON.stringify(json)}`);
  }
  return json.data?.items || [];
}

function loadQueueFromFile() {
  if (!fs.existsSync(QUEUE_FILE)) {
    throw new Error(`Нет файла ${QUEUE_FILE}. Сначала: npm run support:review:pull`);
  }
  const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  return raw.items || [];
}

async function evalOnce(config, message, locale) {
  const url = `${config.baseUrl}/support/eval-reply`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Support-Eval-Secret': config.evalSecret
    },
    body: JSON.stringify({ message, locale })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const err = new Error(`eval-reply failed for "${message.slice(0, 60)}..."`);
    err.response = json;
    throw err;
  }
  return json.data;
}

async function agentComplete(config, ticketId, body) {
  const url = `${config.baseUrl}/admin/support-ai-reviews/${ticketId}/agent-complete`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Support-Review-Agent-Secret': config.reviewSecret
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const err = new Error(`agent-complete failed for ${ticketId}`);
    err.response = json;
    throw err;
  }
  return json.data;
}

async function main() {
  const pullFirst = process.argv.includes('--pull-first');
  const idArg = process.argv.find((a) => a.startsWith('--id='));
  const onlyId = idArg ? idArg.slice('--id='.length) : null;

  const config = getReviewAgentConfig();
  assertReviewSecret(config);
  assertEvalSecret(config);

  let items = pullFirst ? await pullQueue(config) : loadQueueFromFile();
  if (onlyId) {
    items = items.filter((x) => x.id === onlyId);
    if (!items.length) {
      throw new Error(`Тикет ${onlyId} не найден в очереди`);
    }
  }

  if (!items.length) {
    console.error('Очередь пуста (pending_review).');
    process.exit(0);
  }

  const results = [];
  let failed = 0;

  for (const ticket of items) {
    const { id, question, locale } = ticket;
    try {
      const evalData = await evalOnce(config, question, locale || 'ru');
      const answer =
        locale === 'ru'
          ? evalData.answer
          : evalData.answer_en || evalData.answer;
      const completed = await agentComplete(config, id, {
        answer_after_fix: answer,
        sources_after_fix: evalData.sources || [],
        model: evalData.model || null,
        fix_notes: evalData.degraded
          ? `degraded: ${evalData.ai_error_code || 'unknown'}`
          : undefined
      });
      results.push({ id, ok: true, status: completed.status });
      console.error(`OK ${id}`);
    } catch (e) {
      failed += 1;
      results.push({
        id,
        ok: false,
        error: e.message,
        response: e.response || null
      });
      console.error(`FAIL ${id}: ${e.message}`);
    }
  }

  const summary = {
    verified_at: new Date().toISOString(),
    total: items.length,
    ok: results.filter((r) => r.ok).length,
    failed,
    results
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
