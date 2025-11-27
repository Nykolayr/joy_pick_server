const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const https = require('https');

/**
 * УТИЛИТА ДЛЯ ПРОВЕРКИ ПАРОЛЕЙ С ПОДДЕРЖКОЙ РАЗНЫХ ФОРМАТОВ
 * 
 * Проблема: При миграции пользователей из Firebase в MySQL БД пароли могли быть сохранены
 * в разных форматах:
 * 1. Bcrypt (текущий формат) - $2a$10$... (60 символов)
 * 2. Firebase scrypt - другой формат (если пароли были мигрированы напрямую)
 * 3. Простой текст (небезопасно, но может быть в старых данных)
 * 
 * ВАЖНО: Firebase не предоставляет прямой доступ к хешам паролей.
 * Если пароли были мигрированы из Firebase, они могли быть:
 * - Перехешированы через bcrypt (но с новым salt, поэтому старые пароли не работают)
 * - Сохранены в другом формате (если были доступны оригинальные хеши)
 * 
 * Решение: Эта утилита проверяет пароль через bcrypt (текущий формат).
 * Если пароль не проходит проверку, можно добавить дополнительную логику
 * для проверки старых форматов (если они известны).
 */

/**
 * Проверяет пароль через Firebase Auth REST API
 * @param {string} email - Email пользователя
 * @param {string} password - Пароль в открытом виде
 * @param {string} apiKey - Firebase API Key
 * @returns {Promise<{valid: boolean, error?: string, errorCode?: string}>}
 */
function checkPasswordViaFirebaseAuth(email, password, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      email: email,
      password: password,
      returnSecureToken: true
    });

    const options = {
      hostname: 'identitytoolkit.googleapis.com',
      path: `/v1/accounts:signInWithPassword?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          // Если есть idToken, значит пароль верный
          if (response.idToken) {
            resolve({ 
              valid: true,
              message: 'Пароль успешно проверен через Firebase Auth'
            });
          } else {
            // Пароль неверный или другая ошибка
            const errorMessage = response.error?.message || 'Неизвестная ошибка Firebase Auth';
            const errorCode = response.error?.message || 'UNKNOWN_ERROR';
            
            resolve({ 
              valid: false,
              error: errorMessage,
              errorCode: errorCode
            });
          }
        } catch (err) {
          // Ошибка парсинга ответа
          reject(new Error(`Ошибка парсинга ответа Firebase Auth: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Ошибка запроса к Firebase Auth: ${err.message}`));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Таймаут запроса к Firebase Auth'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Определяет формат хеша пароля
 * @param {string} hash - Хеш пароля
 * @returns {string} - Формат хеша: 'bcrypt', 'firebase_scrypt', 'plain' или 'unknown'
 */
function detectHashFormat(hash) {
  if (!hash || typeof hash !== 'string') {
    return 'unknown';
  }

  // Bcrypt формат: начинается с $2a$, $2b$, $2y$ и имеет длину 60 символов
  if (hash.match(/^\$2[ayb]\$\d{2}\$.{53}$/)) {
    return 'bcrypt';
  }

  // Firebase scrypt формат: обычно начинается с base64 строки или имеет специфичный формат
  // Firebase использует scrypt с base64 кодированием
  // Проверяем, если это не bcrypt и имеет длину больше 60 символов, возможно это Firebase формат
  if (hash.length > 60 && !hash.startsWith('$')) {
    return 'firebase_scrypt';
  }

  // Простой текст (небезопасно, но может быть в старых данных)
  if (hash.length < 20 && !hash.includes('$')) {
    return 'plain';
  }

  return 'unknown';
}

/**
 * Проверяет пароль с поддержкой разных форматов хеширования
 * @param {string} password - Пароль в открытом виде
 * @param {string} hash - Хеш пароля из базы данных
 * @param {string} email - Email пользователя (для проверки через Firebase, если нужно)
 * @returns {Promise<{valid: boolean, format: string, needsUpgrade: boolean}>}
 */
async function verifyPassword(password, hash, email = null) {
  if (!password || !hash) {
    return { valid: false, format: 'unknown', needsUpgrade: false };
  }

  const format = detectHashFormat(hash);

  // Проверка через bcrypt (текущий формат)
  if (format === 'bcrypt') {
    try {
      const isValid = await bcrypt.compare(password, hash);
      
      // Если пароль прошел проверку через bcrypt - все хорошо
      if (isValid) {
        return {
          valid: true,
          format: 'bcrypt',
          needsUpgrade: false
        };
      }
      
      // Если пароль НЕ прошел проверку через bcrypt, но это может быть старый пароль из Firebase
      // В старом приложении использовался Firebase Auth напрямую, и при миграции пароли были
      // перехешированы с новым salt. Поэтому старые пароли не работают с новым хешем.
      // 
      // РЕШЕНИЕ: Проверяем пароль через Firebase Auth API (signInWithEmailAndPassword)
      // Если пароль верный в Firebase, значит это старый пользователь, и нужно обновить хеш
      if (!isValid && email) {
        try {
          // Используем Firebase Admin SDK для проверки пароля через Firebase Auth
          // Создаем временный пользователь или проверяем через API
          const { admin } = require('../config/firebase');
          if (admin && admin.apps.length > 0) {
            // Пытаемся получить пользователя из Firebase по email
            try {
              const userRecord = await admin.auth().getUserByEmail(email);
              
              // Если пользователь существует в Firebase, пытаемся проверить пароль
              // через Firebase Auth REST API (так как Admin SDK не предоставляет метод проверки пароля)
              // Альтернатива: использовать Firebase Auth REST API напрямую
              
              // ВАЖНО: Firebase Admin SDK не предоставляет метод для проверки пароля напрямую
              // Нужно использовать Firebase Auth REST API или клиентский SDK
              // Для этого можно использовать axios для запроса к Firebase Auth REST API
              
              // Проверяем через Firebase Auth REST API
              const firebaseApiKey = process.env.FIREBASE_API_KEY;
              
              if (firebaseApiKey) {
                try {
                  // Используем Firebase Auth REST API для проверки пароля
                  const firebaseAuthResult = await checkPasswordViaFirebaseAuth(email, password, firebaseApiKey);
                  
                  if (firebaseAuthResult.valid) {
                    // Пароль верный в Firebase - это старый пользователь
                    // Нужно обновить хеш в базе данных
                    return {
                      valid: true,
                      format: 'firebase_auth',
                      needsUpgrade: true, // Нужно перехешировать в bcrypt
                      message: 'Пароль проверен через Firebase Auth (старый формат)'
                    };
                  } else {
                    // Пароль не прошел проверку через Firebase Auth
                    return {
                      valid: false,
                      format: 'firebase_auth',
                      needsUpgrade: false,
                      message: firebaseAuthResult.error || 'Пароль не прошел проверку через Firebase Auth',
                      checkedViaFirebase: true,
                      firebaseError: firebaseAuthResult.error,
                      firebaseErrorCode: firebaseAuthResult.errorCode
                    };
                  }
                } catch (firebaseApiErr) {
                  // Ошибка при проверке через Firebase API (неверный пароль или другая ошибка)
                  // Возвращаем информацию об ошибке
                  return {
                    valid: false,
                    format: 'firebase_auth',
                    needsUpgrade: false,
                    message: `Ошибка при проверке через Firebase Auth: ${firebaseApiErr.message}`,
                    checkedViaFirebase: true,
                    firebaseError: firebaseApiErr.message
                  };
                }
              }
            } catch (getUserErr) {
              // Пользователь не найден в Firebase или произошла ошибка
              // Продолжаем с обычной проверкой
            }
          }
        } catch (firebaseErr) {
          // Firebase недоступен или произошла ошибка
          // Продолжаем с обычной проверкой
        }
      }
      
      // Пароль не прошел проверку
      return {
        valid: false,
        format: 'bcrypt',
        needsUpgrade: false
      };
    } catch (err) {
      // Если bcrypt.compare выбросил ошибку, пробуем другие методы
    }
  }

  // Проверка для Firebase scrypt формата
  // ВАЖНО: Firebase не предоставляет прямой доступ к хешам паролей
  // Если пароли были мигрированы из Firebase, они могли быть сохранены в другом формате
  // Здесь можно добавить проверку через Firebase Admin SDK, если есть доступ к токену
  if (format === 'firebase_scrypt') {
    // Firebase scrypt требует специальной проверки через Firebase Admin SDK
    // Но если пароли были мигрированы, они могли быть перехешированы
    // Попробуем проверить через bcrypt на всякий случай (может быть неправильно определен формат)
    try {
      const isValid = await bcrypt.compare(password, hash);
      if (isValid) {
        return {
          valid: true,
          format: 'bcrypt', // Оказывается это был bcrypt
          needsUpgrade: false
        };
      }
    } catch (err) {
      // Не bcrypt, пробуем другие методы
    }

    // Если это действительно Firebase scrypt, нужно использовать Firebase Admin SDK
    // Но так как у нас нет доступа к оригинальным хешам Firebase, 
    // мы не можем проверить пароль напрямую
    // В этом случае нужно либо:
    // 1. Попросить пользователя сбросить пароль
    // 2. Или использовать другой метод проверки (если есть доступ к Firebase)
    
    return {
      valid: false,
      format: 'firebase_scrypt',
      needsUpgrade: true,
      error: 'Firebase scrypt формат требует специальной проверки'
    };
  }

  // Проверка для простого текста (небезопасно, но может быть в старых данных)
  if (format === 'plain') {
    const isValid = password === hash;
    return {
      valid: isValid,
      format: 'plain',
      needsUpgrade: true // Нужно перехешировать в bcrypt
    };
  }

  // Неизвестный формат - пробуем bcrypt на всякий случай
  try {
    const isValid = await bcrypt.compare(password, hash);
    if (isValid) {
      return {
        valid: true,
        format: 'bcrypt',
        needsUpgrade: false
      };
    }
  } catch (err) {
    // Не bcrypt
  }

  return {
    valid: false,
    format: 'unknown',
    needsUpgrade: false
  };
}

/**
 * Хеширует пароль в bcrypt формат
 * @param {string} password - Пароль в открытом виде
 * @param {number} rounds - Количество раундов (по умолчанию 10)
 * @returns {Promise<string>} - Хеш пароля
 */
async function hashPassword(password, rounds = 10) {
  return await bcrypt.hash(password, rounds);
}

/**
 * Проверяет пароль и при необходимости обновляет хеш в базе данных
 * @param {string} password - Пароль в открытом виде
 * @param {string} hash - Хеш пароля из базы данных
 * @param {string} userId - ID пользователя (для обновления хеша)
 * @param {object} pool - Пул соединений с базой данных
 * @returns {Promise<boolean>} - true если пароль верный, false если нет
 */
async function verifyAndUpgradePassword(password, hash, userId, pool) {
  const result = await verifyPassword(password, hash);

  if (!result.valid) {
    return false;
  }

  // Если пароль верный, но нужно обновить хеш (старый формат)
  if (result.needsUpgrade && pool && userId) {
    try {
      const newHash = await hashPassword(password);
      await pool.execute(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        [newHash, userId]
      );
    } catch (err) {
      // Логируем ошибку, но не прерываем процесс входа
      // Пароль верный, просто не удалось обновить хеш
    }
  }

  return true;
}

module.exports = {
  detectHashFormat,
  verifyPassword,
  hashPassword,
  verifyAndUpgradePassword
};

