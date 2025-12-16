const pool = require('../config/database');
const { generateId } = require('./uuid');

/**
 * Создать групповой чат для заявки
 * @param {string} requestId - ID заявки
 * @param {string} createdBy - ID создателя заявки
 * @param {string} category - Категория заявки (wasteLocation, speedCleanup, event)
 * @returns {Promise<string|null>} - ID созданного чата или null при ошибке
 */
async function createGroupChatForRequest(requestId, createdBy, category) {
  try {
    // Проверяем, существует ли уже групповой чат
    const [existing] = await pool.execute(
      `SELECT id FROM chats WHERE type = 'group' AND request_id = ?`,
      [requestId]
    );

    if (existing.length > 0) {
      // Чат уже существует, возвращаем его ID
      return existing[0].id;
    }

    // Создаем новый групповой чат
    const chatId = generateId();
    await pool.execute(
      `INSERT INTO chats (id, type, request_id, created_by, created_at, last_message_at)
       VALUES (?, 'group', ?, ?, NOW(), NOW())`,
      [chatId, requestId, createdBy]
    );

    // Добавляем создателя в участники
    await addParticipantToGroupChat(chatId, createdBy);

    return chatId;
  } catch (err) {
    console.error('❌ Ошибка создания группового чата для заявки:', err);
    return null;
  }
}

/**
 * Добавить участника в групповой чат заявки
 * @param {string} requestId - ID заявки
 * @param {string} userId - ID пользователя для добавления
 * @returns {Promise<boolean>} - true если успешно, false при ошибке
 */
async function addParticipantToGroupChatByRequest(requestId, userId) {
  try {
    // Находим групповой чат для заявки
    const [chats] = await pool.execute(
      `SELECT id FROM chats WHERE type = 'group' AND request_id = ?`,
      [requestId]
    );

    if (chats.length === 0) {
      // Чат не существует, создаем его
      const [requests] = await pool.execute(
        `SELECT created_by, category FROM requests WHERE id = ?`,
        [requestId]
      );

      if (requests.length === 0) {
        return false;
      }

      const request = requests[0];
      const chatId = await createGroupChatForRequest(requestId, request.created_by, request.category);
      
      if (!chatId) {
        return false;
      }

      // Добавляем пользователя в чат
      return await addParticipantToGroupChat(chatId, userId);
    }

    // Чат существует, добавляем пользователя
    return await addParticipantToGroupChat(chats[0].id, userId);
  } catch (err) {
    console.error('❌ Ошибка добавления участника в групповой чат:', err);
    return false;
  }
}

/**
 * Добавить участника в групповой чат
 * @param {string} chatId - ID чата
 * @param {string} userId - ID пользователя для добавления
 * @returns {Promise<boolean>} - true если успешно, false при ошибке
 */
async function addParticipantToGroupChat(chatId, userId) {
  try {
    await pool.execute(
      `INSERT INTO chat_participants (chat_id, user_id, joined_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE joined_at = joined_at`,
      [chatId, userId]
    );
    return true;
  } catch (err) {
    console.error('❌ Ошибка добавления участника в чат:', err);
    return false;
  }
}

/**
 * Обновить участников группового чата на основе данных заявки
 * Добавляет всех текущих участников заявки (создатель, присоединившиеся, донатеры)
 * @param {string} requestId - ID заявки
 * @returns {Promise<boolean>} - true если успешно
 */
async function updateGroupChatParticipants(requestId) {
  try {
    // Получаем данные заявки
    const [requests] = await pool.execute(
      `SELECT category, created_by, joined_user_id, registered_participants 
       FROM requests WHERE id = ?`,
      [requestId]
    );

    if (requests.length === 0) {
      return false;
    }

    const request = requests[0];

    // Находим групповой чат
    const [chats] = await pool.execute(
      `SELECT id FROM chats WHERE type = 'group' AND request_id = ?`,
      [requestId]
    );

    if (chats.length === 0) {
      // Чат не существует, создаем его
      const chatId = await createGroupChatForRequest(requestId, request.created_by, request.category);
      if (!chatId) {
        return false;
      }
    }

    const chatId = chats[0].id;
    const participants = new Set();

    // 1. Добавляем создателя заявки
    if (request.created_by) {
      participants.add(request.created_by);
    }

    // 2. Для waste: добавляем joined_user_id (если есть)
    if (request.category === 'wasteLocation' && request.joined_user_id) {
      participants.add(request.joined_user_id);
    }

    // 3. Для event: добавляем registered_participants (если есть)
    if (request.category === 'event' && request.registered_participants) {
      try {
        let registeredParticipants = [];
        if (typeof request.registered_participants === 'string') {
          registeredParticipants = JSON.parse(request.registered_participants);
        } else if (Array.isArray(request.registered_participants)) {
          registeredParticipants = request.registered_participants;
        }
        
        if (Array.isArray(registeredParticipants)) {
          registeredParticipants.forEach(id => {
            if (id) participants.add(id);
          });
        }
      } catch (e) {
        // Игнорируем ошибки парсинга
      }
    }

    // 4. Добавляем всех донатеров из таблицы donations
    const [donations] = await pool.execute(
      `SELECT DISTINCT user_id FROM donations WHERE request_id = ? AND user_id IS NOT NULL`,
      [requestId]
    );
    
    donations.forEach(donation => {
      if (donation.user_id) {
        participants.add(donation.user_id);
      }
    });

    // Добавляем всех участников в chat_participants
    for (const participantId of participants) {
      await addParticipantToGroupChat(chatId, participantId);
    }

    return true;
  } catch (err) {
    console.error('❌ Ошибка обновления участников группового чата:', err);
    return false;
  }
}

/**
 * Удалить групповой чат заявки
 * @param {string} requestId - ID заявки
 * @returns {Promise<boolean>} - true если успешно
 */
async function deleteGroupChatForRequest(requestId) {
  try {
    // CASCADE должен удалить автоматически, но для надежности удаляем явно
    await pool.execute(
      `DELETE FROM chats WHERE type = 'group' AND request_id = ?`,
      [requestId]
    );
    return true;
  } catch (err) {
    console.error('❌ Ошибка удаления группового чата для заявки:', err);
    return false;
  }
}

module.exports = {
  createGroupChatForRequest,
  addParticipantToGroupChatByRequest,
  addParticipantToGroupChat,
  updateGroupChatParticipants,
  deleteGroupChatForRequest
};

