// Логирование для диагностики
console.log('=== App.js загружается ===');
console.log('Node version:', process.version);
console.log('Current directory:', __dirname);

const express = require('express');
console.log('Express загружен');

try {
  require('dotenv').config();
  console.log('Dotenv загружен');
} catch (e) {
  console.log('Ошибка dotenv (игнорируем):', e.message);
}

const app = express();
console.log('Express app создан');

// Тестовый endpoint для проверки работы
app.get('/test', (req, res) => {
  console.log('=== /test endpoint вызван ===');
  try {
    res.json({
      success: true,
      message: 'App.js работает!',
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      env: process.env.NODE_ENV || 'not set',
      dir: __dirname
    });
  } catch (error) {
    console.error('Ошибка в /test:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// Корневой путь тоже должен работать
app.get('/', (req, res) => {
  console.log('=== / endpoint вызван ===');
  res.json({
    success: true,
    message: 'Root endpoint работает!',
    timestamp: new Date().toISOString()
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  res.status(500).json({
    success: false,
    error: err.message,
    stack: err.stack
  });
});

console.log('=== App.js готов к экспорту ===');

// Экспортируем app для Passenger
module.exports = app;

console.log('=== App.js экспортирован ===');
