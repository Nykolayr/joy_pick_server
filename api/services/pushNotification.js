const { admin } = require('../config/firebase');
const pool = require('../config/database');

/**
 * Получение FCM токенов пользователей по их ID
 * @param {Array<string>} userIds - Массив ID пользователей
 * @returns {Promise<Array<string>>} Массив FCM токенов
 */
async function getFcmTokensByUserIds(userIds) {
  if (!userIds || userIds.length === 0) {
    return [];
  }

  try {
    const placeholders = userIds.map(() => '?').join(',');
    const [tokens] = await pool.execute(
      `SELECT DISTINCT fcm_token FROM users 
       WHERE id IN (${placeholders}) AND fcm_token IS NOT NULL AND fcm_token != ''`,
      userIds
    );

    return tokens.map(token => token.fcm_token).filter(token => token && token.trim().length > 0);
  } catch (error) {
    console.error('❌ Ошибка получения FCM токенов:', error);
    return [];
  }
}

/**
 * Получение FCM токенов пользователей в радиусе от координат
 * @param {number} latitude - Широта
 * @param {number} longitude - Долгота
 * @param {number} radiusKm - Радиус в километрах (по умолчанию 10 км)
 * @param {string} excludeUserId - ID пользователя, которого нужно исключить (например, создатель заявки)
 * @returns {Promise<Array<string>>} Массив FCM токенов
 */
async function getFcmTokensByRadius(latitude, longitude, radiusKm = 10, excludeUserId = null) {
  if (!latitude || !longitude) {
    return [];
  }

  try {
    let query = `
      SELECT DISTINCT fcm_token 
      FROM users 
      WHERE latitude IS NOT NULL 
        AND longitude IS NOT NULL 
        AND fcm_token IS NOT NULL 
        AND fcm_token != ''
        AND (6371 * acos(
          cos(radians(?)) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(latitude))
        )) <= ?
    `;
    const params = [latitude, longitude, latitude, radiusKm];

    if (excludeUserId) {
      query += ' AND id != ?';
      params.push(excludeUserId);
    }

    const [tokens] = await pool.execute(query, params);
    return tokens.map(token => token.fcm_token).filter(token => token && token.trim().length > 0);
  } catch (error) {
    console.error('❌ Ошибка получения FCM токенов по радиусу:', error);
    return [];
  }
}

/**
 * Отправка push-уведомлений
 * @param {Object} options - Параметры уведомления
 * @param {string} options.title - Заголовок уведомления
 * @param {string} options.body - Текст уведомления
 * @param {Array<string>} options.tokens - Массив FCM токенов
 * @param {string} options.imageUrl - URL изображения (опционально)
 * @param {string} options.sound - Звук уведомления (по умолчанию 'default')
 * @param {Object} options.data - Дополнительные данные для уведомления (опционально)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendPushNotifications({ title, body, tokens, imageUrl = null, sound = 'default', data = {} }) {
  if (!admin.apps.length) {
    console.error('❌ Firebase Admin не инициализирован');
    return { successCount: 0, failureCount: 0 };
  }

  if (!tokens || tokens.length === 0) {
    console.log('ℹ️ Нет токенов для отправки уведомлений');
    return { successCount: 0, failureCount: 0 };
  }

  if (!title || !body) {
    console.error('❌ Заголовок и текст уведомления обязательны');
    return { successCount: 0, failureCount: 0 };
  }

  let totalSuccess = 0;
  let totalFailure = 0;
  const result = { successCount: 0, failureCount: 0 };

  // Отправляем батчами по 500 токенов (лимит FCM)
  const batchSize = 500;
  for (let i = 0; i < tokens.length; i += batchSize) {
    const tokensBatch = tokens.slice(i, Math.min(i + batchSize, tokens.length));

    try {
      const message = {
        notification: {
          title,
          body,
          ...(imageUrl && { imageUrl }),
        },
        data: {
          ...data,
          // Преобразуем объекты в строки для data
          ...Object.keys(data).reduce((acc, key) => {
            const value = data[key];
            acc[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
            return acc;
          }, {}),
        },
        android: {
          notification: {
            sound: sound,
          },
        },
        apns: {
          payload: {
            aps: {
              sound: sound,
            },
          },
        },
        tokens: tokensBatch,
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      totalSuccess += response.successCount;
      totalFailure += response.failureCount;

      // Логируем невалидные токены и автоматически удаляем их из БД
      const invalidTokens = [];
      const errorMessages = [];
      if (response.responses) {
        for (let idx = 0; idx < response.responses.length; idx++) {
          const resp = response.responses[idx];
          if (!resp.success && resp.error) {
            const errorCode = resp.error.code;
            const errorMessage = resp.error.message || 'Unknown error';
            const token = tokensBatch[idx];
            errorMessages.push(`Токен ${token.substring(0, 20)}...: ${errorCode} - ${errorMessage}`);
            
            if (errorCode === 'messaging/invalid-registration-token' || 
                errorCode === 'messaging/registration-token-not-registered') {
              invalidTokens.push(token);
              console.log(`⚠️ Невалидный токен обнаружен: ${token.substring(0, 30)}... (${errorCode})`);
              
              // Автоматически удаляем невалидный токен из БД
              try {
                const [updateResult] = await pool.execute(
                  'UPDATE users SET fcm_token = NULL WHERE fcm_token = ?',
                  [token]
                );
                if (updateResult.affectedRows > 0) {
                  console.log(`✅ Невалидный токен удален из БД (затронуто пользователей: ${updateResult.affectedRows})`);
                } else {
                  console.log(`ℹ️ Токен не найден в БД для удаления (возможно, уже удален)`);
                }
              } catch (dbError) {
                console.error(`❌ Ошибка удаления невалидного токена из БД:`, dbError);
              }
            } else {
              console.log(`⚠️ Ошибка отправки токена ${token.substring(0, 30)}...: ${errorCode} - ${errorMessage}`);
            }
          }
        }
      }
      
      // Сохраняем информацию об ошибках для возврата
      if (errorMessages.length > 0 && i === 0) {
        // Если это первый батч и есть ошибки, сохраняем причины
        if (!result.reason) {
          let reasonText = errorMessages.slice(0, 3).join('; '); // Первые 3 ошибки
          if (errorMessages.length > 3) {
            reasonText += ` и еще ${errorMessages.length - 3} ошибок`;
          }
          // Добавляем информацию о том, что невалидные токены были удалены
          if (invalidTokens.length > 0) {
            reasonText += `. Невалидные токены автоматически удалены из БД (${invalidTokens.length} шт.)`;
          }
          result.reason = reasonText;
        }
      }

      console.log(`✅ Отправлено ${response.successCount} из ${tokensBatch.length} уведомлений (батч ${Math.floor(i / batchSize) + 1})`);
    } catch (error) {
      console.error(`❌ Ошибка отправки батча уведомлений:`, error);
      totalFailure += tokensBatch.length;
      if (!result.reason) {
        result.reason = `Ошибка при отправке через FCM: ${error.message}`;
      }
    }
  }

  result.successCount = totalSuccess;
  result.failureCount = totalFailure;
  
  console.log(`📱 Всего отправлено: ${totalSuccess} успешно, ${totalFailure} с ошибками из ${tokens.length} токенов`);
  return result;
}

/**
 * Отправка push-уведомлений при создании заявки
 * @param {Object} requestData - Данные заявки
 * @param {string} requestData.id - ID заявки
 * @param {string} requestData.category - Категория заявки
 * @param {string} requestData.name - Название заявки
 * @param {string} requestData.created_by - ID создателя заявки
 * @param {number} requestData.latitude - Широта заявки
 * @param {number} requestData.longitude - Долгота заявки
 * @param {Array<string>} requestData.photos - Массив URL фотографий
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendRequestCreatedNotification(requestData) {
  const { id, category, name, created_by, latitude, longitude, photos = [] } = requestData;

  // Если нет координат, не отправляем уведомления
  if (!latitude || !longitude) {
    console.log('⚠️ Заявка без координат, пропускаем отправку уведомлений');
    return { successCount: 0, failureCount: 0 };
  }

  try {
    // Получаем данные создателя заявки
    let creatorName = 'Пользователь';
    if (created_by) {
      try {
        const [users] = await pool.execute(
          `SELECT display_name, first_name, second_name, email 
           FROM users WHERE id = ?`,
          [created_by]
        );
        if (users.length > 0) {
          const user = users[0];
          if (user.display_name) {
            creatorName = user.display_name;
          } else if (user.first_name || user.second_name) {
            creatorName = `${user.first_name || ''} ${user.second_name || ''}`.trim();
          } else if (user.email) {
            creatorName = user.email;
          }
        }
      } catch (e) {
        console.log('⚠️ Ошибка получения данных создателя:', e);
      }
    }

    // Получаем первое фото (если есть)
    const firstPhoto = photos.length > 0 ? photos[0] : null;

    // Получаем название категории для отображения
    const categoryDisplayNames = {
      wasteLocation: 'Waste Location',
      speedCleanup: 'Speed Clean-up',
      event: 'Event',
    };
    const categoryDisplayName = categoryDisplayNames[category] || 'Request';

    // Формируем deeplink для перехода на заявку
    const categoryPaths = {
      wasteLocation: 'waste_location',
      speedCleanup: 'speed_cleanup',
      event: 'event',
    };
    const categoryPath = categoryPaths[category] || 'waste_location';
    const deeplink = `https://garbagedev-9c240.web.app/request/${categoryPath}/${id}`;

    // Получаем токены пользователей в радиусе 10 км
    const tokens = await getFcmTokensByRadius(latitude, longitude, 10, created_by);

    if (tokens.length === 0) {
      console.log('ℹ️ Нет пользователей рядом для отправки уведомлений');
      return { successCount: 0, failureCount: 0 };
    }

    console.log(`📍 Найдено ${tokens.length} FCM токенов для пользователей в радиусе 10 км`);

    // Формируем текст уведомления
    const notificationTitle = `New ${categoryDisplayName}`;
    const notificationBody = `${name}\nCreated by: ${creatorName}`;

    // Отправляем уведомления
    const result = await sendPushNotifications({
      title: notificationTitle,
      body: notificationBody,
      tokens,
      imageUrl: firstPhoto,
      sound: 'default',
      data: {
        initialPageName: 'RequestDetails',
        parameterData: JSON.stringify({
          requestId: id,
          category: category,
        }),
        deeplink: deeplink,
      },
    });

    return result;
  } catch (error) {
    console.error('❌ Ошибка отправки уведомления о создании заявки:', error);
    return { successCount: 0, failureCount: 0 };
  }
}

/**
 * Отправка push-уведомлений конкретным пользователям
 * @param {Object} options - Параметры уведомления
 * @param {string} options.title - Заголовок уведомления
 * @param {string} options.body - Текст уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей
 * @param {string} options.imageUrl - URL изображения (опционально)
 * @param {string} options.sound - Звук уведомления (опционально)
 * @param {Object} options.data - Дополнительные данные (опционально)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendNotificationToUsers({ title, body, userIds, imageUrl = null, sound = 'default', data = {} }) {
  if (!userIds || userIds.length === 0) {
    console.log('ℹ️ Нет пользователей для отправки уведомлений');
    return { 
      successCount: 0, 
      failureCount: 0,
      errorMessage: 'Не указаны пользователи для отправки уведомлений',
      reason: 'userIds пустой или не указан'
    };
  }

  try {
    // Получаем токены пользователей
    const tokens = await getFcmTokensByUserIds(userIds);

    if (tokens.length === 0) {
      console.log(`⚠️ Нет FCM токенов для указанных пользователей (${userIds.length} пользователей)`);
      // Проверяем, существуют ли пользователи в БД
      const placeholders = userIds.map(() => '?').join(',');
      const [users] = await pool.execute(
        `SELECT id, email, display_name, fcm_token FROM users WHERE id IN (${placeholders})`,
        userIds
      );
      
      const usersWithoutTokens = users.filter(u => !u.fcm_token || u.fcm_token.trim() === '');
      const usersNotFound = userIds.filter(id => !users.find(u => u.id === id));
      
      let reason = 'У пользователей отсутствуют FCM токены';
      if (usersNotFound.length > 0) {
        reason += `. Пользователи не найдены: ${usersNotFound.join(', ')}`;
      }
      if (usersWithoutTokens.length > 0) {
        const emails = usersWithoutTokens.map(u => u.email || u.id).join(', ');
        reason += `. Пользователи без токенов: ${emails}`;
      }
      
      return { 
        successCount: 0, 
        failureCount: userIds.length,
        errorMessage: 'Не удалось отправить уведомления: у пользователей нет FCM токенов',
        reason: reason
      };
    }

    console.log(`📱 Найдено ${tokens.length} FCM токенов для ${userIds.length} пользователей`);

    // Отправляем уведомления
    const result = await sendPushNotifications({
      title,
      body,
      tokens,
      imageUrl,
      sound,
      data,
    });

    // Если ничего не отправилось, добавляем информацию об ошибке
    if (result.successCount === 0 && result.failureCount > 0) {
      result.errorMessage = 'Не удалось отправить уведомления: все токены невалидны или произошла ошибка при отправке';
      result.reason = result.reason || 'Ошибка при отправке через FCM';
    }

    return result;
  } catch (error) {
    console.error('❌ Ошибка отправки уведомлений пользователям:', error);
    return { 
      successCount: 0, 
      failureCount: userIds.length,
      errorMessage: `Ошибка при отправке уведомлений: ${error.message}`,
      reason: error.message
    };
  }
}

/**
 * Отправка push-уведомления создателю заявки о присоединении/участии
 * @param {Object} options - Параметры уведомления
 * @param {string} options.requestId - ID заявки
 * @param {string} options.requestName - Название заявки
 * @param {string} options.requestCategory - Категория заявки
 * @param {string} options.creatorId - ID создателя заявки
 * @param {string} options.actionUserId - ID пользователя, который выполнил действие
 * @param {string} options.actionType - Тип действия: 'joined' или 'participated'
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendJoinNotification({ requestId, requestName, requestCategory, creatorId, actionUserId, actionType = 'joined' }) {
  // Не отправляем уведомление самому себе
  if (creatorId === actionUserId) {
    console.log('ℹ️ Пропускаем отправку уведомления - пользователь является создателем заявки');
    return { successCount: 0, failureCount: 0 };
  }

  try {
    // Получаем имя пользователя, который выполнил действие
    let actionUserName = 'Пользователь';
    try {
      const [users] = await pool.execute(
        `SELECT display_name, first_name, second_name, email 
         FROM users WHERE id = ?`,
        [actionUserId]
      );
      if (users.length > 0) {
        const user = users[0];
        if (user.display_name) {
          actionUserName = user.display_name;
        } else if (user.first_name || user.second_name) {
          actionUserName = `${user.first_name || ''} ${user.second_name || ''}`.trim();
        } else if (user.email) {
          actionUserName = user.email;
        }
      }
    } catch (e) {
      console.log('⚠️ Ошибка получения данных пользователя:', e);
    }

    // Формируем текст уведомления
    let title, body;
    if (actionType === 'joined') {
      title = 'Someone joined your request';
      body = `${actionUserName} joined your request "${requestName}"`;
    } else if (actionType === 'participated') {
      title = 'Someone joined your event';
      body = `${actionUserName} joined your event "${requestName}"`;
    } else {
      title = 'Someone joined your request';
      body = `${actionUserName} joined your request "${requestName}"`;
    }

    // Формируем deeplink для перехода на заявку
    const categoryPaths = {
      wasteLocation: 'waste_location',
      speedCleanup: 'speed_cleanup',
      event: 'event',
    };
    const categoryPath = categoryPaths[requestCategory] || 'waste_location';
    const deeplink = `https://garbagedev-9c240.web.app/request/${categoryPath}/${requestId}`;

    // Отправляем уведомление создателю
    const result = await sendNotificationToUsers({
      title,
      body,
      userIds: [creatorId],
      sound: 'default',
      data: {
        initialPageName: 'RequestDetails',
        parameterData: JSON.stringify({
          requestId: requestId,
          category: requestCategory,
        }),
        deeplink: deeplink,
      },
    });

    return result;
  } catch (error) {
    console.error('❌ Ошибка отправки уведомления о присоединении:', error);
    return { successCount: 0, failureCount: 0 };
  }
}

/**
 * Отправка push-уведомления создателю заявки о донате
 * @param {Object} options - Параметры уведомления
 * @param {string} options.requestId - ID заявки
 * @param {string} options.requestName - Название заявки
 * @param {string} options.requestCategory - Категория заявки
 * @param {string} options.creatorId - ID создателя заявки
 * @param {string} options.donorId - ID пользователя, который сделал донат
 * @param {number} options.amount - Сумма доната (в центах)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendDonationNotification({ requestId, requestName, requestCategory, creatorId, donorId, amount }) {
  // Не отправляем уведомление самому себе
  if (creatorId === donorId) {
    console.log('ℹ️ Пропускаем отправку уведомления - пользователь является создателем заявки');
    return { successCount: 0, failureCount: 0 };
  }

  try {
    // Получаем имя пользователя, который сделал донат
    let donorName = 'Пользователь';
    try {
      const [users] = await pool.execute(
        `SELECT display_name, first_name, second_name, email 
         FROM users WHERE id = ?`,
        [donorId]
      );
      if (users.length > 0) {
        const user = users[0];
        if (user.display_name) {
          donorName = user.display_name;
        } else if (user.first_name || user.second_name) {
          donorName = `${user.first_name || ''} ${user.second_name || ''}`.trim();
        } else if (user.email) {
          donorName = user.email;
        }
      }
    } catch (e) {
      console.log('⚠️ Ошибка получения данных донатора:', e);
    }

    // Формируем сумму в долларах
    const amountInDollars = (amount / 100).toFixed(2);

    // Формируем текст уведомления
    const title = 'Someone donated to your request';
    const body = `${donorName} donated $${amountInDollars} to your request "${requestName}"`;

    // Формируем deeplink для перехода на заявку
    const categoryPaths = {
      wasteLocation: 'waste_location',
      speedCleanup: 'speed_cleanup',
      event: 'event',
    };
    const categoryPath = categoryPaths[requestCategory] || 'waste_location';
    const deeplink = `https://garbagedev-9c240.web.app/request/${categoryPath}/${requestId}`;

    // Отправляем уведомление создателю
    const result = await sendNotificationToUsers({
      title,
      body,
      userIds: [creatorId],
      sound: 'default',
      data: {
        initialPageName: 'RequestDetails',
        parameterData: JSON.stringify({
          requestId: requestId,
          category: requestCategory,
        }),
        deeplink: deeplink,
      },
    });

    return result;
  } catch (error) {
    console.error('❌ Ошибка отправки уведомления о донате:', error);
    return { successCount: 0, failureCount: 0 };
  }
}

module.exports = {
  sendPushNotifications,
  sendRequestCreatedNotification,
  sendNotificationToUsers,
  sendJoinNotification,
  sendDonationNotification,
  getFcmTokensByUserIds,
  getFcmTokensByRadius,
};

