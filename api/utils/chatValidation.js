/**
 * Утилиты для валидации типов чатов
 */

const pool = require('../config/database');

/**
 * Валидация типа чата по его полям
 * @param {Object} chat - Объект чата из БД
 * @returns {Object} - { isValid: boolean, expectedType: string, actualType: string, errors: Array }
 */
function validateChatType(chat) {
  const errors = [];
  const { type, request_id, user_id } = chat;

  // Получаем количество участников
  let participantsCount = 0;
  if (chat.participants_count !== undefined) {
    participantsCount = parseInt(chat.participants_count) || 0;
  }

  // Определяем ожидаемый тип на основе полей
  let expectedType = null;

  if (request_id === null && user_id !== null) {
    expectedType = 'support';
  } else if (request_id !== null && user_id !== null) {
    expectedType = 'private';
    if (participantsCount !== 2) {
      errors.push(`Для private чата должно быть ровно 2 участника, найдено: ${participantsCount}`);
    }
  } else if (request_id !== null && user_id === null) {
    expectedType = 'group';
    if (participantsCount < 2) {
      errors.push(`Для group чата должно быть минимум 2 участника, найдено: ${participantsCount}`);
    }
  } else {
    errors.push('Невозможно определить тип чата: несоответствие полей request_id и user_id');
  }

  // Проверяем соответствие типа
  if (expectedType && type !== expectedType) {
    errors.push(`Несоответствие типа чата: ожидается '${expectedType}', но установлен '${type}'`);
  }

  // Дополнительные проверки для каждого типа
  if (type === 'support') {
    if (request_id !== null) {
      errors.push('Для support чата request_id должен быть NULL');
    }
    if (user_id === null) {
      errors.push('Для support чата user_id должен быть указан');
    }
  } else if (type === 'private') {
    if (request_id === null) {
      errors.push('Для private чата request_id должен быть указан');
    }
    if (user_id === null) {
      errors.push('Для private чата user_id должен быть указан');
    }
    if (participantsCount !== 2) {
      errors.push(`Для private чата должно быть ровно 2 участника, найдено: ${participantsCount}`);
    }
  } else if (type === 'group') {
    if (request_id === null) {
      errors.push('Для group чата request_id должен быть указан');
    }
    if (user_id !== null) {
      errors.push('Для group чата user_id должен быть NULL');
    }
    if (participantsCount < 2) {
      errors.push(`Для group чата должно быть минимум 2 участника, найдено: ${participantsCount}`);
    }
  }

  return {
    isValid: errors.length === 0,
    expectedType: expectedType || type,
    actualType: type,
    errors
  };
}

/**
 * Получить количество участников чата
 * @param {string} chatId - ID чата
 * @returns {Promise<number>} - Количество участников
 */
async function getParticipantsCount(chatId) {
  try {
    const [result] = await pool.execute(
      'SELECT COUNT(*) as count FROM chat_participants WHERE chat_id = ?',
      [chatId]
    );
    return parseInt(result[0]?.count || 0);
  } catch (error) {
    console.error('Ошибка получения количества участников:', error);
    return 0;
  }
}

/**
 * Валидация и исправление типа чата
 * @param {string} chatId - ID чата
 * @returns {Promise<Object>} - { corrected: boolean, oldType: string, newType: string }
 */
async function validateAndFixChatType(chatId) {
  try {
    const [chats] = await pool.execute(
      'SELECT * FROM chats WHERE id = ?',
      [chatId]
    );

    if (chats.length === 0) {
      return { corrected: false, error: 'Чат не найден' };
    }

    const chat = chats[0];
    const participantsCount = await getParticipantsCount(chatId);
    chat.participants_count = participantsCount;

    const validation = validateChatType(chat);

    if (!validation.isValid && validation.expectedType && validation.expectedType !== validation.actualType) {
      // Исправляем тип чата
      await pool.execute(
        'UPDATE chats SET type = ? WHERE id = ?',
        [validation.expectedType, chatId]
      );

      console.log(`✅ Исправлен тип чата ${chatId}: ${validation.actualType} → ${validation.expectedType}`);

      return {
        corrected: true,
        oldType: validation.actualType,
        newType: validation.expectedType,
        errors: validation.errors
      };
    }

    return {
      corrected: false,
      validation
    };
  } catch (error) {
    console.error('Ошибка валидации типа чата:', error);
    return { corrected: false, error: error.message };
  }
}

/**
 * Проверка существования support чата для пользователя
 * @param {string} userId - ID пользователя
 * @returns {Promise<Object|null>} - Существующий чат или null
 */
async function findExistingSupportChat(userId) {
  try {
    const [chats] = await pool.execute(
      'SELECT * FROM chats WHERE type = ? AND user_id = ?',
      ['support', userId]
    );
    return chats.length > 0 ? chats[0] : null;
  } catch (error) {
    console.error('Ошибка поиска support чата:', error);
    return null;
  }
}

/**
 * Проверка существования private чата для пары пользователей и заявки
 * @param {string} requestId - ID заявки
 * @param {string} userId1 - ID первого пользователя
 * @param {string} userId2 - ID второго пользователя
 * @returns {Promise<Object|null>} - Существующий чат или null
 */
async function findExistingPrivateChat(requestId, userId1, userId2) {
  try {
    // Ищем чат, где оба пользователя являются участниками
    const [chats] = await pool.execute(
      `SELECT DISTINCT c.* FROM chats c
       INNER JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
       INNER JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
       WHERE c.type = 'private' AND c.request_id = ?`,
      [userId1, userId2, requestId]
    );

    if (chats.length > 0) {
      return chats[0];
    }

    // Также проверяем по user_id в таблице chats (для обратной совместимости)
    const [chatsByUserId] = await pool.execute(
      `SELECT DISTINCT c.* FROM chats c
       INNER JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
       INNER JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
       WHERE c.type = 'private' AND c.request_id = ? AND (c.user_id = ? OR c.user_id = ?)`,
      [userId1, userId2, requestId, userId1, userId2]
    );

    return chatsByUserId.length > 0 ? chatsByUserId[0] : null;
  } catch (error) {
    console.error('Ошибка поиска private чата:', error);
    return null;
  }
}

/**
 * Проверка существования group чата для заявки
 * @param {string} requestId - ID заявки
 * @returns {Promise<Object|null>} - Существующий чат или null
 */
async function findExistingGroupChat(requestId) {
  try {
    const [chats] = await pool.execute(
      'SELECT * FROM chats WHERE type = ? AND request_id = ?',
      ['group', requestId]
    );
    return chats.length > 0 ? chats[0] : null;
  } catch (error) {
    console.error('Ошибка поиска group чата:', error);
    return null;
  }
}

module.exports = {
  validateChatType,
  getParticipantsCount,
  validateAndFixChatType,
  findExistingSupportChat,
  findExistingPrivateChat,
  findExistingGroupChat
};

