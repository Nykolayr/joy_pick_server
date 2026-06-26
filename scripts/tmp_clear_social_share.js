require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { clearSocialShareForRequest } = require('../api/services/requestSocialShareService');

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('usage: node tmp_clear_social_share.js <requestId>');
    process.exit(1);
  }
  const result = await clearSocialShareForRequest(id);
  console.log(JSON.stringify(result));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
