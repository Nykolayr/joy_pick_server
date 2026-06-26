/**
 * GET /api/v1/key — баланс и лимиты ключа OpenRouter (без утечки ключа).
 */
async function fetchOpenRouterKeyStatus(apiKey) {
  const key = String(apiKey || process.env.OPENROUTER_API_KEY || '').trim();
  if (!key) {
    return {
      configured: false,
      error: 'OPENROUTER_API_KEY is not configured'
    };
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${key}` }
    });
    const json = await res.json().catch(() => ({}));
    const d = json?.data || {};
    if (!res.ok) {
      return {
        configured: true,
        http_status: res.status,
        error: json?.error?.message || `OpenRouter key API HTTP ${res.status}`
      };
    }
    return {
      configured: true,
      http_status: res.status,
      label: d.label || null,
      limit: d.limit ?? null,
      limit_remaining: d.limit_remaining ?? null,
      limit_reset: d.limit_reset || null,
      usage_monthly: d.usage_monthly ?? null,
      is_free_tier: d.is_free_tier ?? null
    };
  } catch (e) {
    return {
      configured: true,
      error: e.message || 'OpenRouter key API failed'
    };
  }
}

module.exports = {
  fetchOpenRouterKeyStatus
};
