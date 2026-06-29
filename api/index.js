const express = require('express');
const path = require('path');
const fs = require('fs');
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
const partnerAuthRoutes = require('./routes/partnerAuth');
const partnerAdminRoutes = require('./routes/partnerAdmin');
const partnerSellerRoutes = require('./routes/partnerSeller');
const recyclingStationsRoutes = require('./routes/recyclingStations');
const migrationRoutes = require('./routes/migration');
const notificationRoutes = require('./routes/notifications');
const wasteTypesRoutes = require('./routes/wasteTypes');
const referencesRoutes = require('./routes/references');
const cronRoutes = require('./routes/cron');
const chatRoutes = require('./routes/chats');
const stripeRoutes = require('./routes/stripe');
const paymentRoutes = require('./routes/payments');
const newsRoutes = require('./routes/news');
const newsAdminRoutes = require('./routes/newsAdmin');
const uploadRoutes = require('./routes/upload');
const earthdayCleanupsAdminRoutes = require('./routes/earthdayCleanupsAdmin');
const requestGalleryRoutes = require('./routes/requestGallery');
const landingRoutes = require('./routes/landing');
const supportRoutes = require('./routes/support');
const supportAiReviewAdminRoutes = require('./routes/supportAiReviewAdmin');
const requestsAdminRoutes = require('./routes/requestsAdmin');
const donationsAdminRoutes = require('./routes/donationsAdmin');

const app = express();

function parseAllowedOrigins() {
  const raw = process.env.CORS_ORIGIN || process.env.ADMIN_PANEL_ORIGIN || '*';
  if (raw === '*') return '*';
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins();
const corsOptions = {
  origin(origin, cb) {
    // Запросы без Origin (curl/postman/server-to-server) пропускаем
    if (!origin) return cb(null, true);
    if (allowedOrigins === '*') return cb(null, true);
    return cb(null, allowedOrigins.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Authorization',
    'Content-Type',
    'Accept',
    'X-Support-Guest-Id',
    'X-Support-Eval-Secret',
    'X-Support-Review-Agent-Secret'
  ],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Парсинг JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Логирование запросов убрано - все ошибки возвращаются в API ответе

// Соглашения — отдача HTML (доступно по /api/terms-of-service и /api/privacy-policy)
const legalDir = path.join(__dirname, '..', 'legal');
app.get('/terms-of-service', (req, res) => {
  fs.readFile(path.join(legalDir, 'terms-of-service.html'), 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error loading page');
    res.type('html').send(data);
  });
});
app.get('/privacy-policy', (req, res) => {
  fs.readFile(path.join(legalDir, 'privacy-policy.html'), 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error loading page');
    res.type('html').send(data);
  });
});

// Корень API (как у recycling-stations — без admin в пути)
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Joy Pick API. News: GET/POST /news, PUT/DELETE /news/:id (admin).',
    endpoints: { news: '/news', auth: '/auth', users: '/users', requests: '/requests', recyclingStations: '/recycling-stations' }
  });
});

// API маршруты
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/requests', requestRoutes);
app.use('/donations', donationRoutes);
app.use('/participants', participantRoutes);
app.use('/partners', partnerRoutes);
app.use('/partner-auth', partnerAuthRoutes);
app.use('/partner-admin', partnerAdminRoutes);
app.use('/partner-seller', partnerSellerRoutes);
app.use('/recycling-stations', recyclingStationsRoutes);
app.use('/migration', migrationRoutes);
app.use('/notifications', notificationRoutes);
app.use('/waste-types', wasteTypesRoutes);
app.use('/references', referencesRoutes);
app.use('/cron', cronRoutes);
app.use('/chats', chatRoutes);
app.use('/stripe', stripeRoutes);
app.use('/stripe-admin', require('./routes/stripeAdmin'));
app.use('/payments', paymentRoutes);
app.use('/news', newsRoutes);
app.use('/news-admin', newsAdminRoutes);
app.use('/upload', uploadRoutes);
app.use('/earthday-cleanups-admin', earthdayCleanupsAdminRoutes);
app.use('/request-gallery', requestGalleryRoutes);
app.use('/landing', landingRoutes);
app.use('/support', supportRoutes);
app.use('/admin/support-ai-reviews', supportAiReviewAdminRoutes);
app.use('/admin/requests', requestsAdminRoutes);
app.use('/admin/donations', donationsAdminRoutes);

// Middleware для обработки ошибок в API маршрутах (до общего errorHandler)
app.use((err, req, res, next) => {
  // Если ответ уже отправлен, передаем ошибку дальше
  if (res.headersSent) {
    return next(err);
  }

  // ВСЕГДА возвращаем детальную информацию об ошибке в API ответе
  const errorResponse = {
    success: false,
    message: err.message || 'Internal server error',
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
    error: err.message,
    errorName: err.name,
    errorDetails: {
      message: err.message,
      name: err.name,
      code: err.code,
      sql: err.sql,
      sqlMessage: err.sqlMessage,
      errno: err.errno,
      sqlState: err.sqlState
    }
  };
  
  // Для ошибок базы данных добавляем больше информации
  if (err.sqlMessage) {
    errorResponse.sqlMessage = err.sqlMessage;
  }
  if (err.sql) {
    errorResponse.sql = err.sql;
  }
  if (err.code) {
    errorResponse.errorCode = err.code;
  }
  
  // Stack trace всегда в ответе (для диагностики)
  if (err.stack) {
    errorResponse.stack = err.stack;
  }

  res.status(err.status || 500).json(errorResponse);
});

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
      partnerAuth: '/api/partner-auth',
      partnerAdmin: '/api/partner-admin',
      partnerSeller: '/api/partner-seller',
      recyclingStations: '/api/recycling-stations',
      migration: '/api/migration',
      notifications: '/api/notifications',
      wasteTypes: '/api/waste-types',
      references: '/api/references',
      chats: '/api/chats',
      stripe: '/api/stripe',
      stripeAdmin: '/api/stripe-admin',
      payments: '/api/payments',
      news: '/api/news',
      info: '/api/info',
      health: '/api/health'
    }
  });
});

// Информация о всех роутах
app.get('/info', (req, res) => {
  res.json({
    success: true,
    message: 'List of all API routes',
    server: 'Joy Pick Server',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      requests: '/api/requests',
      donations: '/api/donations',
      participants: '/api/participants',
      partners: '/api/partners',
      partnerAuth: '/api/partner-auth',
      partnerAdmin: '/api/partner-admin',
      partnerSeller: '/api/partner-seller',
      recyclingStations: '/api/recycling-stations',
      migration: '/api/migration',
      notifications: '/api/notifications',
      wasteTypes: '/api/waste-types',
      references: '/api/references',
      chats: '/api/chats',
      cron: '/api/cron',
      stripe: '/api/stripe',
      stripeAdmin: '/api/stripe-admin',
      payments: '/api/payments',
      news: '/api/news',
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

     // Тестовый endpoint для проверки Socket.io напрямую
     app.get('/test-socket', (req, res) => {
       try {
         const io = req.app.get('io');
         if (!io) {
           return res.status(500).json({
             success: false,
             message: 'Socket.io not initialized'
           });
         }
         
         // Проверяем, может ли Socket.io обработать запрос
         res.json({
           success: true,
           message: 'Socket.io is available',
           socket: {
             path: io.path,
             transports: io.opts?.transports,
             connected: io.sockets.sockets.size
           },
           test: 'Try connecting via Socket.io client'
         });
       } catch (error) {
         res.status(500).json({
           success: false,
           message: 'Error checking Socket.io',
           error: error.message
         });
       }
     });

     // Диагностика Socket.io
     app.get('/health/socket', (req, res) => {
       try {
         const io = req.app.get('io');
         if (!io) {
           return res.status(500).json({
             success: false,
message: 'Socket.io not initialized',
            error: 'Socket.io server not found in app'
           });
         }
         
         // Проверяем, обрабатывает ли Socket.io запросы
         const engine = io.engine;
         const connectedSockets = io.sockets.sockets.size;
         
         res.json({
           success: true,
           socket: {
             connected: connectedSockets,
             engineClients: engine.clientsCount || 0,
             path: io.path || '/socket.io/',
             transports: io.opts?.transports || [],
             cors: io.opts?.cors || {},
             allowEIO3: io.opts?.allowEIO3 || false,
             serveClient: io.opts?.serveClient !== false
           },
           engine: {
             clientsCount: engine.clientsCount || 0,
             upgradeTimeout: engine.upgradeTimeout || 0,
             pingTimeout: engine.pingTimeout || 0,
             pingInterval: engine.pingInterval || 0
           },
           timestamp: new Date().toISOString()
         });
       } catch (error) {
         res.status(500).json({
           success: false,
           message: 'Error checking Socket.io',
           error: error.message,
           errorDetails: {
             name: error.name,
             stack: error.stack
           }
         });
       }
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
