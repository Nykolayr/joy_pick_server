const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { generateToken } = require('../utils/jwt');
const { generateId } = require('../utils/uuid');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { verifyFirebaseToken } = require('../config/firebase');
const { sendVerificationCode } = require('../config/email');

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

    // Создание пользователя (email_verified по умолчанию FALSE)
    await pool.execute(
      `INSERT INTO users (
        id, email, password_hash, display_name, first_name, second_name,
        phone_number, city, country, gender, uid, auth_type, email_verified, created_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, NOW())`,
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

    // Генерация кода верификации (6 цифр)
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationId = generateId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 минут

    // Сохранение кода верификации в базу данных
    await pool.execute(
      `INSERT INTO email_verifications (
        id, user_id, email, code, expires_at, verified, created_at
      ) VALUES (?, ?, ?, ?, ?, FALSE, NOW())`,
      [verificationId, userId, email, verificationCode, expiresAt]
    );

    // Отправка кода на email
    const emailSent = await sendVerificationCode(email, verificationCode);
    if (!emailSent) {
      console.warn(`⚠️ Не удалось отправить код верификации на ${email}, но пользователь создан`);
    }

    // Генерация токена
    const token = generateToken({
      userId,
      email,
      uid,
      isAdmin: false
    });

    // Получение созданного пользователя
    const [users] = await pool.execute(
      'SELECT id, email, display_name, uid, email_verified, created_time FROM users WHERE id = ?',
      [userId]
    );

    success(res, {
      user: users[0],
      token,
      verificationCodeSent: emailSent,
      message: emailSent 
        ? 'Пользователь успешно зарегистрирован. Код верификации отправлен на email.'
        : 'Пользователь успешно зарегистрирован. Не удалось отправить код верификации.'
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

/**
 * POST /api/auth/firebase
 * Авторизация через Firebase (Google Sign In, Apple Sign In и другие провайдеры)
 * Принимает Firebase ID Token, проверяет его и выдает серверный JWT
 * 
 * Поддерживаемые провайдеры:
 * - Google Sign In (auth_type: 'google')
 * - Apple Sign In (auth_type: 'apple')
 * - GitHub Sign In (auth_type: 'github')
 * - Phone Authentication (auth_type: 'phone')
 * - Email/Password (auth_type: 'email')
 * 
 * Особенности Apple Sign In:
 * - Apple может не предоставить email при первом входе (пользователь может скрыть email)
 * - В этом случае email будет null или скрытый email от Apple (например: {uid}@privaterelay.appleid.com)
 * - При последующих входах email может быть предоставлен и будет обновлен
 */
router.post('/firebase', [
  body('idToken').notEmpty().withMessage('Firebase ID Token обязателен'),
  body('firstName').optional().isString().withMessage('Имя должно быть строкой'),
  body('secondName').optional().isString().withMessage('Фамилия должна быть строкой')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { idToken, firstName: providedFirstName, secondName: providedSecondName } = req.body;

    // Проверка Firebase токена
    const decodedToken = await verifyFirebaseToken(idToken);
    if (!decodedToken) {
      return error(res, 'Недействительный Firebase токен', 401);
    }

    const firebaseUid = decodedToken.uid;
    // Apple может не предоставить email при первом входе (пользователь может скрыть email)
    // В этом случае Firebase может вернуть скрытый email вида: {uid}@privaterelay.appleid.com
    const email = decodedToken.email || null;
    const displayName = decodedToken.name || null;
    const photoUrl = decodedToken.picture || null;
    const emailVerified = decodedToken.email_verified || false;

    // Пытаемся получить дополнительные данные через Firebase Admin SDK
    // Это даст больше информации, чем только токен (например, phone_number)
    let additionalUserData = null;
    try {
      const { admin } = require('../config/firebase');
      if (admin && admin.apps.length > 0) {
        const userRecord = await admin.auth().getUser(firebaseUid);
        additionalUserData = {
          email: userRecord.email || email,
          displayName: userRecord.displayName || displayName,
          photoURL: userRecord.photoURL || photoUrl,
          phoneNumber: userRecord.phoneNumber || null,
          // Для Apple: givenName и familyName доступны только при первом входе
          // и не сохраняются в Firebase User, но могут быть в custom claims
        };
      }
    } catch (err) {
      console.warn('Не удалось получить дополнительные данные пользователя из Firebase:', err.message);
      // Продолжаем с данными из токена
    }

    // Используем данные из Firebase Admin, если они доступны, иначе из токена
    const finalEmail = additionalUserData?.email || email;
    const finalDisplayName = additionalUserData?.displayName || displayName;
    const finalPhotoUrl = additionalUserData?.photoURL || photoUrl;
    const phoneNumber = additionalUserData?.phoneNumber || null;

    // Определяем first_name и second_name
    // Приоритет: переданные с фронта (для Apple при первом входе) > парсинг displayName
    let firstName = providedFirstName || null;
    let secondName = providedSecondName || null;
    
    // Если не переданы с фронта, пытаемся распарсить displayName
    if (!firstName && !secondName && finalDisplayName) {
      const nameParts = finalDisplayName.trim().split(/\s+/);
      if (nameParts.length > 0) {
        firstName = nameParts[0];
        if (nameParts.length > 1) {
          secondName = nameParts.slice(1).join(' ');
        }
      }
    }

    // Определяем тип авторизации
    let authType = 'email';
    if (decodedToken.firebase && decodedToken.firebase.sign_in_provider) {
      const provider = decodedToken.firebase.sign_in_provider;
      if (provider === 'google.com') {
        authType = 'google';
      } else if (provider === 'apple.com') {
        authType = 'apple';
      } else if (provider === 'github.com') {
        authType = 'github';
      } else if (provider === 'phone') {
        authType = 'phone';
      }
    }

    // Поиск пользователя по uid (Firebase UID)
    const [existingUsers] = await pool.execute(
      'SELECT id, email, uid, admin FROM users WHERE uid = ?',
      [firebaseUid]
    );

    let userId;
    let userUid;
    let isAdmin = false;

    if (existingUsers.length > 0) {
      // Пользователь существует - обновляем данные
      const existingUser = existingUsers[0];
      userId = existingUser.id;
      userUid = existingUser.uid;
      isAdmin = existingUser.admin || false;

      // Обновляем данные пользователя (email, display_name, photo_url могут измениться)
      // Для first_name и second_name: если переданы с фронта, обновляем (даже если null)
      // Иначе обновляем только если они не null (сохраняем существующие значения)
      const updates = [];
      const params = [];
      
      if (finalEmail !== null) {
        updates.push('email = ?');
        params.push(finalEmail);
      }
      if (finalDisplayName !== null) {
        updates.push('display_name = COALESCE(?, display_name)');
        params.push(finalDisplayName);
      }
      if (finalPhotoUrl !== null) {
        updates.push('photo_url = COALESCE(?, photo_url)');
        params.push(finalPhotoUrl);
      }
      // Если firstName/secondName переданы с фронта, обновляем их (даже если null)
      if (providedFirstName !== undefined) {
        updates.push('first_name = ?');
        params.push(firstName);
      } else if (firstName !== null) {
        // Если не переданы, но распарсились из displayName, обновляем только если не null
        updates.push('first_name = COALESCE(?, first_name)');
        params.push(firstName);
      }
      if (providedSecondName !== undefined) {
        updates.push('second_name = ?');
        params.push(secondName);
      } else if (secondName !== null) {
        updates.push('second_name = COALESCE(?, second_name)');
        params.push(secondName);
      }
      if (phoneNumber !== null) {
        updates.push('phone_number = COALESCE(?, phone_number)');
        params.push(phoneNumber);
      }
      updates.push('auth_type = ?');
      params.push(authType);
      updates.push('updated_at = NOW()');
      params.push(userId);
      
      if (updates.length > 0) {
        await pool.execute(
          `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
          params
        );
      }
    } else {
      // Новый пользователь - создаем запись
      userId = generateId();
      userUid = firebaseUid; // Используем Firebase UID как uid

      // Проверяем, нет ли пользователя с таким email (на случай миграции)
      // Только если email предоставлен (Apple может не предоставить email)
      let emailUsers = [];
      if (email) {
        [emailUsers] = await pool.execute(
          'SELECT id FROM users WHERE email = ?',
          [email]
        );
      }

      if (emailUsers.length > 0) {
        // Пользователь с таким email уже существует - обновляем его uid
        const emailUser = emailUsers[0];
        userId = emailUser.id;
        
        // Формируем обновления аналогично выше
        const updates = [];
        const updateParams = [];
        
        updates.push('uid = ?');
        updateParams.push(firebaseUid);
        
        if (finalEmail !== null) {
          updates.push('email = ?');
          updateParams.push(finalEmail);
        }
        if (finalDisplayName !== null) {
          updates.push('display_name = COALESCE(?, display_name)');
          updateParams.push(finalDisplayName);
        }
        if (finalPhotoUrl !== null) {
          updates.push('photo_url = COALESCE(?, photo_url)');
          updateParams.push(finalPhotoUrl);
        }
        if (providedFirstName !== undefined) {
          updates.push('first_name = ?');
          updateParams.push(firstName);
        } else if (firstName !== null) {
          updates.push('first_name = COALESCE(?, first_name)');
          updateParams.push(firstName);
        }
        if (providedSecondName !== undefined) {
          updates.push('second_name = ?');
          updateParams.push(secondName);
        } else if (secondName !== null) {
          updates.push('second_name = COALESCE(?, second_name)');
          updateParams.push(secondName);
        }
        if (phoneNumber !== null) {
          updates.push('phone_number = COALESCE(?, phone_number)');
          updateParams.push(phoneNumber);
        }
        updates.push('auth_type = ?');
        updateParams.push(authType);
        updates.push('updated_at = NOW()');
        updateParams.push(userId);
        
        await pool.execute(
          `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
          updateParams
        );

        // Получаем данные обновленного пользователя
        const [updatedUsers] = await pool.execute(
          'SELECT admin FROM users WHERE id = ?',
          [userId]
        );
        isAdmin = updatedUsers[0]?.admin || false;
      } else {
        // Создаем нового пользователя
        // Для Apple Sign In email может быть null или скрытым email от Apple
        await pool.execute(
          `INSERT INTO users (
            id, email, password_hash, display_name, photo_url, uid,
            first_name, second_name, phone_number, auth_type, created_time
          ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [userId, finalEmail || null, finalDisplayName, finalPhotoUrl, firebaseUid, firstName, secondName, phoneNumber, authType]
        );
      }
    }

    // Генерация серверного JWT токена
    const token = generateToken({
      userId,
      email,
      uid: userUid,
      isAdmin
    });

    // Получение полных данных пользователя
    const [userData] = await pool.execute(
      `SELECT id, email, display_name, photo_url, uid, phone_number, city,
       first_name, second_name, country, gender, count_performed, count_orders,
       jcoins, coins_from_created, coins_from_participation, stripe_id, score,
       admin, fcm_token, auth_type, latitude, longitude, created_time
       FROM users WHERE id = ?`,
      [userId]
    );

    success(res, {
      user: userData[0],
      token
    }, 'Авторизация через Firebase выполнена успешно');
  } catch (err) {
    console.error('Ошибка авторизации через Firebase:', err);
    error(res, 'Ошибка при авторизации через Firebase', 500);
  }
});

/**
 * POST /api/auth/verify-email
 * Проверка кода верификации email
 */
router.post('/verify-email', [
  body('email').isEmail().withMessage('Некорректный email'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('Код должен состоять из 6 цифр'),
  body('code').matches(/^\d+$/).withMessage('Код должен содержать только цифры')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { email, code } = req.body;

    // Поиск кода верификации
    const [verifications] = await pool.execute(
      `SELECT ev.*, u.id as user_id 
       FROM email_verifications ev
       JOIN users u ON ev.user_id = u.id
       WHERE ev.email = ? AND ev.code = ? AND ev.verified = FALSE
       ORDER BY ev.created_at DESC
       LIMIT 1`,
      [email, code]
    );

    if (verifications.length === 0) {
      return error(res, 'Неверный код верификации', 400);
    }

    const verification = verifications[0];

    // Проверка срока действия кода
    const now = new Date();
    const expiresAt = new Date(verification.expires_at);
    if (now > expiresAt) {
      return error(res, 'Код верификации истек. Запросите новый код.', 400);
    }

    // Обновление статуса верификации
    await pool.execute(
      'UPDATE email_verifications SET verified = TRUE WHERE id = ?',
      [verification.id]
    );

    // Обновление статуса email_verified у пользователя
    await pool.execute(
      'UPDATE users SET email_verified = TRUE WHERE id = ?',
      [verification.user_id]
    );

    // Получение обновленного пользователя
    const [users] = await pool.execute(
      'SELECT id, email, display_name, uid, email_verified FROM users WHERE id = ?',
      [verification.user_id]
    );

    success(res, {
      user: users[0],
      verified: true
    }, 'Email успешно подтвержден');
  } catch (err) {
    console.error('Ошибка верификации email:', err);
    error(res, 'Ошибка при верификации email', 500);
  }
});

/**
 * POST /api/auth/resend-verification
 * Повторная отправка кода верификации
 */
router.post('/resend-verification', [
  body('email').isEmail().withMessage('Некорректный email')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { email } = req.body;

    // Поиск пользователя
    const [users] = await pool.execute(
      'SELECT id, email, email_verified FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return error(res, 'Пользователь с таким email не найден', 404);
    }

    const user = users[0];

    // Проверка, не верифицирован ли уже email
    if (user.email_verified) {
      return error(res, 'Email уже подтвержден', 400);
    }

    // Генерация нового кода верификации
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationId = generateId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 минут

    // Сохранение нового кода верификации
    await pool.execute(
      `INSERT INTO email_verifications (
        id, user_id, email, code, expires_at, verified, created_at
      ) VALUES (?, ?, ?, ?, ?, FALSE, NOW())`,
      [verificationId, user.id, email, verificationCode, expiresAt]
    );

    // Отправка кода на email
    const emailSent = await sendVerificationCode(email, verificationCode);
    if (!emailSent) {
      return error(res, 'Не удалось отправить код верификации. Проверьте настройки email.', 500);
    }

    success(res, {
      message: 'Код верификации отправлен на email'
    }, 'Код верификации отправлен');
  } catch (err) {
    console.error('Ошибка повторной отправки кода:', err);
    error(res, 'Ошибка при отправке кода верификации', 500);
  }
});

module.exports = router;

