const pool = require('../config/database');
const { generateId } = require('../utils/uuid');

/**
 * Создать групповой чат для заявки
 * @param {string} requestId - ID заявки
 * @param {string} createdBy - ID создателя заявки
 * @returns {Promise<string>} ID созданного чата
 */
async function createGroupChatForRequest(requestId, createdBy) {
  try {
    // Проверяем, существует ли уже чат
    const [existingChats] = await pool.execute(
      'SELECT id FROM chats WHERE type = ? AND request_id = ?',
      ['group', requestId]
    );

    if (existingChats.length > 0) {
      return existingChats[0].id;
    }

    // Создаем новый групповой чат
    const chatId = generateId();
    await pool.execute(
      `INSERT INTO chats (id, type, request_id, created_by, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [chatId, 'group', requestId, createdBy]
    );

    // Добавляем создателя в участники
    await pool.execute(
      `INSERT INTO chat_participants (id, chat_id, user_id, joined_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE joined_at = joined_at`,
      [generateId(), chatId, createdBy]
    );

    return chatId;
  } catch (error) {
    console.error('Ошибка при создании группового чата:', error);
    throw error;
  }
}

/**
 * Удалить все чаты, связанные с заявкой
 * @param {string} requestId - ID заявки
 */
async function deleteChatsForRequest(requestId) {
  try {
    // Удаляем все чаты, связанные с заявкой (private и group)
    // CASCADE автоматически удалит сообщения и участников
    await pool.execute(
      'DELETE FROM chats WHERE request_id = ? AND type IN (?, ?)',
      [requestId, 'private', 'group']
    );
  } catch (error) {
    console.error('Ошибка при удалении чатов для заявки:', error);
    throw error;
  }
}

/**
 * Добавить участника в групповой чат заявки
 * @param {string} requestId - ID заявки
 * @param {string} userId - ID пользователя
 */
async function addParticipantToGroupChat(requestId, userId) {
  try {
    // Находим групповой чат для заявки
    const [chats] = await pool.execute(
      'SELECT id FROM chats WHERE type = ? AND request_id = ?',
      ['group', requestId]
    );

    if (chats.length === 0) {
      // Если чат не существует, создаем его
      const [request] = await pool.execute(
        'SELECT created_by FROM requests WHERE id = ?',
        [requestId]
      );
      if (request.length > 0) {
        await createGroupChatForRequest(requestId, request[0].created_by);
        // Повторно получаем ID чата
        const [newChats] = await pool.execute(
          'SELECT id FROM chats WHERE type = ? AND request_id = ?',
          ['group', requestId]
        );
        if (newChats.length > 0) {
          const chatId = newChats[0].id;
          // Проверяем, не добавлен ли уже участник
          const [existing] = await pool.execute(
            'SELECT id FROM chat_participants WHERE chat_id = ? AND user_id = ?',
            [chatId, userId]
          );
          if (existing.length === 0) {
            await pool.execute(
              `INSERT INTO chat_participants (id, chat_id, user_id, joined_at)
               VALUES (?, ?, ?, NOW())
               ON DUPLICATE KEY UPDATE joined_at = joined_at`,
              [generateId(), chatId, userId]
            );
          }
        }
      }
      return;
    }

    const chatId = chats[0].id;

    // Проверяем, не добавлен ли уже участник
    const [existing] = await pool.execute(
      'SELECT id FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [chatId, userId]
    );

    if (existing.length === 0) {
      // Добавляем участника
      await pool.execute(
        `INSERT INTO chat_participants (id, chat_id, user_id, joined_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE joined_at = joined_at`,
        [generateId(), chatId, userId]
      );
    }
  } catch (error) {
    console.error('Ошибка при добавлении участника в групповой чат:', error);
    throw error;
  }
}

module.exports = {
  createGroupChatForRequest,
  deleteChatsForRequest,
  addParticipantToGroupChat
};

