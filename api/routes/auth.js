const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { generateToken } = require('../utils/jwt');
const { generateId } = require('../utils/uuid');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/register
 * Регистрация нового пользователя
 */
router.post('/register', [
  body('email').isEmail().withMessage('Некорректный email'),
  body('password').isLength({ min: 6 }).withMessage('Пароль должен быть не менее 6 символов'),
  body('displayName').optional().isString(),
  body('firstName').optional().isString(),
  body('secondName').optional().isString(),
  body('phoneNumber').optional().isString(),
  body('city').optional().isString(),
  body('country').optional().isString(),
  body('gender').optional().isString()
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const {
      email,
      password,
      displayName,
      firstName,
      secondName,
      phoneNumber,
      city,
      country,
      gender,
      authType = 'email'
    } = req.body;

    // Проверка существования пользователя
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return error(res, 'Пользователь с таким email уже существует', 409);
    }

    // Хеширование пароля
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = generateId();
    const uid = generateId(); // Генерируем уникальный uid

    // Создание пользователя
    await pool.execute(
      `INSERT INTO users (
        id, email, password_hash, display_name, first_name, second_name,
        phone_number, city, country, gender, uid, auth_type, created_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        userId,
        email,
        passwordHash,
        displayName || null,
        firstName || null,
        secondName || null,
        phoneNumber || null,
        city || null,
        country || null,
        gender || null,
        uid,
        authType
      ]
    );

    // Генерация токена
    const token = generateToken({
      userId,
      email,
      uid,
      isAdmin: false
    });

    // Получение созданного пользователя
    const [users] = await pool.execute(
      'SELECT id, email, display_name, uid, created_time FROM users WHERE id = ?',
      [userId]
    );

    success(res, {
      user: users[0],
      token
    }, 'Пользователь успешно зарегистрирован', 201);
  } catch (err) {
    console.error('Ошибка регистрации:', err);
    error(res, 'Ошибка при регистрации пользователя', 500);
  }
});

/**
 * POST /api/auth/login
 * Вход пользователя
 */
router.post('/login', [
  body('email').isEmail().withMessage('Некорректный email'),
  body('password').notEmpty().withMessage('Пароль обязателен')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { email, password } = req.body;

    // Поиск пользователя
    const [users] = await pool.execute(
      'SELECT id, email, password_hash, display_name, uid, admin FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return error(res, 'Неверный email или пароль', 401);
    }

    const user = users[0];

    // Проверка пароля
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return error(res, 'Неверный email или пароль', 401);
    }

    // Генерация токена
    const token = generateToken({
      userId: user.id,
      email: user.email,
      uid: user.uid,
      isAdmin: user.admin || false
    });

    // Обновление времени последнего входа (если нужно)
    await pool.execute(
      'UPDATE users SET updated_at = NOW() WHERE id = ?',
      [user.id]
    );

    // Получение полных данных пользователя
    const [userData] = await pool.execute(
      `SELECT id, email, display_name, photo_url, uid, phone_number, city,
       first_name, second_name, country, gender, count_performed, count_orders,
       jcoins, coins_from_created, coins_from_participation, stripe_id, score,
       admin, fcm_token, auth_type, latitude, longitude, created_time
       FROM users WHERE id = ?`,
      [user.id]
    );

    success(res, {
      user: userData[0],
      token
    }, 'Вход выполнен успешно');
  } catch (err) {
    console.error('Ошибка входа:', err);
    error(res, 'Ошибка при входе', 500);
  }
});

/**
 * GET /api/auth/me
 * Получение данных текущего пользователя
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, email, display_name, photo_url, uid, phone_number, city,
       first_name, second_name, country, gender, count_performed, count_orders,
       jcoins, coins_from_created, coins_from_participation, stripe_id, score,
       admin, fcm_token, auth_type, latitude, longitude, created_time
       FROM users WHERE id = ?`,
      [req.user.userId]
    );

    if (users.length === 0) {
      return error(res, 'Пользователь не найден', 404);
    }

    success(res, { user: users[0] });
  } catch (err) {
    console.error('Ошибка получения данных пользователя:', err);
    error(res, 'Ошибка при получении данных пользователя', 500);
  }
});

/**
 * POST /api/auth/refresh
 * Обновление токена
 */
router.post('/refresh', authenticate, async (req, res) => {
  try {
    // Проверка существования пользователя
    const [users] = await pool.execute(
      'SELECT id, email, uid, admin FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (users.length === 0) {
      return error(res, 'Пользователь не найден', 404);
    }

    const user = users[0];

    // Генерация нового токена
    const token = generateToken({
      userId: user.id,
      email: user.email,
      uid: user.uid,
      isAdmin: user.admin || false
    });

    success(res, { token }, 'Токен обновлен');
  } catch (err) {
    console.error('Ошибка обновления токена:', err);
    error(res, 'Ошибка при обновлении токена', 500);
  }
});

module.exports = router;

