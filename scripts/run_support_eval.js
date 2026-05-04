/**
 * Прогон эталонных вопросов против POST /api/support/eval-reply (см. api/routes/support.js).
 *
 * Переменные окружения:
 *   SUPPORT_EVAL_SECRET  — обязательно, тот же что в .env на сервере/локально
 *   SUPPORT_EVAL_BASE_URL — по умолчанию http://127.0.0.1:300/api (порт как в app.js PORT || 300)
 *
 * Запуск: npm run support:eval
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const secret = String(process.env.SUPPORT_EVAL_SECRET || '').trim();
const baseUrl = String(process.env.SUPPORT_EVAL_BASE_URL || 'http://127.0.0.1:300/api').replace(/\/$/, '');
const casesPath = path.join(__dirname, 'support_eval_cases.json');

async function main() {
  if (!secret) {
    console.error('Задайте SUPPORT_EVAL_SECRET в .env (должен совпадать с сервером).');
    process.exit(1);
  }

  const raw = fs.readFileSync(casesPath, 'utf8');
  const cases = JSON.parse(raw);
  if (!Array.isArray(cases) || !cases.length) {
    console.error('Пустой или неверный support_eval_cases.json');
    process.exit(1);
  }

  const url = `${baseUrl}/support/eval-reply`;
  let failed = 0;

  for (const c of cases) {
    const id = c.id || '(no id)';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Support-Eval-Secret': secret
      },
      body: JSON.stringify({
        message: c.message,
        locale: c.locale || 'ru'
      })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      console.error(`FAIL ${id} HTTP ${res.status}`, json.message || json);
      failed++;
      continue;
    }

    const data = json.data || {};
    if (data.degraded) {
      console.error(
        `FAIL ${id} ответ-заглушка (AI недоступен):`,
        data.ai_error_code || data.degraded_reason || 'unknown',
        '— проверьте ключи Gemini/OpenRouter и сеть.'
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
      failed++;
      continue;
    }
    if (!sourcesOk) {
      console.error(`FAIL ${id} sources ${JSON.stringify(sources)} missing any of`, mustAny);
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
