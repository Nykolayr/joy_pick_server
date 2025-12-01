const express = require('express');
const path = require('path');
const cron = require('node-cron');
require('dotenv').config();

// Импорт API
const apiApp = require('./api');
const { runAllCronTasks } = require('./scripts/cronTasks');

const app = express();

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
    // Ошибка сохраняется в файл через runAllCronTasks
  }
});

const port = process.env.PORT || 3000;
app.listen(port);

module.exports = app;
