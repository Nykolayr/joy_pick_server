const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Инициализация Firebase Admin
const { initializeFirebase } = require('./config/firebase');
initializeFirebase();

const { errorHandler, notFound } = require('./middleware/errorHandler');

// Импорт маршрутов
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const requestRoutes = require('./routes/requests');
const donationRoutes = require('./routes/donations');
const participantRoutes = require('./routes/participants');
const partnerRoutes = require('./routes/partners');
const migrationRoutes = require('./routes/migration');

const app = express();

// CORS - разрешаем все домены
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With']
}));

// Обработка preflight OPTIONS запросов
app.options('*', cors());

// Парсинг JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Логирование запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// API маршруты
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/requests', requestRoutes);
app.use('/donations', donationRoutes);
app.use('/participants', participantRoutes);
app.use('/partners', partnerRoutes);
app.use('/migration', migrationRoutes);

// Базовый API маршрут
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Joy Pick API',
    version: '1.0.0',
    status: 'active',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      requests: '/api/requests',
      donations: '/api/donations',
      participants: '/api/participants',
      partners: '/api/partners',
      migration: '/api/migration',
      info: '/api/info',
      health: '/api/health'
    }
  });
});

// Информация о всех роутах
app.get('/info', (req, res) => {
  res.json({
    success: true,
    message: 'Список всех API роутов',
    server: 'Joy Pick Server',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      requests: '/api/requests',
      donations: '/api/donations',
      participants: '/api/participants',
      partners: '/api/partners',
      migration: '/api/migration',
      info: '/api/info',
      health: '/api/health',
      healthDb: '/api/health/db'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Проверка статуса БД
app.get('/health/db', async (req, res) => {
  try {
    const pool = require('./config/database');
    const [rows] = await pool.execute('SELECT VERSION() as version');
    const version = (rows[0] && rows[0].version) ? rows[0].version : 'Unknown';
    
    res.json({
      success: true,
      database: 'connected',
      databaseVersion: version.split('-')[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      database: 'disconnected',
      error: error.message
    });
  }
});

// Обработка 404
app.use('*', notFound);

// Обработка ошибок
app.use(errorHandler);

module.exports = app;
