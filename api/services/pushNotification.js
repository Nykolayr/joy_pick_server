const { admin } = require('../config/firebase');
const pool = require('../config/database');
const { generateId } = require('../utils/uuid');
const { resolveRequestIdFromSendPayload } = require('../utils/adminNotificationSendContext');

/** Макс. отдельных FCM в одной «серии»; при большем — одно сводное (любые типы, см. byType). */
const PUSH_CONSOLIDATE_MAX = Math.max(1, parseInt(process.env.PUSH_CONSOLIDATE_MAX || '3', 10) || 3);
/** Склейка пушей, пришедших подряд (debounce) перед отправкой 1–3 отдельных. При >3 — сразу сводка. */
const PUSH_CONSOLIDATE_DEBOUNCE_MS = Math.max(
  50,
  parseInt(process.env.PUSH_CONSOLIDATE_DEBOUNCE_MS || '250', 10) || 250
);
const PUSH_CONSOLIDATION_DISABLED = process.env.PUSH_CONSOLIDATION_DISABLED === '1' || process.env.PUSH_CONSOLIDATION_DISABLED === 'true';

/** userId -> { entries: Array<{ singleUserArgs, resolve, reject }>, timer } */
const userPushBatches = new Map();

function shouldBypassNotificationConsolidation(outboundLog) {
  if (PUSH_CONSOLIDATION_DISABLED) return true;
  if (outboundLog && outboundLog.send_source === 'admin_manual') return true;
  if (outboundLog && outboundLog.skip_consolidation === true) return true;
  return false;
}

function mergeUserSendResults(results) {
  if (!results.length) {
    return { successCount: 0, failureCount: 0, consolidated: false };
  }
  const merged = { successCount: 0, failureCount: 0, consolidated: false };
  for (const r of results) {
    merged.successCount += r.successCount || 0;
    merged.failureCount += r.failureCount || 0;
    if (r.consolidated) merged.consolidated = true;
    if (r.errorMessage) merged.errorMessage = r.errorMessage;
    if (r.reason) merged.reason = r.reason;
  }
  return merged;
}

function countTypesFromEntries(entries) {
  const counts = {};
  for (const e of entries) {
    const t =
      (e.singleUserArgs && e.singleUserArgs.data && e.singleUserArgs.data.type) || 'app';
    const key = String(t);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function buildConsolidatedNotification(userId, entries) {
  const n = entries.length;
  const byType = countTypesFromEntries(entries);
  const parts = Object.keys(byType)
    .map((k) => `${k}: ${byType[k]}`)
    .join(', ');
  const body =
    n <= 10
      ? `You have ${n} pending alerts (${parts}). Open the app to review.`
      : `You have ${n} pending alerts. Open the app to review.`;
  const data = {
    type: 'consolidated',
    consolidated: 'true',
    totalCount: String(n),
    byType: JSON.stringify(byType),
    initialPageName: 'Profile',
  };
  return {
    title: 'Multiple notifications',
    body,
    userIds: [userId],
    imageUrl: null,
    sound: 'default',
    data,
    outboundLog: {
      send_source: 'system',
      push_trigger: 'consolidated',
      request_id: null,
    },
  };
}

/**
 * Сбрасывает накопленные пуши для одного userId: ≤PUSH_CONSOLIDATE_MAX — по одному;
 * иначе — один сводный (англ. текст, все типы учитываются).
 */
async function flushUserNotificationBatch(userId) {
  const state = userPushBatches.get(userId);
  if (!state) return;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  const entries = state.entries;
  userPushBatches.delete(userId);
  if (!entries || entries.length === 0) return;

  try {
    if (entries.length <= PUSH_CONSOLIDATE_MAX) {
      for (const e of entries) {
        const r = await sendNotificationToUsersImmediate(e.singleUserArgs);
        e.resolve(r);
      }
    } else {
      const cons = buildConsolidatedNotification(userId, entries);
      const r = await sendNotificationToUsersImmediate(cons);
      const resultWithFlag = { ...r, consolidated: true };
      for (const e of entries) {
        e.resolve(resultWithFlag);
      }
    }
  } catch (err) {
    const fail = {
      successCount: 0,
      failureCount: entries.length,
      errorMessage: err.message,
      reason: err.message,
    };
    for (const e of entries) {
      e.resolve(fail);
    }
  }
}

function scheduleOrFlushUserBatch(userId) {
  const state = userPushBatches.get(userId);
  if (!state) return;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.entries.length > PUSH_CONSOLIDATE_MAX) {
    setImmediate(() => {
      flushUserNotificationBatch(userId).catch((err) => {
        console.error('❌ flushUserNotificationBatch:', err);
      });
    });
    return;
  }
  state.timer = setTimeout(() => {
    const s = userPushBatches.get(userId);
    if (s) s.timer = null;
    flushUserNotificationBatch(userId).catch((err) => {
      console.error('❌ flushUserNotificationBatch:', err);
    });
  }, PUSH_CONSOLIDATE_DEBOUNCE_MS);
}

/**
 * Сохранение push-уведомления в базу данных
 * @param {string} userId - ID пользователя
 * @param {string} title - Заголовок уведомления
 * @param {string} body - Текст уведомления
 * @param {Object} data - Дополнительные данные (опционально)
 * @returns {Promise<void>}
 */
async function saveNotificationToDatabase(userId, title, body, data = {}) {
  try {
    const notificationId = generateId();
    await pool.execute(
      'INSERT INTO push_notifications (id, user_id, title, body, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [notificationId, userId, title, body, JSON.stringify(data)]
    );
  } catch (error) {
    console.error(`❌ Ошибка сохранения уведомления в БД для пользователя ${userId}:`, error);
    // Не прерываем выполнение, только логируем ошибку
  }
}

/**
 * Журнал исходящих push (админка GET /notifications/admin/sent): ручные + системные/cron.
 */
async function insertOutboundNotificationSendRow({
  title,
  body,
  imageUrl = null,
  data = {},
  recipientCount,
  successCount,
  failedCount,
  outboundLog = null,
}) {
  try {
    const sendSource =
      outboundLog && outboundLog.send_source === 'admin_manual'
        ? 'admin_manual'
        : 'system';
    const sentByUserId =
      sendSource === 'admin_manual' ? outboundLog.sent_by_user_id || null : null;
    const pushTrigger =
      (outboundLog && outboundLog.push_trigger) ||
      (data && data.type != null ? String(data.type) : null) ||
      'system_push';
    const sendReason =
      (outboundLog && outboundLog.send_reason) || null;
    const requestId =
      (outboundLog && outboundLog.request_id) ||
      resolveRequestIdFromSendPayload({ request_id: null, data: data || {} }) ||
      null;
    const dataObj = data && typeof data === 'object' ? data : {};
    const rowId = generateId();
    await pool.execute(
      `INSERT INTO admin_notification_sends (
        id, title, body, push_trigger, send_reason, request_id, payload_json,
        image_url, sent_by_user_id, send_source,
        recipient_count, success_count, failed_count, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?, NOW())`,
      [
        rowId,
        title,
        body,
        pushTrigger,
        sendReason,
        requestId,
        JSON.stringify(dataObj),
        imageUrl || null,
        sentByUserId,
        sendSource,
        recipientCount,
        successCount,
        failedCount,
      ]
    );
  } catch (err) {
    console.error('❌ Ошибка записи журнала admin_notification_sends:', err.message || err);
  }
}

/**
 * Получение ID всех администраторов (модераторов)
 * @returns {Promise<Array<string>>} Массив ID администраторов
 */
async function getAllAdminIds() {
  try {
    const [admins] = await pool.execute(
      'SELECT id FROM users WHERE admin = TRUE AND fcm_token IS NOT NULL AND fcm_token != ""'
    );
    return admins.map(admin => admin.id);
  } catch (error) {
    console.error('❌ Ошибка получения списка администраторов:', error);
    return [];
  }
}

/**
 * Получение ID суперадминов (для пушей о сбоях выплат)
 * @returns {Promise<Array<string>>} Массив ID пользователей с super_admin = TRUE
 */
async function getSuperAdminIds() {
  try {
    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE super_admin = TRUE AND fcm_token IS NOT NULL AND fcm_token != ""'
    );
    return rows.map(r => r.id);
  } catch (error) {
    return [];
  }
}

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
    const pushData = {
      initialPageName: 'RequestDetails',
      parameterData: JSON.stringify({
        requestId: id,
        category: category,
      }),
      deeplink: deeplink,
    };

    const result = await sendPushNotifications({
      title: notificationTitle,
      body: notificationBody,
      tokens,
      imageUrl: firstPhoto,
      sound: 'default',
      data: pushData,
    });

    await insertOutboundNotificationSendRow({
      title: notificationTitle,
      body: notificationBody,
      imageUrl: firstPhoto,
      data: pushData,
      recipientCount: tokens.length,
      successCount: result.successCount,
      failedCount: result.failureCount,
      outboundLog: {
        send_source: 'system',
        push_trigger: 'request_created_nearby',
        request_id: id,
      },
    });

    return result;
  } catch (error) {
    console.error('❌ Ошибка отправки уведомления о создании заявки:', error);
    return { successCount: 0, failureCount: 0 };
  }
}

/**
 * Отправка push-уведомлений конкретным пользователям (без объединения в батч).
 * @param {Object} options - Параметры уведомления
 */
async function sendNotificationToUsersImmediate({
  title,
  body,
  userIds,
  imageUrl = null,
  sound = 'default',
  data = {},
  outboundLog = null,
}) {
  if (!userIds || userIds.length === 0) {
    console.log('ℹ️ Нет пользователей для отправки уведомлений');
    return { 
      successCount: 0, 
      failureCount: 0,
      errorMessage: 'No users specified for sending notifications',
      reason: 'userIds is empty or not specified'
    };
  }

  const recipientCount = userIds.length;

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
      
      let reason = 'Users have no FCM tokens';
      if (usersNotFound.length > 0) {
        reason += `. Users not found: ${usersNotFound.join(', ')}`;
      }
      if (usersWithoutTokens.length > 0) {
        const emails = usersWithoutTokens.map(u => u.email || u.id).join(', ');
        reason += `. Users without tokens: ${emails}`;
      }

      await insertOutboundNotificationSendRow({
        title,
        body,
        imageUrl,
        data,
        recipientCount,
        successCount: 0,
        failedCount: recipientCount,
        outboundLog,
      });
      
      return { 
        successCount: 0, 
        failureCount: userIds.length,
        errorMessage: 'Failed to send notifications: users have no FCM tokens',
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

    // Сохраняем уведомления в БД для всех пользователей (даже если FCM отправка не удалась)
    // Это нужно для истории уведомлений
    for (const userId of userIds) {
      await saveNotificationToDatabase(userId, title, body, data);
    }

    // Если ничего не отправилось, добавляем информацию об ошибке
    if (result.successCount === 0 && result.failureCount > 0) {
      result.errorMessage = 'Failed to send notifications: all tokens invalid or send error';
      result.reason = result.reason || 'Error sending via FCM';
    }

    await insertOutboundNotificationSendRow({
      title,
      body,
      imageUrl,
      data,
      recipientCount,
      successCount: result.successCount,
      failedCount: result.failureCount,
      outboundLog,
    });

    return result;
  } catch (error) {
    console.error('❌ Ошибка отправки уведомлений пользователям:', error);
    await insertOutboundNotificationSendRow({
      title,
      body,
      imageUrl,
      data,
      recipientCount,
      successCount: 0,
      failedCount: recipientCount,
      outboundLog,
    });
    return { 
      successCount: 0, 
      failureCount: userIds.length,
      errorMessage: `Error sending notifications: ${error.message}`,
      reason: error.message
    };
  }
}

/**
 * Те же пуши, что и sendNotificationToUsersImmediate, но с батчингом по пользователю:
 * подряд debounce PUSH_CONSOLIDATE_DEBOUNCE_MS; если за одну «серию» > PUSH_CONSOLIDATE_MAX — сразу одно сводное FCM
 * (любые типы). Ручной POST /send (admin_manual) и PUSH_CONSOLIDATION_DISABLED=1 — без батча.
 * @param {Object} [options.outboundLog] - при outboundLog.skip_consolidation: true — отправить сразу.
 */
async function sendNotificationToUsers(args) {
  const {
    title,
    body,
    userIds,
    imageUrl = null,
    sound = 'default',
    data = {},
    outboundLog = null,
  } = args;

  if (!userIds || userIds.length === 0) {
    return {
      successCount: 0,
      failureCount: 0,
      errorMessage: 'No users specified for sending notifications',
      reason: 'userIds is empty or not specified',
    };
  }

  if (shouldBypassNotificationConsolidation(outboundLog)) {
    return sendNotificationToUsersImmediate(args);
  }

  const uniqueUserIds = [...new Set(userIds)];
  const partPromises = uniqueUserIds.map(
    (uid) =>
      new Promise((resolve) => {
        const singleUserArgs = {
          title,
          body,
          userIds: [uid],
          imageUrl,
          sound,
          data,
          outboundLog,
        };
        if (!userPushBatches.has(uid)) {
          userPushBatches.set(uid, { entries: [], timer: null });
        }
        const st = userPushBatches.get(uid);
        st.entries.push({
          singleUserArgs,
          resolve,
        });
        scheduleOrFlushUserBatch(uid);
      })
  );
  const results = await Promise.all(partPromises);
  return mergeUserSendResults(results);
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

    // Формируем текст уведомления (согласно концепции)
    let title, body;
    if (actionType === 'joined') {
      title = 'Someone joined your request';
      body = 'Someone joined your request!';
    } else if (actionType === 'participated') {
      title = 'Someone joined your event';
      body = 'Someone joined your event!';
    } else if (actionType === 'unjoined') {
      title = 'Someone left your request';
      body = 'Someone left your request!';
    } else {
      title = 'Someone joined your request';
      body = 'Someone joined your request!';
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

/**
 * Отправка push-уведомления для speedCleanup заявки
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей (создатель + донатеры)
 * @param {boolean} options.earnedCoin - Заработан ли коин (true) или нет (false)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
/**
 * Отправка уведомления для speedCleanup заявок
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей
 * @param {boolean} options.earnedCoin - Заработан ли коин (для донатеров)
 * @param {string} options.messageType - 'donor' | 'executor' (донаты после одобрения при архиве) | 'executorArchiveNoDonations' (архив без таких донатов)
 * @param {string} options.requestId - ID заявки (для deeplink у исполнителя)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendSpeedCleanupNotification({ userIds, earnedCoin, messageType = 'donor', requestId = null }) {
  let title, body;
  
  if (messageType === 'executor') {
    // Уведомление исполнителю о получении донатов
    title = 'Donations Received';
    body = 'You have received donations for your cleanup work!';
  } else if (messageType === 'executorArchiveNoDonations') {
    title = 'Request completed';
    body = 'Your speed cleanup request has been archived.';
  } else {
    // Уведомление донатерам о коинах
    title = 'Thank you!';
    body = earnedCoin 
      ? 'You\'ve earned a coin for your cleanup work!'
      : 'Try to work a bit longer next time to earn a coin.';
  }

  const data = {
    type: 'speedCleanup',
    earnedCoin: earnedCoin,
    messageType: messageType,
  };

  if (
    requestId &&
    (messageType === 'executor' || messageType === 'executorArchiveNoDonations')
  ) {
    data.deeplink = `joypick://speed_cleanup/${requestId}`;
  }

  return await sendNotificationToUsers({
    title,
    body,
    userIds,
    sound: 'default',
    data,
  });
}

/**
 * Отправка уведомления о том, что заявка отправлена на рассмотрение
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей (создатель)
 * @param {string} options.requestId - ID заявки
 * @param {string} options.requestCategory - Категория заявки (опционально, для deeplink)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendRequestSubmittedNotification({ userIds, requestId, requestCategory = 'wasteLocation' }) {
  const title = 'Request Submitted';
  const body = 'Your request has been submitted for review!';

  // Формируем deeplink для перехода на заявку
  const categoryPaths = {
    wasteLocation: 'waste_location',
    speedCleanup: 'speed_cleanup',
    event: 'event',
  };
  const categoryPath = categoryPaths[requestCategory] || 'waste_location';
  const deeplink = `https://garbagedev-9c240.web.app/request/${categoryPath}/${requestId}`;

  return await sendNotificationToUsers({
    title,
    body,
    userIds,
    sound: 'default',
    data: {
      type: 'requestSubmitted',
      requestId: requestId,
      initialPageName: 'RequestDetails',
      parameterData: JSON.stringify({
        requestId: requestId,
        category: requestCategory,
      }),
      deeplink: deeplink,
    },
  });
}

/**
 * Отправка уведомления об одобрении заявки
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей
 * @param {string} options.requestId - ID заявки
 * @param {string} options.messageType - Тип сообщения: 'creator', 'executor', 'donor', 'participant'
 * @param {string} options.requestCategory - Категория заявки (опционально, для deeplink)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendRequestApprovedNotification({ userIds, requestId, messageType = 'creator', requestCategory = 'wasteLocation', payoutAmount = null }) {
  const messages = {
    creator: { 
      title: payoutAmount ? '💰 Request approved!' : 'Thank you!', 
      body: payoutAmount 
        ? `Request approved! You will receive $${payoutAmount}. Get it automatically or instantly in your profile.`
        : 'Thank you for your initiative!' 
    },
    executor: { 
      title: payoutAmount ? '💰 Request approved!' : 'Thank you!', 
      body: payoutAmount 
        ? `Request approved! You will receive $${payoutAmount}. Get it automatically or instantly in your profile.`
        : 'Thank you for completing the request!' 
    },
    donor: { title: 'Thank you!', body: 'Thank you for your donation!' },
    participant: { 
      title: payoutAmount ? '💰 Request approved!' : 'Thank you!', 
      body: payoutAmount 
        ? `Request approved! You will receive $${payoutAmount}. Get it automatically or instantly in your profile.`
        : 'Thank you for participating in the event!' 
    },
  };

  const message = messages[messageType] || messages.creator;

  // Формируем deeplink для перехода на заявку
  const categoryPaths = {
    wasteLocation: 'waste_location',
    speedCleanup: 'speed_cleanup',
    event: 'event',
  };
  const categoryPath = categoryPaths[requestCategory] || 'waste_location';
  const deeplink = `https://garbagedev-9c240.web.app/request/${categoryPath}/${requestId}`;

  return await sendNotificationToUsers({
    title: message.title,
    body: message.body,
    userIds,
    sound: 'default',
    data: {
      type: 'requestApproved',
      requestId: requestId,
      messageType: messageType,
      payoutAmount: payoutAmount ? payoutAmount.toString() : null,
      hasPayoutAvailable: payoutAmount ? 'true' : 'false',
      initialPageName: payoutAmount && (messageType === 'executor' || messageType === 'participant') ? 'Profile' : 'RequestDetails',
      parameterData: JSON.stringify({
        requestId: requestId,
        category: requestCategory,
        payoutAmount: payoutAmount,
      }),
      deeplink: deeplink,
    },
  });
}

/**
 * Отправка уведомления об отклонении заявки
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей
 * @param {string} options.requestId - ID заявки
 * @param {string} options.messageType - Тип сообщения: 'creator', 'donor'
 * @param {string} options.rejectionMessage - Сообщение об отклонении
 * @param {string} options.requestCategory - Категория заявки (опционально, для deeplink)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendRequestRejectedNotification({
  userIds,
  requestId,
  messageType = 'creator',
  rejectionMessage = null,
  requestCategory = 'wasteLocation',
  primaryCode = null,
  messageKey = null,
}) {
  const { resolveRejectionNotificationText } = require('../utils/rejectionNotificationText');
  const resolved = resolveRejectionNotificationText({
    rejectionMessage,
    primaryCode,
    messageKey,
    messageType,
  });

  const title = 'Request Rejected';
  const body = resolved.body;

  const categoryPaths = {
    wasteLocation: 'waste_location',
    speedCleanup: 'speed_cleanup',
    event: 'event',
  };
  const categoryPath = categoryPaths[requestCategory] || 'waste_location';
  const deeplink = `https://garbagedev-9c240.web.app/request/${categoryPath}/${requestId}`;

  return await sendNotificationToUsers({
    title,
    body,
    userIds,
    sound: 'default',
    data: {
      type: 'request_rejected',
      requestId,
      messageType,
      primary_code: resolved.primaryCode || '',
      message_key: resolved.messageKey || '',
      title_key: resolved.titleKey || '',
      initialPageName: 'RequestDetails',
      parameterData: JSON.stringify({
        requestId,
        category: requestCategory,
        primary_code: resolved.primaryCode || '',
        message_key: resolved.messageKey || '',
      }),
      deeplink,
    },
  });
}

/**
 * Отправка напоминания исполнителю за 2 часа до окончания срока
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей (исполнитель)
 * @param {string} options.requestId - ID заявки
 * @param {string} options.requestCategory - Категория заявки (опционально, для deeplink)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendReminderNotification({ userIds, requestId, requestCategory = 'wasteLocation' }) {
  const title = 'Reminder';
  const body = 'You have 2 hours left to complete the request!';

  // Формируем deeplink для перехода на заявку
  const categoryPaths = {
    wasteLocation: 'waste_location',
    speedCleanup: 'speed_cleanup',
    event: 'event',
  };
  const categoryPath = categoryPaths[requestCategory] || 'waste_location';
  const deeplink = `https://garbagedev-9c240.web.app/request/${categoryPath}/${requestId}`;

  return await sendNotificationToUsers({
    title,
    body,
    userIds,
    sound: 'default',
    data: {
      type: 'reminder',
      requestId: requestId,
      initialPageName: 'RequestDetails',
      parameterData: JSON.stringify({
        requestId: requestId,
        category: requestCategory,
      }),
      deeplink: deeplink,
    },
  });
}

/**
 * Отправка уведомления о том, что заявка не выполнена в срок
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей
 * @param {string} options.requestId - ID заявки
 * @param {string} options.messageType - Тип сообщения: 'executor', 'creator'
 * @param {string} options.requestCategory - Категория заявки (опционально, для deeplink)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendRequestExpiredNotification({ userIds, requestId, messageType = 'executor', requestCategory = 'wasteLocation' }) {
  const messages = {
    executor: { 
      title: 'Request Expired', 
      body: 'You didn\'t complete the request on time. Please try to be more responsible next time.' 
    },
    creator: { 
      title: 'Request Expired', 
      body: 'The request was not completed on time and is now available for everyone again.' 
    },
  };

  const message = messages[messageType] || messages.executor;

  // Формируем deeplink для перехода на заявку
  const categoryPaths = {
    wasteLocation: 'waste_location',
    speedCleanup: 'speed_cleanup',
    event: 'event',
  };
  const categoryPath = categoryPaths[requestCategory] || 'waste_location';
  const deeplink = `https://garbagedev-9c240.web.app/request/${categoryPath}/${requestId}`;

  return await sendNotificationToUsers({
    title: message.title,
    body: message.body,
    userIds,
    sound: 'default',
    data: {
      type: 'requestExpired',
      requestId: requestId,
      messageType: messageType,
      initialPageName: 'RequestDetails',
      parameterData: JSON.stringify({
        requestId: requestId,
        category: requestCategory,
      }),
      deeplink: deeplink,
    },
  });
}

/**
 * Отправка уведомления о времени до события (для event)
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей (участники или заказчик)
 * @param {string} options.requestId - ID заявки
 * @param {string} options.messageType - Тип сообщения: '24hours', '2hours', 'start'
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendEventTimeNotification({ userIds, requestId, messageType = '24hours' }) {
  const messages = {
    '24hours': { title: 'Event Reminder', body: 'Event starts in 24 hours!' },
    '2hours': { title: 'Event Reminder', body: 'Event starts in 2 hours!' },
    'start': { title: 'Event Started', body: 'Time to start the event!' },
  };

  const message = messages[messageType] || messages['24hours'];

  // Формируем deeplink для перехода на заявку
  const categoryPath = 'event';
  const deeplink = `https://garbagedev-9c240.web.app/request/${categoryPath}/${requestId}`;

  return await sendNotificationToUsers({
    title: message.title,
    body: message.body,
    userIds,
    sound: 'default',
    data: {
      type: 'eventTime',
      requestId: requestId,
      messageType: messageType,
      initialPageName: 'RequestDetails',
      parameterData: JSON.stringify({
        requestId: requestId,
        category: 'event',
      }),
      deeplink: deeplink,
    },
  });
}

/**
 * Отправка напоминания о завершении event и отправке на модерацию
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей (обычно создатель)
 * @param {string} options.requestId - ID заявки
 * @param {string} options.eventName - Название события
 * @param {number} options.hoursRemaining - Сколько часов осталось (обычно 24)
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendEventCompletionReminderNotification({ userIds, requestId, eventName, hoursRemaining = 24 }) {
  const title = 'Напоминание о завершении события';
  const body = `Ваше событие "${eventName}" состоялось более 24 часов назад. У вас есть ${hoursRemaining} часа, чтобы отправить его на модерацию, иначе заявка будет удалена, а средства возвращены.`;

  // Формируем deeplink для перехода на заявку
  const categoryPath = 'event';
  const deeplink = `https://garbagedev-9c240.web.app/request/${categoryPath}/${requestId}`;

  return await sendNotificationToUsers({
    title,
    body,
    userIds,
    sound: 'default',
    data: {
      type: 'eventCompletionReminder',
      requestId: requestId,
      hoursRemaining: hoursRemaining.toString(),
      initialPageName: 'RequestDetails',
      parameterData: JSON.stringify({
        requestId: requestId,
        category: 'event',
      }),
      deeplink: deeplink,
    },
  });
}

/**
 * Отправка push-уведомления модераторам о новой заявке на модерации
 * @param {Object} options - Параметры уведомления
 * @param {string} options.requestId - ID заявки
 * @param {string} options.requestName - Название заявки
 * @param {string} options.requestCategory - Категория заявки
 * @param {string} options.creatorName - Имя создателя заявки
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendModerationNotification({ requestId, requestName, requestCategory, creatorName }) {
  try {
    // Получаем всех администраторов
    const adminIds = await getAllAdminIds();

    if (adminIds.length === 0) {
      console.log('ℹ️ Нет администраторов для отправки уведомления о модерации');
      return { successCount: 0, failureCount: 0 };
    }

    // Формируем название категории
    const categoryDisplayNames = {
      wasteLocation: 'Waste Location',
      speedCleanup: 'Speed Cleanup',
      event: 'Event',
    };
    const categoryDisplayName = categoryDisplayNames[requestCategory] || 'Request';

    // Формируем deeplink для админ-панели
    // Формат: https://garbagedev-9c240.web.app/admin/requests/{requestId}
    const deeplink = `https://garbagedev-9c240.web.app/admin/requests/${requestId}`;

    // Формируем текст уведомления
    const notificationTitle = 'New Request for Moderation';
    const notificationBody = `${categoryDisplayName}: "${requestName}"\nCreated by: ${creatorName}`;

    // Отправляем уведомления всем модераторам
    const result = await sendNotificationToUsers({
      title: notificationTitle,
      body: notificationBody,
      userIds: adminIds,
      sound: 'default',
      data: {
        type: 'moderation',
        requestId: requestId,
        requestCategory: requestCategory,
        initialPageName: 'AdminRequestDetails',
        parameterData: JSON.stringify({
          requestId: requestId,
          category: requestCategory,
        }),
        deeplink: deeplink,
      },
    });

    return result;
  } catch (error) {
    console.error('❌ Ошибка отправки уведомления модераторам:', error);
    return { successCount: 0, failureCount: 0 };
  }
}

/**
 * Напоминание модераторам: заявка в pending дольше положенного (нужен апрув или архив по SLA).
 */
/**
 * Пуш модераторам: предложен auto-reject, можно вмешаться до финализации.
 */
async function sendModerationAutoRejectPendingNotification({
  requestId,
  requestName,
  requestCategory,
  finalizeAt,
  donationsCount = 0,
  donationsTotal = 0,
  reasonCode = null,
}) {
  try {
    const adminIds = await getAllAdminIds();
    if (adminIds.length === 0) {
      return { successCount: 0, failureCount: 0 };
    }
    const categoryDisplayNames = {
      wasteLocation: 'Waste Location',
      speedCleanup: 'Speed Cleanup',
      event: 'Event',
    };
    const categoryDisplayName = categoryDisplayNames[requestCategory] || 'Request';
    const deeplink = `https://garbagedev-9c240.web.app/admin/requests/${requestId}`;
    const donatePart =
      donationsCount > 0
        ? ` Donations: ${donationsCount} ($${Number(donationsTotal).toFixed(2)}).`
        : ' No donations.';
    const reasonPart = reasonCode ? ` Reason: ${reasonCode}.` : '';
    const title = 'Auto-moderation: proposed reject';
    const body = `${categoryDisplayName}: "${(requestName || '').slice(0, 60)}" — reject scheduled.${donatePart}${reasonPart} Review before ${finalizeAt || 'deadline'}.`;

    return await sendNotificationToUsers({
      title,
      body,
      userIds: adminIds,
      sound: 'default',
      data: {
        type: 'moderation_auto_reject_pending',
        requestId,
        requestCategory,
        initialPageName: 'AdminRequestDetails',
        parameterData: JSON.stringify({ requestId, category: requestCategory }),
        deeplink,
      },
    });
  } catch (error) {
    console.error('❌ sendModerationAutoRejectPendingNotification:', error);
    return { successCount: 0, failureCount: 0 };
  }
}

async function sendModerationStaleReminderNotification({
  requestId,
  requestName,
  requestCategory,
  daysWaiting = 7
}) {
  try {
    const adminIds = await getAllAdminIds();
    if (adminIds.length === 0) {
      return { successCount: 0, failureCount: 0 };
    }
    const categoryDisplayNames = {
      wasteLocation: 'Waste Location',
      speedCleanup: 'Speed Cleanup',
      event: 'Event'
    };
    const categoryDisplayName = categoryDisplayNames[requestCategory] || 'Request';
    const deeplink = `https://garbagedev-9c240.web.app/admin/requests/${requestId}`;
    const title = 'Moderation: request waiting too long';
    const body = `${categoryDisplayName}: "${(requestName || '').slice(0, 80)}" — ${daysWaiting}+ days in pending. Approve or it will auto-archive with refunds.`;

    return await sendNotificationToUsers({
      title,
      body,
      userIds: adminIds,
      sound: 'default',
      data: {
        type: 'moderation_stale',
        requestId,
        requestCategory,
        initialPageName: 'AdminRequestDetails',
        parameterData: JSON.stringify({ requestId, category: requestCategory }),
        deeplink
      }
    });
  } catch (error) {
    console.error('❌ Ошибка sendModerationStaleReminderNotification:', error);
    return { successCount: 0, failureCount: 0 };
  }
}

/**
 * Отправка push-уведомления волонтёру о получении выплаты
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей
 * @param {string} options.transferId - ID transfer
 * @param {number} options.amountCents - Сумма в центах
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendTransferPaidNotification({ userIds, transferId, amountCents }) {
  const amountDollars = (amountCents / 100).toFixed(2);
  
  return await sendNotificationToUsers({
    title: 'Payment Received',
    body: `You received $${amountDollars} for completing the request`,
    userIds,
    sound: 'default',
    data: {
      type: 'transferPaid',
      transferId: transferId,
      amountCents: amountCents.toString(),
      initialPageName: 'PaymentsHistory',
    },
  });
}

/**
 * Отправка push-уведомления волонтёру об ошибке выплаты
 * @param {Object} options - Параметры уведомления
 * @param {Array<string>} options.userIds - Массив ID пользователей
 * @param {string} options.transferId - ID transfer
 * @returns {Promise<{successCount: number, failureCount: number}>} Результат отправки
 */
async function sendTransferFailedNotification({ userIds, transferId }) {
  return await sendNotificationToUsers({
    title: 'Payment Failed',
    body: 'There was an error processing your payment. Please contact support.',
    userIds,
    sound: 'default',
    data: {
      type: 'transferFailed',
      transferId: transferId,
      initialPageName: 'PaymentsHistory',
    },
  });
}

/**
 * Пуш получателю: деньги перечислены и доступны в приложении (после проверки cron)
 */
async function sendTransferAvailableToUserNotification({ userId, amountDollars }) {
  return await sendNotificationToUsers({
    title: 'Money transferred',
    body: `$${amountDollars} has been transferred. You can get it in the app.`,
    userIds: [userId],
    sound: 'default',
    data: {
      type: 'transferAvailable',
      initialPageName: 'Profile',
    },
  });
}

/**
 * Пуш суперадминам: проверка выплаты не прошла (деньги не дошли после 2 проверок)
 */
async function sendTransferCheckFailedToSuperAdmins({ transferId, performerUserId, amountCents, requestId, details }) {
  const superAdminIds = await getSuperAdminIds();
  if (superAdminIds.length === 0) return { successCount: 0, failureCount: 0 };
  const amountDollars = (amountCents / 100).toFixed(2);
  const body = `Transfer ${transferId}: $${amountDollars} to user ${performerUserId}, request ${requestId}. ${details || 'Money not available after check.'}`;
  return await sendNotificationToUsers({
    title: 'Transfer check failed',
    body,
    userIds: superAdminIds,
    sound: 'default',
    data: {
      type: 'transferCheckFailed',
      transferId,
      performerUserId,
      requestId,
      amountCents: String(amountCents),
    },
  });
}

/**
 * Отправка уведомления о статусе мгновенной выплаты
 */
async function sendPayoutNotification({ userId, payoutId, amount, status, failureCode, failureMessage }) {
  try {
    const userIds = Array.isArray(userId) ? userId : [userId];
    const tokens = await getFcmTokensByUserIds(userIds);
    
    if (tokens.length === 0) {
      console.log('🔕 No FCM tokens for payout notification');
      return;
    }

    let title, body, data;
    
    if (status === 'paid') {
      title = '💰 Payout received';
      body = `Instant payout $${amount} successfully transferred to your card`;
      data = {
        type: 'payout_success',
        payout_id: payoutId,
        amount: amount,
        status: status
      };
    } else if (status === 'failed') {
      title = '❌ Payout failed';
      body = `Failed to process payout $${amount}. ${failureMessage || 'Please check your card details'}`;
      data = {
        type: 'payout_failed',
        payout_id: payoutId,
        amount: amount,
        status: status,
        failure_code: failureCode,
        failure_message: failureMessage
      };
    } else {
      // Other statuses (pending, in_transit)
      title = '⏳ Payout processing';
      body = `Payout $${amount} is being processed`;
      data = {
        type: 'payout_processing',
        payout_id: payoutId,
        amount: amount,
        status: status
      };
    }

    const message = {
      notification: {
        title: title,
        body: body
      },
      data: data,
      tokens: tokens
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`✅ Payout notification sent: ${response.successCount}/${tokens.length}`);
    
    if (response.failureCount > 0) {
      console.log('❌ Payout notification errors:', response.responses
        .filter(r => !r.success)
        .map(r => r.error?.message)
      );
    }

  } catch (error) {
    console.error('❌ Error sending payout push notification:', error);
  }
}

module.exports = {
  sendPushNotifications,
  sendRequestCreatedNotification,
  sendNotificationToUsers,
  sendJoinNotification,
  sendDonationNotification,
  sendSpeedCleanupNotification,
  sendRequestSubmittedNotification,
  sendRequestApprovedNotification,
  sendRequestRejectedNotification,
  sendReminderNotification,
  sendRequestExpiredNotification,
  sendEventTimeNotification,
  sendEventCompletionReminderNotification,
  sendModerationNotification,
  sendModerationAutoRejectPendingNotification,
  sendModerationStaleReminderNotification,
  sendTransferPaidNotification,
  sendTransferFailedNotification,
  sendTransferAvailableToUserNotification,
  sendTransferCheckFailedToSuperAdmins,
  sendPayoutNotification,
  getFcmTokensByUserIds,
  getFcmTokensByRadius,
  getSuperAdminIds,
};

