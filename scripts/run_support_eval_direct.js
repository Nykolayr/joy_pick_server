/**
 * Те же кейсы, что support_eval_cases.json, но вызов getSupportAiAnswer напрямую
 * (без HTTP и SUPPORT_EVAL_SECRET). Нужен .env с GEMINI_API_KEY (и при падении Gemini — OpenRouter).
 *
 * Запуск: npm run support:eval:direct
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getSupportAiAnswer } = require('../api/services/supportAiService');

const casesPath = path.join(__dirname, 'support_eval_cases.json');

async function main() {
  const raw = fs.readFileSync(casesPath, 'utf8');
  const cases = JSON.parse(raw);
  if (!Array.isArray(cases) || !cases.length) {
    console.error('Пустой или неверный support_eval_cases.json');
    process.exit(1);
  }

  let failed = 0;

  for (const c of cases) {
    const id = c.id || '(no id)';
    const locale = c.locale || 'ru';
    const data = await getSupportAiAnswer({
      message: c.message,
      locale,
      conversationContext: []
    });

    if (data.degraded) {
      console.error(
        `FAIL ${id} ответ-заглушка (AI недоступен):`,
        data.ai_error_code || data.degraded_reason || 'unknown'
      );
      failed++;
      continue;
    }

    const answer = String(data.answer || '');
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const badPhrases = (c.answerMustNotContain || []).filter(
      (p) => p && answer.toLowerCase().includes(String(p).toLowerCase())
    );
    const mustAny = c.sourcesMustIncludeAny || [];
    const sourcesOk = !mustAny.length || mustAny.some((chunkId) => sources.includes(chunkId));

    if (badPhrases.length) {
      console.error(`FAIL ${id} answer contains forbidden:`, badPhrases);
      console.error(`answer (first 400): ${answer.slice(0, 400)}`);
      failed++;
      continue;
    }
    if (!sourcesOk) {
      console.error(`FAIL ${id} sources ${JSON.stringify(sources)} missing any of`, mustAny);
      console.error(`answer (first 400): ${answer.slice(0, 400)}`);
      failed++;
      continue;
    }

    console.log(`OK   ${id} sources=${sources.join(',')}`);
  }

  if (failed) {
    console.error(`\nИтого: ${failed}/${cases.length} ошибок`);
    process.exit(1);
  }
  console.log(`\nВсе ${cases.length} кейсов прошли.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
