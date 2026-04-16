const mysql = require('mysql2/promise');
require('dotenv').config();

// Пул: при 10 соединениях параллельные чаты/крон легко выстраиваются в очередь (waitForConnections),
// из‑за чего REST к чатам «висит» без больших таблиц. Размер пула: DB_POOL_CONNECTION_LIMIT или DB_CONNECTION_LIMIT (5…100), иначе 30.
const parsedPoolLimit = parseInt(
  process.env.DB_POOL_CONNECTION_LIMIT || process.env.DB_CONNECTION_LIMIT || '',
  10
);
const connectionLimit = Number.isFinite(parsedPoolLimit)
  ? Math.min(100, Math.max(5, parsedPoolLimit))
  : 30;

function buildMysqlSslOption() {
  const raw = process.env.DB_SSL;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return undefined;
  }
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') {
    return false;
  }
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') {
    return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== '0' };
  }
  return undefined;
}

// Создание пула соединений с базой данных
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'autogie1_joypick',
  password: process.env.DB_PASSWORD || 'tvU29B%rm%VC',
  database: process.env.DB_NAME || 'autogie1_joypick',
  waitForConnections: true,
  connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+00:00', // Устанавливаем UTC для всех подключений
  ssl: buildMysqlSslOption()
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

