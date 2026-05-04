/**
 * Stress-тест RAG: много разных формулировок из title/tags чанков,
 * проверка что «свой» chunk_id попадает в top-K (как в проде).
 *
 * Запуск:
 *   node scripts/run_support_rag_stress.js --locale=ru --per-chunk=6 --limit=2000 --seed=1
 *   npm run support:eval:rag:stress
 *
 * Флаги:
 *   --locale=ru|en     (по умолчанию ru)
 *   --per-chunk=N      макс. вариантов на чанк после дедупа (по умолчанию 6)
 *   --limit=N          макс. вопросов всего после перемешивания (0 = без лимита)
 *   --seed=N           seed для shuffle (по умолчанию 1)
 *   --out=path         JSON с падениями (по умолчанию tmp/rag_stress_last.json)
 *   --max-fail-print=30 сколько падений печатать в stderr
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { previewSupportRetrieval } = require('../api/services/supportAiService');

function parseArgs(argv) {
  const o = { locale: 'ru', perChunk: 6, limit: 2000, seed: 1, out: '', maxFailPrint: 30 };
  for (const a of argv) {
    if (a.startsWith('--locale=')) o.locale = a.slice('--locale='.length).trim();
    else if (a.startsWith('--per-chunk=')) o.perChunk = Math.max(1, parseInt(a.slice('--per-chunk='.length), 10) || 6);
    else if (a.startsWith('--limit=')) o.limit = Math.max(0, parseInt(a.slice('--limit='.length), 10) || 0);
    else if (a.startsWith('--seed=')) o.seed = parseInt(a.slice('--seed='.length), 10) || 1;
    else if (a.startsWith('--out=')) o.out = a.slice('--out='.length).trim();
    else if (a.startsWith('--max-fail-print='))
      o.maxFailPrint = Math.max(0, parseInt(a.slice('--max-fail-print='.length), 10) || 30);
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, seed) {
  const rand = mulberry32(seed >>> 0);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildVariants(chunk, locale) {
  const title = String(chunk.title || '').trim();
  const tags = Array.isArray(chunk.tags) ? chunk.tags.map((x) => String(x).trim()).filter(Boolean) : [];
  const out = new Set();

  if (locale === 'ru') {
    if (title) {
      const t0 = title.charAt(0).toLocaleLowerCase('ru-RU') + title.slice(1);
      out.add(`как ${t0}?`);
      out.add(`не понимаю: ${title}`);
      out.add(`где в приложении ${t0}?`);
      out.add(`подскажи про ${t0}`);
    }
    for (const tag of tags.slice(0, 8)) {
      if (tag.length < 2) continue;
      out.add(`что такое «${tag}» в joy pick?`);
      out.add(`${tag} — как это работает?`);
    }
    if (title && tags[0]) {
      out.add(`${tags[0]} и ${title.toLocaleLowerCase('ru-RU')} — это про одно и то же?`);
    }
  } else {
    if (title) {
      const t0 = title.charAt(0).toLowerCase() + title.slice(1);
      out.add(`How do I ${t0}?`);
      out.add(`I don't understand: ${title}`);
      out.add(`Joy Pick — ${title}: what should I know?`);
      out.add(`Tell me about ${t0}`);
    }
    for (const tag of tags.slice(0, 8)) {
      if (tag.length < 2) continue;
      out.add(`What is "${tag}" in Joy Pick?`);
      out.add(`Explain ${tag} in the app`);
    }
    if (title && tags[0]) {
      out.add(`Is ${tags[0]} related to ${title.toLowerCase()}?`);
    }
  }

  return [...out].filter((q) => q.length >= 10 && q.length <= 500);
}

function loadChunks(locale) {
  const safe = locale === 'ru' ? 'ru' : 'en';
  const p = path.join(__dirname, '..', 'docs', 'knowledge', `support_${safe}`, 'chunks.json');
  const raw = fs.readFileSync(p, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x) => x && x.chunk_id && (x.title || (Array.isArray(x.tags) && x.tags.length)));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`
node scripts/run_support_rag_stress.js [флаги]
  --locale=ru|en
  --per-chunk=N
  --limit=N   (0 = без лимита)
  --seed=N
  --out=path  (по умолчанию tmp/rag_stress_last.json)
  --max-fail-print=N
`);
    process.exit(0);
  }

  const locale = opts.locale === 'en' ? 'en' : 'ru';
  const chunks = loadChunks(locale);
  if (!chunks.length) {
    console.error('Нет чанков для locale', locale);
    process.exit(1);
  }

  const pairs = [];
  for (const ch of chunks) {
    const variants = buildVariants(ch, locale);
    const take = variants.slice(0, opts.perChunk);
    for (const message of take) {
      pairs.push({ chunk_id: ch.chunk_id, message });
    }
  }

  const shuffled = shuffle(pairs, opts.seed);
  const limited = opts.limit > 0 ? shuffled.slice(0, opts.limit) : shuffled;

  let ok = 0;
  const failures = [];

  let i = 0;
  for (const row of limited) {
    i++;
    const preview = await previewSupportRetrieval({ message: row.message, locale });
    const chunkIds = preview.chunkIds || [];
    const hit = chunkIds.includes(row.chunk_id);
    if (hit) {
      ok++;
    } else {
      failures.push({
        chunk_id: row.chunk_id,
        message: row.message,
        top: chunkIds,
        effectiveQuestion: String(preview.effectiveQuestion || '').slice(0, 300)
      });
    }
    if (i % 500 === 0) {
      console.error(`… прогон ${i}/${limited.length}`);
    }
  }

  const fail = failures.length;
  const total = limited.length;
  console.log(`\nRAG stress: locale=${locale} total=${total} ok=${ok} fail=${fail} (${((100 * fail) / total).toFixed(2)}%)`);

  const outPath =
    opts.out ||
    path.join(__dirname, '..', 'tmp', 'rag_stress_last.json');
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        locale,
        seed: opts.seed,
        perChunk: opts.perChunk,
        limit: opts.limit,
        total,
        ok,
        fail,
        failures
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`Отчёт: ${outPath}`);

  const printN = Math.min(failures.length, opts.maxFailPrint);
  for (let j = 0; j < printN; j++) {
    const f = failures[j];
    console.error(`\nFAIL[${j + 1}] chunk=${f.chunk_id}`);
    console.error(`  Q: ${f.message}`);
    console.error(`  top: ${JSON.stringify(f.top)}`);
    console.error(`  effective: ${f.effectiveQuestion.slice(0, 180)}…`);
  }
  if (failures.length > printN) console.error(`\n… ещё ${failures.length - printN} падений в JSON`);

  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
