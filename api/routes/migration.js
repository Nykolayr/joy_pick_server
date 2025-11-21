const express = require('express');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { generateToken } = require('../utils/jwt');
const bcrypt = require('bcryptjs');

const router = express.Router();

/**
 * GET /api/migration/token
 * Получение универсального токена администратора для миграции
 * Требует секретный ключ MIGRATION_SECRET из .env
 */
router.get('/token', async (req, res) => {
  try {
    const { secret } = req.query;
    const migrationSecret = process.env.MIGRATION_SECRET || 'migration-secret-key-change-in-production';

    if (secret !== migrationSecret) {
      return error(res, 'Неверный секретный ключ', 401);
    }

    // Генерируем универсальный токен администратора
    const adminToken = generateToken({
      userId: 'migration-admin',
      email: 'migration@system.local',
      uid: 'migration-uid',
      isAdmin: true
    });

    return success(res, {
      token: adminToken,
      message: 'Токен администратора для миграции',
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      note: 'Используйте этот токен для всех запросов миграции. Сохраните его безопасно!'
    }, 200);
  } catch (err) {
    console.error('Ошибка генерации токена миграции:', err);
    return error(res, 'Ошибка при генерации токена: ' + err.message, 500);
  }
});

/**
 * Middleware для проверки секретного ключа миграции
 * Альтернатива авторизации для процесса миграции
 */
function checkMigrationSecret(req, res, next) {
  const secret = req.headers['x-migration-secret'] || req.query.secret;
  const migrationSecret = process.env.MIGRATION_SECRET || 'migration-secret-key-change-in-production';

  // Если передан секретный ключ и он правильный
  if (secret && secret === migrationSecret) {
    // Устанавливаем флаг администратора для запроса
    req.user = {
      userId: 'migration-admin',
      email: 'migration@system.local',
      uid: 'migration-uid',
      isAdmin: true
    };
    return next();
  }

  // Если секретный ключ не передан или неверный, проверяем обычную авторизацию
  const token = require('../utils/jwt').extractToken(req.headers.authorization);
  
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Требуется либо секретный ключ миграции (X-Migration-Secret), либо токен авторизации (Authorization: Bearer)'
    });
  }

  const decoded = require('../utils/jwt').verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({
      success: false,
      message: 'Недействительный или истекший токен'
    });
  }

  if (!decoded.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Доступ запрещен. Требуются права администратора'
    });
  }

  req.user = decoded;
  next();
}

/**
 * POST /api/migration/users
 * Массовая миграция пользователей из Firebase/Google в MySQL
 * Требует либо авторизации администратора, либо секретного ключа миграции
 * 
 * Способы авторизации:
 * 1. Authorization: Bearer <admin_token> (обычная авторизация)
 * 2. X-Migration-Secret: <migration_secret> (секретный ключ из .env)
 */
router.post('/users', checkMigrationSecret, async (req, res) => {
  try {
    const { users } = req.body;

    if (!Array.isArray(users) || users.length === 0) {
      return error(res, 'Массив пользователей обязателен', 400);
    }

    const results = {
      success: [],
      failed: [],
      skipped: []
    };

    for (const userData of users) {
      try {
        // Проверка обязательных полей
        if (!userData.email) {
          results.failed.push({
            email: userData.email || 'unknown',
            reason: 'Email обязателен'
          });
          continue;
        }

        // Проверка, существует ли пользователь
        const [existing] = await pool.execute(
          'SELECT id FROM users WHERE email = ? OR uid = ?',
          [userData.email, userData.uid || '']
        );

        if (existing.length > 0) {
          results.skipped.push({
            email: userData.email,
            reason: 'Пользователь уже существует'
          });
          continue;
        }

        // Генерация пароля, если не указан
        let passwordHash;
        if (userData.password) {
          passwordHash = await bcrypt.hash(userData.password, 10);
        } else {
          // Генерация временного пароля
          const tempPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
          passwordHash = await bcrypt.hash(tempPassword, 10);
          userData.tempPassword = tempPassword; // Сохраняем для возврата
        }

        // Подготовка данных для вставки
        const userId = userData.id || generateId();
        const uid = userData.uid || generateId();

        const insertData = {
          id: userId,
          email: userData.email,
          password_hash: passwordHash,
          display_name: userData.displayName || userData.display_name || null,
          photo_url: userData.photoUrl || userData.photo_url || null,
          uid: uid,
          phone_number: userData.phoneNumber || userData.phone_number || null,
          city: userData.city || null,
          first_name: userData.firstName || userData.first_name || null,
          second_name: userData.secondName || userData.second_name || null,
          country: userData.country || null,
          gender: userData.gender || null,
          count_performed: userData.countPerformed || userData.count_performed || 0,
          count_orders: userData.countOrders || userData.count_orders || 0,
          jcoins: userData.jcoins || 0,
          coins_from_created: userData.coinsFromCreated || userData.coins_from_created || 0,
          coins_from_participation: userData.coinsFromParticipation || userData.coins_from_participation || 0,
          stripe_id: userData.stripeId || userData.stripe_id || null,
          score: userData.score || 0,
          admin: userData.admin || userData.isAdmin || false,
          fcm_token: userData.fcmToken || userData.fcm_token || null,
          auth_type: userData.authType || userData.auth_type || 'email',
          latitude: userData.latitude || null,
          longitude: userData.longitude || null,
          created_time: userData.createdTime || userData.created_time || new Date()
        };

        // Вставка пользователя
        await pool.execute(
          `INSERT INTO users (
            id, email, password_hash, display_name, photo_url, uid,
            phone_number, city, first_name, second_name, country, gender,
            count_performed, count_orders, jcoins, coins_from_created,
            coins_from_participation, stripe_id, score, admin, fcm_token,
            auth_type, latitude, longitude, created_time
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            insertData.id,
            insertData.email,
            insertData.password_hash,
            insertData.display_name,
            insertData.photo_url,
            insertData.uid,
            insertData.phone_number,
            insertData.city,
            insertData.first_name,
            insertData.second_name,
            insertData.country,
            insertData.gender,
            insertData.count_performed,
            insertData.count_orders,
            insertData.jcoins,
            insertData.coins_from_created,
            insertData.coins_from_participation,
            insertData.stripe_id,
            insertData.score,
            insertData.admin,
            insertData.fcm_token,
            insertData.auth_type,
            insertData.latitude,
            insertData.longitude,
            insertData.created_time
          ]
        );

        results.success.push({
          email: userData.email,
          id: userId,
          uid: uid,
          tempPassword: userData.tempPassword || null
        });
      } catch (err) {
        results.failed.push({
          email: userData.email || 'unknown',
          reason: err.message
        });
      }
    }

    return success(res, {
      message: `Миграция завершена. Успешно: ${results.success.length}, Пропущено: ${results.skipped.length}, Ошибок: ${results.failed.length}`,
      results: results
    }, 200);
  } catch (err) {
    console.error('Ошибка миграции пользователей:', err);
    return error(res, 'Ошибка при миграции пользователей: ' + err.message, 500);
  }
});

module.exports = router;

