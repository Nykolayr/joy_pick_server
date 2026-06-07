const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../../../data/vision_verdict_cache.json');
const CACHE_VERSION = '1';
const MAX_ENTRIES = Math.min(
  50000,
  Math.max(100, parseInt(process.env.INTEGRITY_VISION_CACHE_MAX_ENTRIES, 10) || 8000)
);
const TTL_MS =
  Math.max(0, parseInt(process.env.INTEGRITY_VISION_CACHE_TTL_DAYS, 10) || 30) * 24 * 60 * 60 * 1000;

let order = [];
let map = new Map();
let loaded = false;
let persistTimer = null;

function isCacheEnabled() {
  return process.env.INTEGRITY_VISION_CACHE !== '0' && process.env.INTEGRITY_VISION_CACHE !== 'false';
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const entries = Array.isArray(raw?.order) ? raw.order : [];
    const data = raw?.data && typeof raw.data === 'object' ? raw.data : {};
    const now = Date.now();
    for (const key of entries) {
      const row = data[key];
      if (!row || typeof row !== 'object') continue;
      if (TTL_MS > 0 && now - (row.ts || 0) > TTL_MS) continue;
      map.set(key, row);
      order.push(key);
    }
    while (order.length > MAX_ENTRIES) {
      const old = order.shift();
      map.delete(old);
    }
  } catch (e) {
    console.warn('[visionVerdictCache] load failed:', e.message);
    map = new Map();
    order = [];
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const dir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = {};
      for (const key of order) {
        const row = map.get(key);
        if (row) data[key] = row;
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify({ order, data }));
    } catch (e) {
      console.warn('[visionVerdictCache] persist failed:', e.message);
    }
  }, 400);
}

function buildCacheKey(task, model, contentSha256) {
  return `${task}:${CACHE_VERSION}:${model}:${contentSha256}`;
}

function getCachedVerdict(task, model, contentSha256) {
  if (!isCacheEnabled() || !contentSha256) return null;
  ensureLoaded();
  const key = buildCacheKey(task, model, contentSha256);
  const row = map.get(key);
  if (!row) return null;
  if (TTL_MS > 0 && Date.now() - (row.ts || 0) > TTL_MS) {
    map.delete(key);
    order = order.filter((k) => k !== key);
    return null;
  }
  order = order.filter((k) => k !== key);
  order.push(key);
  return row.result;
}

function setCachedVerdict(task, model, contentSha256, result) {
  if (!isCacheEnabled() || !contentSha256 || !result) return;
  if (result.verdict === 'skip') return;
  ensureLoaded();
  const key = buildCacheKey(task, model, contentSha256);
  map.set(key, { ts: Date.now(), result });
  order = order.filter((k) => k !== key);
  order.push(key);
  while (order.length > MAX_ENTRIES) {
    const old = order.shift();
    map.delete(old);
  }
  schedulePersist();
}

module.exports = {
  buildCacheKey,
  getCachedVerdict,
  setCachedVerdict,
  isCacheEnabled,
};
