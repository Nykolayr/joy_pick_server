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
// Запускается каждые 5 минут (для тестирования, потом вернем на каждый час)
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '*/5 * * * *'; // По умолчанию каждые 5 минут

console.log(`⏰ Настройка cron задач с расписанием: ${CRON_SCHEDULE}`);

cron.schedule(CRON_SCHEDULE, async () => {
  console.log(`\n🔄 Автоматический запуск cron задач: ${new Date().toISOString()}`);
  try {
    await runAllCronTasks();
  } catch (error) {
    console.error('❌ Ошибка выполнения cron задач:', error);
  }
});

console.log(`✅ Cron задачи настроены и будут запускаться автоматически`);

// Для Passenger нужно слушать порт
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Joy Pick Server running on port ${port}`);
  console.log(`📡 API доступен по адресу: http://localhost:${port}/api`);
  console.log(`💚 Проверка здоровья: http://localhost:${port}/api/health`);
  console.log(`⏰ Cron задачи запускаются каждые 5 минут (для тестирования)`);
});

module.exports = app;
