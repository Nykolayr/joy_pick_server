#!/usr/bin/env node
/**
 * Прозрачный HTTP-прокси на новый бэкенд (Beget + Passenger).
 * Клиенты остаются на прежнем origin — без редиректов 302/307, которые ломают часть клиентов.
 *
 * Выкладка:
 *   1. На стороне Apache не отдавайте /api, /uploads и т.п. RewriteRule раньше, чем запрос попадёт в Node.
 *   2. В .htaccess включите Passenger и укажите этот файл как PassengerStartupFile (см. legacy-proxy-passenger.htaccess.example).
 *   3. Целевой хост: LEGACY_PROXY_TARGET или по умолчанию https://joypick.world
 *
 * Ограничение: WebSocket upgrade для Socket.io через этот скрипт не проксируется; long polling обычно ок.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const TARGET = process.env.LEGACY_PROXY_TARGET || 'https://joypick.world';
const targetUrl = new URL(TARGET);
const upstreamHost = targetUrl.hostname;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host'
]);

function filterHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const lower = k.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    out[k] = v;
  }
  out.Host = upstreamHost;
  return out;
}

const server = http.createServer((clientReq, clientRes) => {
  const u = new URL(clientReq.url || '/', `http://${upstreamHost}`);
  const pathAndQuery = (u.pathname || '/') + (u.search || '');

  const opts = {
    hostname: upstreamHost,
    path: pathAndQuery,
    method: clientReq.method,
    headers: filterHeaders(clientReq.headers),
    rejectUnauthorized: true
  };
  if (targetUrl.port) opts.port = Number(targetUrl.port);

  const proxyReq = https.request(opts, (proxyRes) => {
    const resHeaders = { ...proxyRes.headers };
    for (const h of HOP_BY_HOP) {
      delete resHeaders[h];
      delete resHeaders[h.toLowerCase()];
    }
    clientRes.writeHead(proxyRes.statusCode || 502, resHeaders);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (err) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    clientRes.end(`Upstream error: ${err.message}`);
  });

  clientReq.pipe(proxyReq);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`legacy-transparent-proxy → ${TARGET} on port ${port}`);
});
