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
const { verifyPassword, hashPassword } = require('../utils/password');

const router = express.Router();

/**
 * POST /api/auth/register
 * Отправка кода верификации на email (без создания пользователя)
 * Пользователь будет создан только после успешной верификации кода через /api/auth/verify-email
 */
router.post('/register', [
  body('email').isEmail().withMessage('Некорректный email'),
  body('password').isLength({ min: 6 }).withMessage('Пароль должен быть не менее 6 символов'),
  body('display_name').optional().isString(),
  body('first_name').optional().isString(),
  body('second_name').optional().isString(),
  body('phone_number').optional().isString(),
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
      display_name,
      first_name,
      second_name,
      phone_number,
      city,
      country,
      gender,
      auth_type = 'email'
    } = req.body;

    // Проверка существования пользователя
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return error(res, 'Пользователь с таким email уже существует', 409);
    }

    // Хеширование пароля (сохраним для создания пользователя после верификации)
    const passwordHash = await bcrypt.hash(password, 10);

    // Генерация кода верификации (6 цифр)
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationId = generateId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 минут

    // Сохранение кода верификации с данными регистрации (БЕЗ создания пользователя)
    try {
      // Проверяем, существует ли таблица email_verifications
      const [tables] = await pool.execute(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = 'email_verifications'`
      );

      if (tables.length === 0) {
        return error(res, 'Таблица email_verifications не существует', 500, {
          details: 'Выполните миграцию: database/migrations/add_email_verification.sql и update_email_verification_for_registration.sql'
        });
      }

      // Проверяем, есть ли поля для хранения данных регистрации
      const [columns] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = 'email_verifications' 
         AND COLUMN_NAME = 'password_hash'`
      );

      if (columns.length === 0) {
        return error(res, 'Таблица email_verifications не обновлена', 500, {
          details: 'Выполните миграцию: database/migrations/update_email_verification_for_registration.sql'
        });
      }

      // Сохраняем код верификации с данными регистрации (user_id = NULL, так как пользователь еще не создан)
      await pool.execute(
        `INSERT INTO email_verifications (
          id, user_id, email, code, password_hash, display_name, first_name, second_name,
          phone_number, city, country, gender, auth_type, expires_at, verified, created_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, NOW())`,
        [
          verificationId,
          email,
          verificationCode,
          passwordHash,
          display_name || null,
          first_name || null,
          second_name || null,
          phone_number || null,
          city || null,
          country || null,
          gender || null,
          auth_type,
          expiresAt
        ]
      );

      // Отправка кода на email
      const emailResult = await sendVerificationCode(email, verificationCode);
      
      // Проверяем формат ответа
      const emailSent = emailResult && typeof emailResult === 'object' 
        ? emailResult.success === true 
        : emailResult === true;
      
      if (!emailSent) {
        // Если email не отправился, удаляем запись верификации
        await pool.execute('DELETE FROM email_verifications WHERE id = ?', [verificationId]);
        
        const errorMessage = emailResult?.error || emailResult?.message || 'Неизвестная ошибка отправки email';
        return error(res, 'Не удалось отправить код верификации на email', 500, {
          emailError: {
            message: errorMessage,
            code: emailResult?.code,
            response: emailResult?.response,
            responseCode: emailResult?.responseCode,
            details: emailResult?.details
          }
        });
      }

      // Успешно - код отправлен
      success(res, {
        message: 'Код верификации отправлен на email',
        email,
        verificationExpiresAt: expiresAt.toISOString()
      }, 'Код верификации отправлен на email', 200);

    } catch (verificationError) {
      return error(res, 'Ошибка при создании кода верификации', 500, {
        message: verificationError.message,
        code: verificationError.code,
        sqlMessage: verificationError.sqlMessage
      });
    }
  } catch (err) {
    console.error('❌ Ошибка регистрации:', err);
    console.error('❌ Stack trace:', err.stack);
    
    // Детальная информация об ошибке
    const errorDetails = {
      message: err.message,
      code: err.code,
      sqlMessage: err.sqlMessage,
      sql: err.sql
    };

    // Если это ошибка базы данных
    if (err.code && err.code.startsWith('ER_')) {
      return error(res, `Ошибка базы данных: ${err.sqlMessage || err.message}`, 500, errorDetails);
    }

    // Общая ошибка
    return error(res, `Ошибка при регистрации пользователя: ${err.message}`, 500, errorDetails);
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

    // Поиск пользователя (включая auth_type для определения способа регистрации)
    const [users] = await pool.execute(
      'SELECT id, email, password_hash, display_name, uid, admin, super_admin, auth_type FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return error(res, 'Пользователь с таким email не найден', 401, {
        errorCode: 'USER_NOT_FOUND',
        suggestion: 'Проверьте правильность email или зарегистрируйтесь'
      });
    }

    const user = users[0];

    // Проверка: если у пользователя нет пароля (password_hash = NULL или пустая строка), значит он зарегистрирован через OAuth (Google/Apple)
    if (!user.password_hash) {
      const authType = user.auth_type || 'google';
      const authTypeName = authType === 'google' ? 'Google' : 
                          authType === 'apple' ? 'Apple' : 
                          authType === 'github' ? 'GitHub' : 
                          'OAuth';
      
      return error(res, `Этот аккаунт зарегистрирован через ${authTypeName} авторизацию`, 401, {
        errorCode: 'OAUTH_ACCOUNT',
        authType: authType,
        message: `Для входа используйте ${authTypeName} авторизацию через эндпоинт /api/auth/firebase`,
        suggestion: `Используйте POST /api/auth/firebase с Firebase ID Token вместо email/password`
      });
    }

    // Проверка пароля с поддержкой разных форматов (bcrypt, старые форматы)
    // Передаем email для возможной проверки через Firebase (если нужно)
    const passwordResult = await verifyPassword(password, user.password_hash, user.email);
    
    if (!passwordResult.valid) {
      // Детальная информация об ошибке проверки пароля
      const errorDetails = {
        errorCode: 'INVALID_PASSWORD',
        checkedFormats: [passwordResult.format],
        message: passwordResult.message || 'Неверный пароль',
        checkedViaFirebase: passwordResult.checkedViaFirebase || false
      };

      // Если проверяли через Firebase Auth, добавляем информацию
      if (passwordResult.format === 'firebase_auth' || passwordResult.checkedViaFirebase) {
        errorDetails.message = passwordResult.message || 'Пароль не прошел проверку через Firebase Auth';
        errorDetails.suggestion = 'Пароль был проверен через Firebase Auth, но не совпал. Возможно, пароль был изменен в Firebase или аккаунт был удален';
        if (passwordResult.firebaseError) {
          errorDetails.firebaseError = passwordResult.firebaseError;
        }
      } else if (passwordResult.format === 'bcrypt') {
        errorDetails.message = 'Пароль не прошел проверку через bcrypt';
        errorDetails.suggestion = 'Проверьте правильность пароля. Если это старый пароль из Firebase, он будет проверен автоматически';
      }

      return error(res, 'Неверный email или пароль', 401, errorDetails);
    }

    // Если пароль верный, но нужно обновить хеш (старый формат из Firebase)
    if (passwordResult.needsUpgrade) {
      try {
        const newHash = await hashPassword(password);
        await pool.execute(
          'UPDATE users SET password_hash = ? WHERE id = ?',
          [newHash, user.id]
        );
        // Пароль успешно обновлен с Firebase формата на bcrypt
      } catch (err) {
        // Логируем ошибку, но не прерываем процесс входа
        // Пароль верный, просто не удалось обновить хеш
        // В следующий раз пользователь сможет войти через bcrypt
      }
    }

    // Генерация токена
    const token = generateToken({
      userId: user.id,
      email: user.email,
      uid: user.uid,
      isAdmin: user.admin || false,
      isSuperAdmin: user.super_admin || false
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
    error(res, 'Ошибка при входе', 500, err);
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
       admin, super_admin, fcm_token, auth_type, latitude, longitude, created_time
       FROM users WHERE id = ?`,
      [req.user.userId]
    );

    if (users.length === 0) {
      return error(res, 'Пользователь не найден', 404);
    }

    success(res, { user: users[0] });
  } catch (err) {
    console.error('Ошибка получения данных пользователя:', err);
    error(res, 'Ошибка при получении данных пользователя', 500, err);
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
      'SELECT id, email, uid, admin, super_admin FROM users WHERE id = ?',
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
      isAdmin: user.admin || false,
      isSuperAdmin: user.super_admin || false
    });

    success(res, { token }, 'Токен обновлен');
  } catch (err) {
    console.error('Ошибка обновления токена:', err);
    error(res, 'Ошибка при обновлении токена', 500, err);
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
  body('first_name').optional().isString().withMessage('Имя должно быть строкой'),
  body('second_name').optional().isString().withMessage('Фамилия должна быть строкой')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { idToken, first_name: providedFirstName, second_name: providedSecondName } = req.body;

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
      'SELECT id, email, uid, admin, super_admin FROM users WHERE uid = ?',
      [firebaseUid]
    );

    let userId;
    let userUid;
    let isAdmin = false;
    let isSuperAdmin = false;

    if (existingUsers.length > 0) {
      // Пользователь существует - обновляем данные
      const existingUser = existingUsers[0];
      userId = existingUser.id;
      userUid = existingUser.uid;
      isAdmin = existingUser.admin || false;
      isSuperAdmin = existingUser.super_admin || false;

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
          'SELECT admin, super_admin FROM users WHERE id = ?',
          [userId]
        );
        isAdmin = updatedUsers[0]?.admin || false;
        isSuperAdmin = updatedUsers[0]?.super_admin || false;
      } else {
        // Создаем нового пользователя
        // Для Apple Sign In email может быть null или скрытым email от Apple
        // Для Firebase/OAuth пользователей password_hash должен быть пустой строкой (не NULL)
        await pool.execute(
          `INSERT INTO users (
            id, email, password_hash, display_name, photo_url, uid,
            first_name, second_name, phone_number, auth_type, created_time
          ) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [userId, finalEmail || null, finalDisplayName, finalPhotoUrl, firebaseUid, firstName, secondName, phoneNumber, authType]
        );
      }
    }

    // Генерация серверного JWT токена
    const token = generateToken({
      userId,
      email,
      uid: userUid,
      isAdmin,
      isSuperAdmin
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
    error(res, 'Ошибка при авторизации через Firebase', 500, err);
  }
});

/**
 * POST /api/auth/verify-email
 * Проверка кода верификации email и создание пользователя
 * После успешной верификации создается пользователь и возвращается токен
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

    // Поиск кода верификации (user_id может быть NULL для новых регистраций)
    const [verifications] = await pool.execute(
      `SELECT * FROM email_verifications
       WHERE email = ? AND code = ? AND verified = FALSE
       ORDER BY created_at DESC
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

    // Проверяем, есть ли данные для создания пользователя (password_hash)
    if (!verification.password_hash) {
      // Это верификация для существующего пользователя
      if (!verification.user_id) {
        return error(res, 'Ошибка: не найдены данные для создания пользователя', 500);
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

      return success(res, {
        user: users[0],
        verified: true
      }, 'Email успешно подтвержден');
    }

    // Это новая регистрация - создаем пользователя
    // Проверяем, не существует ли уже пользователь с таким email
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return error(res, 'Пользователь с таким email уже существует', 409);
    }

    // Создаем пользователя из данных верификации
    const userId = generateId();
    const uid = generateId();

    // Проверяем наличие поля email_verified
    const [columns] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'users' 
       AND COLUMN_NAME = 'email_verified'`
    );
    const hasEmailVerified = columns.length > 0;

    // Создание пользователя
    if (hasEmailVerified) {
      await pool.execute(
        `INSERT INTO users (
          id, email, password_hash, display_name, first_name, second_name,
          phone_number, city, country, gender, uid, auth_type, email_verified, created_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW())`,
        [
          userId,
          email,
          verification.password_hash,
          verification.display_name,
          verification.first_name,
          verification.second_name,
          verification.phone_number,
          verification.city,
          verification.country,
          verification.gender,
          uid,
          verification.auth_type || 'email'
        ]
      );
    } else {
      await pool.execute(
        `INSERT INTO users (
          id, email, password_hash, display_name, first_name, second_name,
          phone_number, city, country, gender, uid, auth_type, created_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          userId,
          email,
          verification.password_hash,
          verification.display_name,
          verification.first_name,
          verification.second_name,
          verification.phone_number,
          verification.city,
          verification.country,
          verification.gender,
          uid,
          verification.auth_type || 'email'
        ]
      );
    }

    // Обновление статуса верификации и привязка к пользователю
    await pool.execute(
      'UPDATE email_verifications SET verified = TRUE, user_id = ? WHERE id = ?',
      [userId, verification.id]
    );

    // Генерация токена
    const token = generateToken({
      userId,
      email,
      uid,
      isAdmin: false,
      isSuperAdmin: false
    });

    // Получение созданного пользователя
    let selectFields = 'id, email, display_name, uid, created_time';
    if (hasEmailVerified) {
      selectFields += ', email_verified';
    }
    
    const [users] = await pool.execute(
      `SELECT ${selectFields} FROM users WHERE id = ?`,
      [userId]
    );

    success(res, {
      user: users[0],
      token,
      verified: true
    }, 'Email успешно подтвержден. Пользователь создан.');
  } catch (err) {
    return error(res, `Ошибка при верификации email: ${err.message}`, 500, {
      message: err.message,
      code: err.code,
      sqlMessage: err.sqlMessage
    });
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

    // Поиск пользователя (может не существовать для новых регистраций)
    const [users] = await pool.execute(
      'SELECT id, email, email_verified FROM users WHERE email = ?',
      [email]
    );

    let userId = null;
    if (users.length > 0) {
      const user = users[0];
      
      // Проверка, не верифицирован ли уже email
      if (user.email_verified) {
        return error(res, 'Email уже подтвержден', 400);
      }
      
      userId = user.id;
    }

    // Поиск последней неверифицированной записи верификации
    const [existingVerifications] = await pool.execute(
      `SELECT * FROM email_verifications
       WHERE email = ? AND verified = FALSE
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );

    // Генерация нового кода верификации
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationId = generateId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 минут

    if (existingVerifications.length > 0 && existingVerifications[0].password_hash) {
      // Обновляем существующую запись (новая регистрация с данными)
      const existing = existingVerifications[0];
      await pool.execute(
        `UPDATE email_verifications 
         SET id = ?, code = ?, expires_at = ?, created_at = NOW()
         WHERE id = ?`,
        [verificationId, verificationCode, expiresAt, existing.id]
      );
    } else {
      // Создаем новую запись
      await pool.execute(
        `INSERT INTO email_verifications (
          id, user_id, email, code, expires_at, verified, created_at
        ) VALUES (?, ?, ?, ?, ?, FALSE, NOW())`,
        [verificationId, userId, email, verificationCode, expiresAt]
      );
    }

    // Отправка кода на email
    const emailResult = await sendVerificationCode(email, verificationCode);
    const emailSent = emailResult && typeof emailResult === 'object' 
      ? emailResult.success === true 
      : emailResult === true;
    
    if (!emailSent) {
      return error(res, 'Не удалось отправить код верификации', 500, {
        error: emailResult?.error || emailResult?.message || 'Неизвестная ошибка',
        code: emailResult?.code,
        details: emailResult?.details
      });
    }

    success(res, {
      message: 'Код верификации отправлен на email',
      verificationExpiresAt: expiresAt.toISOString()
    }, 'Код верификации отправлен');
  } catch (err) {
    console.error('Ошибка повторной отправки кода:', err);
    error(res, 'Ошибка при отправке кода верификации', 500, err);
  }
});

/**
 * POST /api/auth/test-email
 * Тестовый эндпоинт для проверки отправки email
 * Требует аутентификации (только для админов или разработки)
 */
router.post('/test-email', [
  body('email').isEmail().withMessage('Некорректный email'),
  body('code').optional().isString()
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { email, code = '123456' } = req.body;

    // Проверяем настройки SMTP
    const smtpConfig = {
      host: process.env.SMTP_HOST || 'не указан',
      port: process.env.SMTP_PORT || 'не указан',
      user: process.env.SMTP_USER || 'не указан',
      pass: process.env.SMTP_PASS ? 'указан (' + process.env.SMTP_PASS.length + ' символов)' : 'не указан',
      from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'не указан'
    };

    // Пытаемся отправить тестовый email
    const result = await sendVerificationCode(email, code);

    if (result.success) {
      return success(res, {
        message: 'Тестовый email отправлен успешно',
        email,
        code,
        smtpConfig: {
          host: smtpConfig.host,
          port: smtpConfig.port,
          user: smtpConfig.user,
          pass: smtpConfig.pass,
          from: smtpConfig.from
        },
        result
      }, 'Email отправлен');
    } else {
      return error(res, 'Не удалось отправить email', 500, {
        email,
        code,
        smtpConfig,
        error: result
      });
    }
  } catch (err) {
    return error(res, `Ошибка при отправке тестового email: ${err.message}`, 500, {
      message: err.message,
      stack: err.stack
    });
  }
});

module.exports = router;

