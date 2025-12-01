const mysql = require('mysql2/promise');
require('dotenv').config();

// Создание пула соединений с базой данных
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'autogie1_joypick',
  password: process.env.DB_PASSWORD || 'tvU29B%rm%VC',
  database: process.env.DB_NAME || 'autogie1_joypick',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+00:00' // Устанавливаем UTC для всех подключений
});

// Тест подключения
pool.getConnection()
  .then(connection => {
    console.log('✅ Подключение к базе данных установлено');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Ошибка подключения к базе данных:', err.message);
  });

module.exports = pool;

