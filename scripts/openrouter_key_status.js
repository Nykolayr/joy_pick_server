/**
 * Статус ключа OpenRouter: GET /api/v1/key
 * Запуск: node scripts/openrouter_key_status.js
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY не задан');
    process.exit(1);
  }
  const res = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const json = await res.json();
  const d = json?.data || {};
  console.log(
    JSON.stringify(
      {
        httpStatus: res.status,
        label: d.label,
        limit: d.limit,
        limit_remaining: d.limit_remaining,
        limit_reset: d.limit_reset,
        usage_monthly: d.usage_monthly,
        is_free_tier: d.is_free_tier
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
