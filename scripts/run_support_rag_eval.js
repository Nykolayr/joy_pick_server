/**
 * Проверка только RAG (топ чанки), без Gemini/OpenRouter.
 * Кейсы: support_eval_cases.json — условие sourcesMustIncludeAny должно выполняться по попавшим в top-K chunk_id.
 *
 * Запуск: npm run support:eval:rag
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { previewSupportRetrieval } = require('../api/services/supportAiService');

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
    const preview = await previewSupportRetrieval({ message: c.message, locale });
    const chunkIds = preview.chunkIds || [];
    const mustAny = c.sourcesMustIncludeAny || [];
    const sourcesOk = !mustAny.length || mustAny.some((chunkId) => chunkIds.includes(chunkId));

    if (!sourcesOk) {
      console.error(`FAIL ${id} top chunks ${JSON.stringify(chunkIds)} missing any of`, mustAny);
      console.error(`  effectiveQuestion: ${String(preview.effectiveQuestion || '').slice(0, 200)}…`);
      failed++;
      continue;
    }

    console.log(`OK   ${id} chunks=${chunkIds.join(',')}`);
  }

  if (failed) {
    console.error(`\nИтого RAG: ${failed}/${cases.length} ошибок`);
    process.exit(1);
  }
  console.log(`\nВсе ${cases.length} кейсов RAG прошли.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
