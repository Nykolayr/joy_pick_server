const http = require('http');
const https = require('https');

const realtimeMetrics = {
  socketEmitAttempts: 0,
  socketEmitSuccess: 0,
  externalEmitAttempts: 0,
  externalEmitSuccess: 0,
  externalEmitSkippedCanary: 0,
  externalEmitSkippedDisabled: 0,
  externalEmitErrors: 0,
  externalPreferredFallbackToLocal: 0,
  externalOnlyDrops: 0
};

const realtimePreflightState = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastStatus: 'never',
  lastError: null,
  lastCheckedUrl: null
};

function isEnabled(value, defaultValue = true) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseCommaSeparatedList(value) {
  if (value === undefined || value === null) return [];
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function clampPercent(value, defaultValue) {
  const n = Number(value);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function hashStringToPercent(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

function getRealtimeRoutingSnapshot() {
  const sseEnabled = isEnabled(process.env.REALTIME_SSE_ENABLED, true);
  const socketEnabled = isEnabled(process.env.REALTIME_SOCKET_ENABLED, true);
  const externalWssEnabled = isEnabled(process.env.REALTIME_EXTERNAL_WSS_ENABLED, false);
  const externalWssTimeoutMs = Number(process.env.REALTIME_EXTERNAL_WSS_TIMEOUT_MS) || 1500;
  const externalWssUrl = process.env.REALTIME_EXTERNAL_WSS_URL || '';
  const externalWssCanaryChatIds = parseCommaSeparatedList(process.env.REALTIME_EXTERNAL_WSS_CANARY_CHAT_IDS);
  const externalWssCanaryPercent = clampPercent(process.env.REALTIME_EXTERNAL_WSS_CANARY_PERCENT, 0);
  const mode = process.env.REALTIME_TRANSPORT_MODE || 'hybrid';

  return {
    mode,
    sseEnabled,
    socketEnabled,
    externalWssEnabled,
    externalWssTimeoutMs,
    externalWssUrl,
    externalWssCanaryChatIds,
    externalWssCanaryPercent
  };
}

function emitSocketChatEvent(req, chatId, eventName, payload) {
  realtimeMetrics.socketEmitAttempts += 1;
  const { socketEnabled } = getRealtimeRoutingSnapshot();
  if (!socketEnabled) {
    return false;
  }

  const mainApp = req && req.app ? req.app : null;
  const io = mainApp ? mainApp.get('io') : null;
  if (!io) {
    return false;
  }

  io.to(`chat:${chatId}`).emit(eventName, payload);
  realtimeMetrics.socketEmitSuccess += 1;
  return true;
}

function postJsonWithTimeout(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = Buffer.from(JSON.stringify(body));
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
          return;
        }
        reject(new Error(`External WSS emitter returned ${res.statusCode || 'unknown'}`));
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('External WSS emitter timeout'));
    });
    req.write(data);
    req.end();
  });
}

function getWithTimeout(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      { method: 'GET' },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
          return;
        }
        reject(new Error(`External WSS preflight returned ${res.statusCode || 'unknown'}`));
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('External WSS preflight timeout'));
    });
    req.end();
  });
}

function shouldEmitExternalForChat(chatId, snapshot) {
  if (!chatId) return false;
  const chatIdStr = String(chatId);

  if (snapshot.externalWssCanaryChatIds.includes(chatIdStr)) {
    return true;
  }

  if (snapshot.externalWssCanaryPercent >= 100) {
    return true;
  }
  if (snapshot.externalWssCanaryPercent <= 0) {
    return false;
  }

  const bucket = hashStringToPercent(chatIdStr);
  return bucket < snapshot.externalWssCanaryPercent;
}

async function emitExternalChatShadowEvent(chatId, eventName, payload) {
  const snapshot = getRealtimeRoutingSnapshot();
  const { externalWssEnabled, externalWssUrl, externalWssTimeoutMs, mode } = snapshot;

  if (!externalWssEnabled || !externalWssUrl) {
    realtimeMetrics.externalEmitSkippedDisabled += 1;
    return false;
  }
  if (!shouldEmitExternalForChat(chatId, snapshot)) {
    realtimeMetrics.externalEmitSkippedCanary += 1;
    return false;
  }

  const url = externalWssUrl.endsWith('/')
    ? `${externalWssUrl}emit`
    : `${externalWssUrl}/emit`;

  const requestBody = {
    chatId,
    eventName,
    payload,
    mode,
    emittedAt: new Date().toISOString()
  };

  const secret = process.env.REALTIME_EXTERNAL_WSS_SECRET;
  if (secret && typeof secret === 'string') {
    requestBody.signature = secret;
  }

  realtimeMetrics.externalEmitAttempts += 1;
  try {
    await postJsonWithTimeout(url, requestBody, externalWssTimeoutMs);
    realtimeMetrics.externalEmitSuccess += 1;
    return true;
  } catch (err) {
    realtimeMetrics.externalEmitErrors += 1;
    throw err;
  }
}

function markExternalPreferredFallback() {
  realtimeMetrics.externalPreferredFallbackToLocal += 1;
}

function markExternalOnlyDrop() {
  realtimeMetrics.externalOnlyDrops += 1;
}

function getRealtimeMetricsSnapshot() {
  return { ...realtimeMetrics };
}

function getRealtimePreflightSnapshot() {
  return { ...realtimePreflightState };
}

async function runRealtimeExternalPreflight() {
  const snapshot = getRealtimeRoutingSnapshot();
  const { externalWssEnabled, externalWssUrl, externalWssTimeoutMs } = snapshot;
  realtimePreflightState.lastAttemptAt = new Date().toISOString();

  if (!externalWssEnabled || !externalWssUrl) {
    realtimePreflightState.lastStatus = 'skipped';
    realtimePreflightState.lastError = null;
    realtimePreflightState.lastCheckedUrl = externalWssUrl || null;
    return false;
  }

  const healthUrl = externalWssUrl.endsWith('/')
    ? `${externalWssUrl}health`
    : `${externalWssUrl}/health`;
  realtimePreflightState.lastCheckedUrl = healthUrl;

  try {
    await getWithTimeout(healthUrl, externalWssTimeoutMs);
    realtimePreflightState.lastStatus = 'ok';
    realtimePreflightState.lastError = null;
    realtimePreflightState.lastSuccessAt = new Date().toISOString();
    return true;
  } catch (err) {
    realtimePreflightState.lastStatus = 'error';
    realtimePreflightState.lastError = err && err.message ? err.message : 'Unknown preflight error';
    return false;
  }
}

module.exports = {
  getRealtimeRoutingSnapshot,
  getRealtimeMetricsSnapshot,
  getRealtimePreflightSnapshot,
  runRealtimeExternalPreflight,
  markExternalPreferredFallback,
  markExternalOnlyDrop,
  emitSocketChatEvent,
  emitExternalChatShadowEvent
};
