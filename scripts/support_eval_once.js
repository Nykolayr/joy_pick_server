/**
 * Один вопрос к прод-эндпоинту POST /api/support/eval-reply (как npm run support:eval, но один message).
 * Читает .env: SUPPORT_EVAL_SECRET, SUPPORT_EVAL_BASE_URL (по умолчанию https://joypick.world/api).
 *
 * Запуск (PowerShell / bash):
 *   node scripts/support_eval_once.js "Ваш вопрос"
 *   node scripts/support_eval_once.js "Question" en
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const secret = String(process.env.SUPPORT_EVAL_SECRET || '').trim();
const baseUrl = String(process.env.SUPPORT_EVAL_BASE_URL || 'https://joypick.world/api').replace(/\/$/, '');

async function main() {
  const message = process.argv[2];
  const locale = (process.argv[3] || 'ru').trim();
  if (!message) {
    console.error('Использование: node scripts/support_eval_once.js "<сообщение>" [locale]');
    process.exit(1);
  }
  if (!secret) {
    console.error('В .env нет SUPPORT_EVAL_SECRET (должен совпадать с сервером).');
    process.exit(1);
  }

  const url = `${baseUrl}/support/eval-reply`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Support-Eval-Secret': secret
    },
    body: JSON.stringify({ message, locale })
  });

  const json = await res.json().catch(() => ({}));
  process.stdout.write(JSON.stringify(json, null, 2) + '\n');
  if (!res.ok || !json.success) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
