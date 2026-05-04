/**
 * То же, что run_support_eval_direct.js, но с AI_SUPPORT_OPENROUTER_FIRST=true
 * (удобно при недоступности Gemini по региону — нужен OPENROUTER_API_KEY в .env).
 */
process.env.AI_SUPPORT_OPENROUTER_FIRST = 'true';
require('./run_support_eval_direct.js');
