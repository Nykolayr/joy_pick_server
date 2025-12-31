// КРИТИЧЕСКИ ВАЖНО: Указываем путь к Node.js для Passenger (должно быть ПЕРВОЙ строкой!)
process.env.PASSENGER_NODEJS = '/home/a/autogie1/danilagames.ru/node-v18.19.0-linux-x64/bin/node';

const express = require('express');
const http = require('http');
const path = require('path');
const cron = require('node-cron');
const { Server } = require('socket.io');
require('dotenv').config();

// Импорт API
const apiApp = require('./api');
const { runAllCronTasks } = require('./scripts/cronTasks');

const app = express();

// КРИТИЧЕСКИ ВАЖНО: Для Passenger на Beget
// Passenger сам создает HTTP сервер, нам нужно получить его через app.listen
// Но Passenger перехватывает app.listen, поэтому создаем сервер явно
let server;
let io;

// КРИТИЧЕСКИ ВАЖНО: Для Passenger на Beget
// Passenger сам создает HTTP сервер и передает его через app.listen
// НО: app.listen возвращает сервер, который Passenger использует
const port = process.env.PORT || 3000;
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

// Подключаем API ПЕРВЫМ (до статических файлов!)
app.use('/api', apiApp);

// Stripe callback (до статических файлов, чтобы не перехватывалось)
const stripeCallbackRoutes = require('./api/routes/stripeCallback');
app.use('/stripeCallback', stripeCallbackRoutes);

// Статические файлы - загруженные файлы (фото, аватары и т.д.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Статические файлы из папки web
app.use(express.static(path.join(__dirname, 'web')));

// Основной роут - админ панель из папки web
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
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
