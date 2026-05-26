require('dotenv').config();
const requestModerationService = require('../api/services/requestModerationService');

async function main() {
  const data = await requestModerationService.listModerationQueue({
    limit: 28,
    offset: 0,
    sort: 'finalize_at',
  });
  console.log('ok', data.total, data.items.length);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
