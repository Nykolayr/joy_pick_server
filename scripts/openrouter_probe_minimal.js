const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const k = process.env.OPENROUTER_API_KEY;
  const body = {
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Joy Pick. Кратко по-русски.' },
      { role: 'user', content: 'как убрать мусор во дворе?' }
    ],
    max_tokens: Number(process.argv[2] || 64)
  };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  console.log('status', res.status);
  if (json.error) console.log('error', json.error.message);
  else console.log('answer', (json.choices?.[0]?.message?.content || '').slice(0, 300));
}

main().catch(console.error);
