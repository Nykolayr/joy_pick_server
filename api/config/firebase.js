const admin = require('firebase-admin');

/**
 * Инициализация Firebase Admin SDK
 * Поддерживает два способа инициализации:
 * 1. Через service account JSON (FIREBASE_SERVICE_ACCOUNT - JSON строка)
 * 2. Через отдельные переменные окружения
 */
function initializeFirebase() {
  try {
    // Проверяем, не инициализирован ли уже Firebase
    if (admin.apps.length > 0) {
      return admin.app();
    }

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (serviceAccountJson) {
      // Способ 1: JSON строка из переменной окружения
      try {
        const serviceAccount = JSON.parse(serviceAccountJson);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        console.log('✅ Firebase Admin инициализирован через service account JSON');
        return admin.app();
      } catch (parseError) {
        console.error('❌ Ошибка парсинга FIREBASE_SERVICE_ACCOUNT:', parseError);
        throw parseError;
      }
    } else {
      // Способ 2: Отдельные переменные окружения
      const serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
      };

      // Проверяем наличие обязательных полей
      if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
        console.warn('⚠️ Firebase Admin не настроен. Переменные окружения не заданы.');
        console.warn('⚠️ Авторизация через Firebase будет недоступна.');
        return null;
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('✅ Firebase Admin инициализирован через переменные окружения');
      return admin.app();
    }
  } catch (error) {
    console.error('❌ Ошибка инициализации Firebase Admin:', error);
    console.warn('⚠️ Авторизация через Firebase будет недоступна.');
    return null;
  }
}

/**
 * Проверка Firebase токена
 * @param {String} idToken - Firebase ID Token
 * @returns {Promise<Object|null>} Декодированный токен или null
 */
async function verifyFirebaseToken(idToken) {
  try {
    if (!admin.apps.length) {
      console.error('❌ Firebase Admin не инициализирован');
      return null;
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('❌ Ошибка проверки Firebase токена:', error.message);
    return null;
  }
}

module.exports = {
  initializeFirebase,
  verifyFirebaseToken,
  admin
};

