const express = require('express');
const path = require('path');
require('dotenv').config();

// Импорт API
const apiApp = require('./api');

const app = express();

// Подключаем API ПЕРВЫМ (до статических файлов!)
app.use('/api', apiApp);

// Статические файлы из папки web
app.use(express.static(path.join(__dirname, 'web')));

// Основной роут - админ панель из папки web
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

// Для Passenger нужно слушать порт
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Joy Pick Server running on port ${port}`);
  console.log(`📡 API доступен по адресу: http://localhost:${port}/api`);
  console.log(`💚 Проверка здоровья: http://localhost:${port}/api/health`);
});

module.exports = app;
