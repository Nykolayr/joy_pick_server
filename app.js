require('dotenv').config();

// Passenger (Beget): путь к node задаётся через PASSENGER_NODEJS_BIN в .env
// или переменной окружения на стороне хостинга; захардкоженных путей нет.
if (process.env.PASSENGER_NODEJS_BIN) {
  process.env.PASSENGER_NODEJS = process.env.PASSENGER_NODEJS_BIN;
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Server } = require('socket.io');
// Импорт API (явно index.js — иначе на части хостингов "Cannot find module './api'" )
const apiApp = require('./api/index');
const { runAllCronTasks } = require('./scripts/cronTasks');
const { renderAppOpenLandingPage } = require('./api/utils/deeplinkLanding');
const { runRealtimeExternalPreflight } = require('./api/utils/realtimeRouting');

const app = express();

const publishDir = path.join(__dirname, 'publish');
// Flutter `build/web/` кладёте в publish/*/web/ (как на диске после сборки)
const publishSiteDir = path.join(publishDir, 'site', 'web');
const publishAdminDir = path.join(publishDir, 'admin', 'web');
const publishSiteIndex = path.join(publishSiteDir, 'index.html');
const publishAdminIndex = path.join(publishAdminDir, 'index.html');

function safeSendFile(res, filePath) {
  return res.sendFile(filePath, (err) => {
    if (!err) return;
    res.status(500).type('text/plain').send(`Failed to send file: ${filePath}`);
  });
}

// КРИТИЧЕСКИ ВАЖНО: Для Passenger на Beget
// Passenger сам создает HTTP сервер, нам нужно получить его через app.listen
// Но Passenger перехватывает app.listen, поэтому создаем сервер явно
let server;
let io;

// КРИТИЧЕСКИ ВАЖНО: Для Passenger на Beget
// Passenger сам создает HTTP сервер и передает его через app.listen
// НО: app.listen возвращает сервер, который Passenger использует
const port = process.env.PORT || 300
server = app.listen(port);

// Инициализация Socket.io
// КРИТИЧЕСКИ ВАЖНО: Для Passenger на Beget используем ТОЛЬКО polling
// WebSocket не работает через прокси Passenger
// ВАЖНО: Socket.io должен быть инициализирован ПОСЛЕ создания сервера
// Используем настройки из примера для Beget
io = new Server(server, {
  // Важно для прокси и Passenger (из примера)
  transports: ['polling'], // ТОЛЬКО polling для Passenger на Beget
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type']
  },
  path: '/socket.io/', // Путь для Socket.io
  pingTimeout: 60000, // Таймаут для ping (60 секунд)
  pingInterval: 25000, // Интервал ping (25 секунд)
  connectTimeout: 60000, // Таймаут подключения (60 секунд)
  allowEIO3: false, // Отключаем EIO3, используем только EIO4
  serveClient: false, // Не отдаем клиентскую библиотеку Socket.io
  // КРИТИЧЕСКИ ВАЖНО: Для Passenger отключаем upgrade
  allowUpgrades: false, // Запрещаем upgrade на WebSocket (только polling)
  // КРИТИЧЕСКИ ВАЖНО: Увеличиваем таймауты для Passenger
  httpCompression: false // Отключаем сжатие для совместимости с Passenger
});

// Подключаем Socket.io обработчики
require('./api/socket')(io);

// Сохраняем io в app для доступа из роутов
app.set('io', io);

// Неблокирующий preflight внешнего realtime-emitter (если включён в env).
runRealtimeExternalPreflight().catch(() => {});

// Подключаем API ПЕРВЫМ (до статических файлов!)
app.use('/api', apiApp);

// Stripe callback (до статических файлов, чтобы не перехватывалось)
const stripeCallbackRoutes = require('./api/routes/stripeCallback');
app.use('/stripeCallback', stripeCallbackRoutes);

// Соглашения — статичная отдача HTML по запросу (файлы в legal/)
const legalDir = path.join(__dirname, 'legal');
app.get('/terms-of-service', (req, res) => {
  const file = path.join(legalDir, 'terms-of-service.html');
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error loading page');
    res.type('html').send(data);
  });
});
app.get('/privacy-policy', (req, res) => {
  const file = path.join(legalDir, 'privacy-policy.html');
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error loading page');
    res.type('html').send(data);
  });
});

// Логотип для писем (app_logo.png в корне проекта)
app.get('/email-logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'app_logo.png'));
});

// Диплинки: HTML-страница — пробуем joypick:// + кнопки App Store / Google Play (см. api/utils/deeplinkLanding.js)
const DEEPLINK_CATEGORIES = ['waste_location', 'speed_cleanup', 'event'];
const DEEPLINK_CATEGORY_ALIASES = {
  clean: 'speed_cleanup',
  speedcleanup: 'speed_cleanup',
  'speed-cleanup': 'speed_cleanup'
};
app.get('/request/:category/:requestId', (req, res) => {
  const { category, requestId } = req.params;
  const rawCategory = String(category || '').trim().toLowerCase();
  const normalizedCategory = DEEPLINK_CATEGORY_ALIASES[rawCategory] || rawCategory;
  const safeRequestId = String(requestId || '').trim();
  if (!normalizedCategory || !safeRequestId) {
    console.warn('[deeplink][request] invalid params', {
      originalUrl: req.originalUrl,
      path: req.path,
      category: rawCategory,
      requestId
    });
    return res.status(404).type('text/plain').send('Not found');
  }
  if (!DEEPLINK_CATEGORIES.includes(normalizedCategory)) {
    console.warn('[deeplink][request] unsupported category', {
      originalUrl: req.originalUrl,
      path: req.path,
      rawCategory,
      category: normalizedCategory,
      requestId: safeRequestId
    });
    return res.status(404).type('text/plain').send('Not found');
  }
  const appScheme = `joypick://request/${encodeURIComponent(normalizedCategory)}/${encodeURIComponent(safeRequestId)}`;
  console.info('[deeplink][request] render', {
    originalUrl: req.originalUrl,
    path: req.path,
    rawCategory,
    category: normalizedCategory,
    requestId: safeRequestId,
    appScheme
  });
  const html = renderAppOpenLandingPage({
    appScheme,
    acceptLanguage: req.get('accept-language'),
    page: 'request',
    pageUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
  });
  res.type('html').send(html);
});
app.get('/news/:newsId', (req, res) => {
  const { newsId } = req.params;
  if (!newsId) {
    return res.redirect(302, '/');
  }
  const appScheme = `joypick://news/${encodeURIComponent(newsId)}`;
  const html = renderAppOpenLandingPage({
    appScheme,
    acceptLanguage: req.get('accept-language'),
    page: 'news'
  });
  res.type('html').send(html);
});

// Статические файлы - загруженные файлы (фото, аватары и т.д.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Flutter Web / static publish folders (содержимое build/web/):
// - publish/site/web  -> сайт на "/"
// - publish/admin/web -> админка на "/admin/"

// Admin static assets (JS/CSS) must live under /admin/*
app.use(
  '/admin',
  express.static(publishAdminDir, {
    index: false,
    fallthrough: true
  })
);

// Admin SPA (Flutter web): serve index.html for navigation routes under /admin/*
app.use('/admin', (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (res.headersSent) return next();

  // Внутри app.use('/admin', ...) у Express req.path уже без префикса /admin:
  // для URL /admin/ здесь p === '/', редирект на /admin/ давал бесконечный цикл.
  const p = req.path || '/';

  // Let real files be handled by express.static above (or return 404 for missing assets)
  if (path.extname(p)) return next();

  if (!fs.existsSync(publishAdminIndex)) {
    return res
      .status(503)
      .type('text/plain')
      .send(
        'Admin UI is not published yet. Put your Flutter web build output into publish/admin/web/ (must include index.html).'
      );
  }

  return safeSendFile(res, publishAdminIndex);
});

// Public site static assets under "/" (из publish/site/web/)
app.use(express.static(publishSiteDir, { index: false, fallthrough: true }));

// Old server status page (was previously served at "/")
app.get('/server-status', (_req, res) => {
  safeSendFile(res, path.join(__dirname, 'web', 'server-status.html'));
});

// Public site SPA (Flutter web) — fallback for client-side routes
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();

  const p = req.path || '/';
  if (
    p.startsWith('/api') ||
    p.startsWith('/socket.io') ||
    p.startsWith('/uploads') ||
    p.startsWith('/stripeCallback') ||
    p.startsWith('/admin') ||
    p.startsWith('/news/') ||
    p.startsWith('/terms-of-service') ||
    p.startsWith('/privacy-policy') ||
    p.startsWith('/email-logo.png') ||
    p.startsWith('/server-status')
  ) {
    return next();
  }

  // Don't swallow obvious static file requests (if you add /foo.js at repo root, it won't be served anyway)
  if (path.extname(p)) return next();

  // Deeplink HTML routes are registered above as explicit handlers
  if (p.startsWith('/request/') || p.startsWith('/news/')) return next();

  if (!fs.existsSync(publishSiteIndex)) {
    return res.status(503).type('text/plain').send('Site is not published yet. Add publish/site/web/index.html');
  }
  return safeSendFile(res, publishSiteIndex);
});

// Настройка cron задач через node-cron
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '*/5 * * * *';

cron.schedule(CRON_SCHEDULE, async () => {
  try {
    await runAllCronTasks();
  } catch (error) {
    // Ошибки возвращаются в JSON через API, не логируем в файлы
  }
});

// КРИТИЧЕСКИ ВАЖНО: Для Passenger на Beget НЕ вызываем server.listen
// Passenger сам управляет портом и сервером через app
// Для локальной разработки server уже запущен через app.listen выше

// Экспортируем app для Passenger
module.exports = app;
