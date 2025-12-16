const pool = require('../config/database');
const { generateId } = require('./uuid');

/**
 * Добавить пользователя в чат
 * @param {string} chatId - ID чата
 * @param {string} userId - ID пользователя
 */
async function addUserToChat(chatId, userId) {
  try {
    // Сначала проверяем, существует ли запись
    const [existing] = await pool.execute(
      `SELECT id FROM chat_participants WHERE chat_id = ? AND user_id = ?`,
      [chatId, userId]
    );
    
    if (existing.length > 0) {
      // Запись существует, просто обновляем joined_at
      await pool.execute(
        `UPDATE chat_participants SET joined_at = NOW() WHERE chat_id = ? AND user_id = ?`,
        [chatId, userId]
      );
    } else {
      // Записи нет, создаем новую с id
      const participantId = generateId();
      await pool.execute(
        `INSERT INTO chat_participants (id, chat_id, user_id, joined_at)
         VALUES (?, ?, ?, NOW())`,
        [participantId, chatId, userId]
      );
    }
    
    // Проверяем, что запись действительно создана/обновлена
    const [check] = await pool.execute(
      `SELECT COUNT(*) as count FROM chat_participants WHERE chat_id = ? AND user_id = ?`,
      [chatId, userId]
    );
    
    if (check[0].count === 0) {
      throw new Error(`Запись не была создана в chat_participants для chat_id=${chatId}, user_id=${userId}`);
    }
  } catch (err) {
    // Передаем детальную информацию об ошибке
    const errorDetails = {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage,
      sql: `INSERT INTO chat_participants (chat_id, user_id, joined_at) VALUES ('${chatId}', '${userId}', NOW()) ON DUPLICATE KEY UPDATE joined_at = NOW()`,
      chatId,
      userId
    };
    const enhancedError = new Error(`Ошибка добавления пользователя ${userId} в чат ${chatId}: ${err.message}`);
    enhancedError.originalError = err;
    enhancedError.details = errorDetails;
    throw enhancedError;
  }
}

/**
 * Получить ID группового чата для заявки
 * @param {string} requestId - ID заявки
 * @returns {Promise<string|null>} - ID чата или null
 */
async function getGroupChatIdByRequest(requestId) {
  const [chats] = await pool.execute(
    `SELECT id FROM chats WHERE type = 'group' AND request_id = ?`,
    [requestId]
  );
  return chats.length > 0 ? chats[0].id : null;
}

/**
 * Создать групповой чат для заявки и добавить создателя
 * @param {string} requestId - ID заявки
 * @param {string} createdBy - ID создателя заявки
 * @param {string} category - Категория заявки
 * @returns {Promise<string>} - ID созданного чата
 */
async function createGroupChatForRequest(requestId, createdBy, category) {
  // Проверяем, существует ли уже групповой чат
  const existingChatId = await getGroupChatIdByRequest(requestId);
  if (existingChatId) {
    // Чат уже существует, добавляем создателя (на случай если его там нет)
    await addUserToChat(existingChatId, createdBy);
    return existingChatId;
  }

  // Создаем новый групповой чат
  const chatId = generateId();
  await pool.execute(
    `INSERT INTO chats (id, type, request_id, created_by, created_at, last_message_at)
     VALUES (?, 'group', ?, ?, NOW(), NOW())`,
    [chatId, requestId, createdBy]
  );

  // Добавляем создателя в участники
  try {
    await addUserToChat(chatId, createdBy);
  } catch (err) {
    // Если ошибка при добавлении, передаем все детали
    const errorDetails = {
      message: err.message || 'Неизвестная ошибка',
      originalError: err.originalError ? {
        message: err.originalError.message,
        code: err.originalError.code,
        errno: err.originalError.errno,
        sqlState: err.originalError.sqlState,
        sqlMessage: err.originalError.sqlMessage
      } : null,
      details: err.details || null,
      chatId,
      createdBy,
      requestId
    };
    const enhancedError = new Error(`Не удалось добавить создателя ${createdBy} в участники чата ${chatId}: ${err.message}`);
    enhancedError.originalError = err.originalError || err;
    enhancedError.details = errorDetails;
    throw enhancedError;
  }

  return chatId;
}

/**
 * Добавить пользователя в групповой чат заявки
 * @param {string} requestId - ID заявки
 * @param {string} userId - ID пользователя
 */
async function addUserToGroupChatByRequest(requestId, userId) {
  try {
    const chatId = await getGroupChatIdByRequest(requestId);
    if (!chatId) {
      // Чат не существует, получаем данные заявки и создаем чат
      const [requests] = await pool.execute(
        `SELECT created_by, category FROM requests WHERE id = ?`,
        [requestId]
      );
      if (requests.length === 0) {
        const error = new Error(`Заявка ${requestId} не найдена`);
        error.requestId = requestId;
        error.userId = userId;
        throw error;
      }
      const request = requests[0];
      const newChatId = await createGroupChatForRequest(requestId, request.created_by, request.category);
      // Если пользователь не создатель, добавляем его
      if (request.created_by !== userId) {
        await addUserToChat(newChatId, userId);
      }
    } else {
      // Чат существует, просто добавляем пользователя
      await addUserToChat(chatId, userId);
    }
  } catch (err) {
    // Если ошибка уже обработана (из addUserToChat или createGroupChatForRequest), пробрасываем дальше
    if (err.originalError || err.details) {
      throw err;
    }
    // Иначе оборачиваем в детальную ошибку
    const errorDetails = {
      message: err.message,
      requestId,
      userId,
      chatId: err.chatId || null
    };
    const enhancedError = new Error(`Ошибка добавления пользователя ${userId} в групповой чат заявки ${requestId}: ${err.message}`);
    enhancedError.originalError = err;
    enhancedError.details = errorDetails;
    throw enhancedError;
  }
}

/**
 * Удалить пользователя из чата
 * @param {string} chatId - ID чата
 * @param {string} userId - ID пользователя
 */
async function removeUserFromChat(chatId, userId) {
  await pool.execute(
    `DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?`,
    [chatId, userId]
  );
}

/**
 * Удалить пользователя из группового чата заявки
 * @param {string} requestId - ID заявки
 * @param {string} userId - ID пользователя
 */
async function removeUserFromGroupChatByRequest(requestId, userId) {
  const chatId = await getGroupChatIdByRequest(requestId);
  if (chatId) {
    await removeUserFromChat(chatId, userId);
  }
}

/**
 * Удалить групповой чат заявки
 * @param {string} requestId - ID заявки
 */
async function deleteGroupChatForRequest(requestId) {
  await pool.execute(
    `DELETE FROM chats WHERE type = 'group' AND request_id = ?`,
    [requestId]
  );
}

module.exports = {
  addUserToChat,
  removeUserFromChat,
  createGroupChatForRequest,
  addUserToGroupChatByRequest,
  removeUserFromGroupChatByRequest,
  deleteGroupChatForRequest,
  getGroupChatIdByRequest
};
