const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function getReviewAgentConfig() {
  const reviewSecret = String(process.env.SUPPORT_REVIEW_AGENT_SECRET || '').trim();
  const evalSecret = String(process.env.SUPPORT_EVAL_SECRET || '').trim();
  const baseUrl = String(
    process.env.SUPPORT_REVIEW_BASE_URL ||
      process.env.SUPPORT_EVAL_BASE_URL ||
      'https://joypick.world/api'
  ).replace(/\/$/, '');

  return { reviewSecret, evalSecret, baseUrl };
}

function assertReviewSecret(config) {
  if (!config.reviewSecret) {
    throw new Error('В .env нет SUPPORT_REVIEW_AGENT_SECRET (должен совпадать с сервером).');
  }
}

function assertEvalSecret(config) {
  if (!config.evalSecret) {
    throw new Error('В .env нет SUPPORT_EVAL_SECRET (для verify через eval-reply).');
  }
}

module.exports = {
  getReviewAgentConfig,
  assertReviewSecret,
  assertEvalSecret
};
