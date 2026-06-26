/**
 * Статус ключа OpenRouter: GET /api/v1/key
 * Запуск: node scripts/openrouter_key_status.js
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { fetchOpenRouterKeyStatus } = require('../api/utils/openRouterKeyStatus');

async function main() {
  const status = await fetchOpenRouterKeyStatus();
  if (!status.configured) {
    console.error(status.error || 'OPENROUTER_API_KEY не задан');
    process.exit(1);
  }
  console.log(JSON.stringify(status, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
