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

// Создаем HTTP сервер из Express app для Socket.io
// Для Passenger: используем app.listen для получения сервера
// Passenger перехватывает app.listen и использует свой сервер
const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  // Passenger перехватывает этот вызов, но сервер все равно создается
});

// Инициализация Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['polling', 'websocket'], // polling - основной транспорт для Passenger
  allowEIO3: true // Поддержка старых клиентов
});

// Подключаем Socket.io обработчики
require('./api/socket')(io);

// Сохраняем io в app для доступа из роутов
app.set('io', io);

// Сохраняем io в app для доступа из роутов
app.set('io', io);

// Подключаем API ПЕРВЫМ (до статических файлов!)
app.use('/api', apiApp);

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
