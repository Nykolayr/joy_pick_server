/**
 * Прогон шести ручных вопросов через getSupportAiAnswer (без HTTP).
 * Запуск: node scripts/run_support_six_qa.js
 * Нужны GEMINI_API_KEY и/или OPENROUTER_API_KEY в .env.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getSupportAiAnswer } = require('../api/services/supportAiService');

const CASES = [
  { id: 1, message: 'о чем данное приложение?' },
  { id: 2, message: 'как я могу привлечь людей на уборку конкретной территории?' },
  { id: 3, message: 'что сделать, чтобы вывезли мусор с территории?' },
  { id: 4, message: 'если я создам заявку waste location, то кто получит донаты?' },
  { id: 5, message: 'кто получит донейшен?' },
  { id: 6, message: 'если в моей стране нет страйп?' }
];

async function main() {
  for (const c of CASES) {
    const data = await getSupportAiAnswer({
      message: c.message,
      locale: 'ru',
      conversationContext: []
    });
    const head = data.degraded ? `[degraded ${data.ai_error_code || ''}]` : `[model ${data.model || ''}]`;
    process.stdout.write(`\n--- ${c.id}. ${head} ---\n`);
    process.stdout.write(`Вопрос: ${c.message}\n`);
    process.stdout.write(`Ответ: ${String(data.answer || '').trim()}\n`);
    if (Array.isArray(data.sources) && data.sources.length) {
      process.stdout.write(`sources: ${data.sources.join(', ')}\n`);
    }
  }
  process.stdout.write('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
