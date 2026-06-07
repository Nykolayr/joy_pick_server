const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function probe(label, payload) {
  const k = process.env.OPENROUTER_API_KEY;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  console.log('---', label, 'status', res.status);
  if (json.error) console.log('error', json.error.message);
  else console.log('answer', (json.choices?.[0]?.message?.content || '').slice(0, 120));
}

async function main() {
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
  const base = {
    model,
    messages: [
      { role: 'system', content: 'Joy Pick support. Answer briefly in Russian.' },
      { role: 'user', content: 'что такое joy pick?' }
    ],
    max_tokens: 120,
    temperature: 0.2
  };
  await probe('minimal', base);
  await probe('session', { ...base, session_id: `support-eval-${crypto.randomUUID()}` });
  await probe('plugin', {
    ...base,
    session_id: `support-eval-${crypto.randomUUID()}`,
    plugins: [{ id: 'context-compression' }]
  });
  const only = process.env.OPENROUTER_PROVIDER_ONLY;
  if (only) {
    await probe('provider', {
      ...base,
      provider: { order: [only], allow_fallbacks: false }
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
