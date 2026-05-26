require('dotenv').config();
const requestModerationService = require('../api/services/requestModerationService');

async function main() {
  const cases = [
    {},
    { has_proposed: '1' },
    { has_proposed: '0' },
    { proposed_action: 'reject', has_proposed: '1' },
    { sort: 'submitted', limit: 28, offset: 0 },
  ];
  for (const q of cases) {
    const data = await requestModerationService.listModerationQueue(q);
    console.log('ok', JSON.stringify(q), 'total=', data.total);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
