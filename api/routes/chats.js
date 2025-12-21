const express = require('express');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { addUserToChat } = require('../utils/chatHelpers');

const router = express.Router();

// КРИТИЧЕСКИ ВАЖНО: Хранилище для SSE подключений
// Структура: Map<chatId, Set<Response>>
// Каждый чат может иметь несколько подключенных клиентов
const sseConnections = new Map();

/**
 * Безопасный парсинг JSON поля из базы данных
 * MySQL может возвращать JSON уже как объект/массив или как строку
 * @param {any} value - Значение из БД
 * @returns {Array} - Массив ID пользователей
 */
function safeParseJsonArray(value) {
  if (!value) {
    return [];
  }
  
  if (Array.isArray(value)) {
    // Уже массив, возвращаем как есть
    return value;
  }
  
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      // Если не удалось распарсить, возвращаем пустой массив
      return [];
    }
  }
  
  // Если это объект или что-то другое, возвращаем пустой массив
  return [];
}

/**
 * Отправка события через SSE всем подключенным клиентам чата
 * @param {string} chatId - ID чата
 * @param {object} event - Событие для отправки
 */
function sendSSEEvent(chatId, event) {
  const connections = sseConnections.get(chatId);
  if (!connections || connections.size === 0) {
    return;
  }

  const data = JSON.stringify(event);
  const sseMessage = `data: ${data}\n\n`;

  // Отправляем событие всем подключенным клиентам
  connections.forEach((res) => {
    try {
      res.write(sseMessage);
    } catch (err) {
      // Если клиент отключился, удаляем его из списка
      connections.delete(res);
    }
  });

  // Если больше нет подключений, удаляем чат из Map
  if (connections.size === 0) {
    sseConnections.delete(chatId);
  }
}

/**
 * GET /api/chats
 * Получить список всех чатов текущего пользователя
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { type, limit = 20, offset = 0 } = req.query;
    
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offsetNum = Math.max(0, parseInt(offset) || 0);

    // КРИТИЧЕСКИ ВАЖНО: Для support чатов фильтруем по владельцу (user_id)
    // Для остальных типов - по участию в chat_participants
    // Это нужно, чтобы админы не видели все support чаты других пользователей
    let query = `
      SELECT DISTINCT c.*, 
        (SELECT COUNT(*) FROM messages m 
         WHERE m.chat_id = c.id 
         AND m.deleted_at IS NULL
         AND JSON_CONTAINS(COALESCE(m.unread_by, '[]'), JSON_QUOTE(?)) = 1
        ) as unread_count,
        (SELECT m.id FROM messages m 
         WHERE m.chat_id = c.id 
         AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC LIMIT 1) as last_message_id
      FROM chats c
      INNER JOIN chat_participants cp ON c.id = cp.chat_id
      WHERE (
        (c.type = 'support' AND c.user_id = ?) 
        OR 
        (c.type != 'support' AND cp.user_id = ?)
      )
    `;
    const params = [userId, userId, userId];

    if (type) {
      query += ` AND c.type = ?`;
      params.push(type);
    }

    // КРИТИЧЕСКИ ВАЖНО: LIMIT и OFFSET не могут быть плейсхолдерами в MySQL2
    // Вставляем значения напрямую (безопасно, так как limitNum и offsetNum - числа)
    query += ` ORDER BY c.last_message_at DESC, c.created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`;

    const [chats] = await pool.execute(query, params);

    // Получаем последние сообщения для каждого чата
    for (const chat of chats) {
      if (chat.last_message_id) {
        const [messages] = await pool.execute(
          `SELECT id, message, sender_id, created_at 
           FROM messages 
           WHERE id = ?`,
          [chat.last_message_id]
        );
        if (messages.length > 0) {
          chat.last_message = messages[0];
        }
      }
    }

    // Получаем общее количество
    let countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM chats c
      INNER JOIN chat_participants cp ON c.id = cp.chat_id
      WHERE (
        (c.type = 'support' AND c.user_id = ?) 
        OR 
        (c.type != 'support' AND cp.user_id = ?)
      )
    `;
    const countParams = [userId, userId];
    if (type) {
      countQuery += ` AND c.type = ?`;
      countParams.push(type);
    }
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    success(res, {
      chats,
      total
    });
  } catch (err) {
    error(res, 'Ошибка при получении списка чатов', 500, err);
  }
});

/**
 * GET /api/chats/support
 * Получить чат техподдержки текущего пользователя
 */
router.get('/support', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const [chats] = await pool.execute(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM messages m 
         WHERE m.chat_id = c.id 
         AND m.deleted_at IS NULL
         AND JSON_CONTAINS(COALESCE(m.unread_by, '[]'), JSON_QUOTE(?)) = 1
        ) as unread_count
       FROM chats c
       WHERE c.type = 'support' AND c.user_id = ?`,
      [userId, userId]
    );

    if (chats.length === 0) {
      return error(res, 'Чат техподдержки не найден', 404);
    }

    success(res, chats[0]);
  } catch (err) {
    error(res, 'Ошибка при получении чата техподдержки', 500, err);
  }
});

/**
 * POST /api/chats/support
 * Создать чат техподдержки (если не существует)
 */
router.post('/support', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    // Проверяем, существует ли уже чат
    const [existing] = await pool.execute(
      `SELECT * FROM chats WHERE type = 'support' AND user_id = ?`,
      [userId]
    );

    if (existing.length > 0) {
      return success(res, existing[0]);
    }

    // Создаем новый чат
    const chatId = generateId();
    await pool.execute(
      `INSERT INTO chats (id, type, user_id, created_by, created_at, last_message_at)
       VALUES (?, 'support', ?, ?, NOW(), NOW())`,
      [chatId, userId, userId]
    );

    // Добавляем пользователя в участники
    await pool.execute(
      `INSERT INTO chat_participants (chat_id, user_id, joined_at)
       VALUES (?, ?, NOW())`,
      [chatId, userId]
    );

    // КРИТИЧЕСКИ ВАЖНО: Автоматически добавляем всех админов в support чат
    const [admins] = await pool.execute(
      `SELECT id FROM users WHERE is_admin = true OR admin = true`
    );
    
    for (const admin of admins) {
      try {
        await pool.execute(
          `INSERT INTO chat_participants (chat_id, user_id, joined_at)
           VALUES (?, ?, NOW())
           ON DUPLICATE KEY UPDATE joined_at = joined_at`,
          [chatId, admin.id]
        );
      } catch (err) {
        // Игнорируем ошибки дублирования
      }
    }

    const [newChat] = await pool.execute(
      `SELECT * FROM chats WHERE id = ?`,
      [chatId]
    );

    success(res, { ...newChat[0], unread_count: 0 }, 'Чат техподдержки создан', 201);
  } catch (err) {
    error(res, 'Ошибка при создании чата техподдержки', 500, err);
  }
});

/**
 * GET /api/chats/private/:requestId
 * Получить приватный чат с создателем заявки
 */
router.get('/private/:requestId', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { requestId } = req.params;

    // Проверяем существование заявки
    const [requests] = await pool.execute(
      `SELECT created_by FROM requests WHERE id = ?`,
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const createdBy = requests[0].created_by;

    // Ищем чат
    const [chats] = await pool.execute(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM messages m 
         WHERE m.chat_id = c.id 
         AND m.deleted_at IS NULL
         AND JSON_CONTAINS(COALESCE(m.unread_by, '[]'), JSON_QUOTE(?)) = 1
        ) as unread_count
       FROM chats c
       WHERE c.type = 'private' 
       AND c.request_id = ? 
       AND c.user_id = ?`,
      [userId, requestId, userId]
    );

    if (chats.length === 0) {
      return error(res, 'Приватный чат не найден', 404);
    }

    success(res, chats[0]);
  } catch (err) {
    error(res, 'Ошибка при получении приватного чата', 500, err);
  }
});

/**
 * POST /api/chats/private
 * Создать приватный чат между двумя пользователями
 */
router.post('/private', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { user_id_1, user_id_2, request_id } = req.body;

    // Определяем двух участников чата
    let participant1, participant2;
    
    if (user_id_1 && user_id_2) {
      // Новый формат: два ID пользователей передаются явно
      participant1 = user_id_1;
      participant2 = user_id_2;
    } else if (request_id) {
      // Старый формат: получаем создателя заявки
      const [requests] = await pool.execute(
        `SELECT created_by FROM requests WHERE id = ?`,
        [request_id]
      );

      if (requests.length === 0) {
        return error(res, 'Заявка не найдена', 404);
      }

      participant1 = userId;
      participant2 = requests[0].created_by;
    } else {
      return error(res, 'Необходимо указать либо user_id_1 и user_id_2, либо request_id', 400);
    }

    // Проверяем, что пользователи разные
    if (participant1 === participant2) {
      return error(res, 'Нельзя создать приватный чат с самим собой', 400);
    }

    // Проверяем существование обоих пользователей
    const [users] = await pool.execute(
      `SELECT id FROM users WHERE id IN (?, ?)`,
      [participant1, participant2]
    );

    if (users.length !== 2) {
      return error(res, 'Один или оба пользователя не найдены', 404);
    }

    // Проверяем, существует ли уже чат между этими двумя пользователями
    let existingChat = null;
    
    if (request_id) {
      // Если передан request_id, сначала ищем чат по request_id и user_id
      const [chatsByRequest] = await pool.execute(
        `SELECT c.* FROM chats c
         WHERE c.type = 'private' 
         AND c.request_id = ? 
         AND c.user_id = ?`,
        [request_id, participant1]
      );
      
      if (chatsByRequest.length > 0) {
        // Проверяем, что оба пользователя в этом чате
        const [participants] = await pool.execute(
          `SELECT COUNT(*) as count FROM chat_participants 
           WHERE chat_id = ? AND user_id IN (?, ?)`,
          [chatsByRequest[0].id, participant1, participant2]
        );
        
        if (participants[0].count === 2) {
          existingChat = chatsByRequest[0];
        }
      }
    }
    
    // Если чат не найден по request_id, ищем чат между двумя пользователями
    if (!existingChat) {
      let query, params;
      
      if (request_id) {
        // Ищем чат с указанным request_id или без него
        query = `SELECT DISTINCT c.* FROM chats c
                 INNER JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
                 INNER JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
                 WHERE c.type = 'private'
                 AND (c.request_id = ? OR c.request_id IS NULL)`;
        params = [participant1, participant2, request_id];
      } else {
        // Ищем любой приватный чат между этими двумя пользователями
        query = `SELECT DISTINCT c.* FROM chats c
                 INNER JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
                 INNER JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
                 WHERE c.type = 'private'`;
        params = [participant1, participant2];
      }
      
      const [chatsByUsers] = await pool.execute(query, params);
      
      if (chatsByUsers.length > 0) {
        existingChat = chatsByUsers[0];
      }
    }

    if (existingChat) {
      // Возвращаем существующий чат
      const [chats] = await pool.execute(
        `SELECT c.*, 
         (SELECT COUNT(*) FROM messages m 
          WHERE m.chat_id = c.id 
          AND m.deleted_at IS NULL
          AND JSON_CONTAINS(COALESCE(m.unread_by, '[]'), JSON_QUOTE(?)) = 1
         ) as unread_count
         FROM chats c
         WHERE c.id = ?`,
        [userId, existingChat.id]
      );
      
      return success(res, chats[0] || existingChat);
    }

    // Создаем новый чат
    const chatId = generateId();
    await pool.execute(
      `INSERT INTO chats (id, type, request_id, user_id, created_by, created_at, last_message_at)
       VALUES (?, 'private', ?, ?, ?, NOW(), NOW())`,
      [chatId, request_id || null, participant1, participant1]
    );

    // Добавляем участников используя функцию addUserToChat (она правильно обрабатывает id)
    try {
      await addUserToChat(chatId, participant1);
      await addUserToChat(chatId, participant2);
    } catch (chatErr) {
      // Если ошибка при добавлении участников, передаем все детали
      const errorDetails = {
        message: chatErr.message || 'Неизвестная ошибка',
        originalError: chatErr.originalError ? {
          message: chatErr.originalError.message,
          code: chatErr.originalError.code,
          errno: chatErr.originalError.errno,
          sqlState: chatErr.originalError.sqlState,
          sqlMessage: chatErr.originalError.sqlMessage
        } : null,
        details: chatErr.details || null,
        chatId,
        participant1,
        participant2,
        request_id: request_id || null
      };
      const enhancedError = new Error(`Не удалось добавить участников в приватный чат ${chatId}: ${chatErr.message}`);
      enhancedError.originalError = chatErr.originalError || chatErr;
      enhancedError.details = errorDetails;
      throw enhancedError;
    }

    const [newChat] = await pool.execute(
      `SELECT c.*, 
       (SELECT COUNT(*) FROM messages m 
        WHERE m.chat_id = c.id 
        AND m.deleted_at IS NULL
        AND JSON_CONTAINS(COALESCE(m.unread_by, '[]'), JSON_QUOTE(?)) = 1
       ) as unread_count
       FROM chats c
       WHERE c.id = ?`,
      [userId, chatId]
    );

    success(res, newChat[0], 'Приватный чат создан', 201);
  } catch (err) {
    error(res, 'Ошибка при создании приватного чата', 500, err);
  }
});

/**
 * GET /api/chats/group/:requestId
 * Получить групповой чат заявки
 */
router.get('/group/:requestId', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { requestId } = req.params;

    // Проверяем существование заявки
    const [requests] = await pool.execute(
      `SELECT * FROM requests WHERE id = ?`,
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    // Ищем чат
    const [chats] = await pool.execute(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM messages m 
         WHERE m.chat_id = c.id 
         AND m.deleted_at IS NULL
         AND JSON_CONTAINS(COALESCE(m.unread_by, '[]'), JSON_QUOTE(?)) = 1
        ) as unread_count,
        (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) as participants_count
       FROM chats c
       WHERE c.type = 'group' AND c.request_id = ?`,
      [userId, requestId]
    );

    if (chats.length === 0) {
      return error(res, 'Групповой чат не найден', 404);
    }

    success(res, chats[0]);
  } catch (err) {
    error(res, 'Ошибка при получении группового чата', 500, err);
  }
});

/**
 * POST /api/chats/group
 * Создать групповой чат для заявки
 */
router.post('/group', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { request_id } = req.body;

    if (!request_id) {
      return error(res, 'request_id обязателен', 400);
    }

    // Проверяем существование заявки
    const [requests] = await pool.execute(
      `SELECT category, created_by, joined_user_id, registered_participants 
       FROM requests WHERE id = ?`,
      [request_id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const request = requests[0];

    // Проверяем, существует ли уже групповой чат для этой заявки
    const [existing] = await pool.execute(
      `SELECT * FROM chats WHERE type = 'group' AND request_id = ?`,
      [request_id]
    );

    if (existing.length > 0) {
      // Возвращаем существующий чат
      const [chats] = await pool.execute(
        `SELECT c.*, 
          (SELECT COUNT(*) FROM messages m 
           WHERE m.chat_id = c.id 
           AND m.deleted_at IS NULL
           AND JSON_CONTAINS(COALESCE(m.unread_by, '[]'), JSON_QUOTE(?)) = 1
          ) as unread_count,
          (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) as participants_count
         FROM chats c
         WHERE c.id = ?`,
        [userId, existing[0].id]
      );
      return success(res, chats[0]);
    }

    // Создаем новый групповой чат
    const chatId = generateId();
    await pool.execute(
      `INSERT INTO chats (id, type, request_id, created_by, created_at, last_message_at)
       VALUES (?, 'group', ?, ?, NOW(), NOW())`,
      [chatId, request_id, request.created_by]
    );

    // Собираем всех участников для добавления в чат
    const participants = new Set();

    // 1. Добавляем создателя заявки
    if (request.created_by) {
      participants.add(request.created_by);
    }

    // 2. Добавляем текущего пользователя (чтобы он мог получить доступ к чату)
    if (userId) {
      participants.add(userId);
    }

    // 3. Для waste: добавляем joined_user_id (если есть)
    if (request.category === 'wasteLocation' && request.joined_user_id) {
      participants.add(request.joined_user_id);
    }

    // 4. Для event: добавляем registered_participants (если есть)
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

    // 5. Добавляем всех донатеров из таблицы donations
    const [donations] = await pool.execute(
      `SELECT DISTINCT user_id FROM donations WHERE request_id = ? AND user_id IS NOT NULL`,
      [request_id]
    );
    
    donations.forEach(donation => {
      if (donation.user_id) {
        participants.add(donation.user_id);
      }
    });

    // Убеждаемся, что есть хотя бы один участник
    if (participants.size === 0) {
      return error(res, 'Не удалось определить участников чата', 500);
    }

    // Добавляем всех участников в chat_participants
    const insertErrors = [];
    const { addUserToChat } = require('../utils/chatHelpers');
    for (const participantId of participants) {
      try {
        await addUserToChat(chatId, participantId);
      } catch (err) {
        // Сохраняем ошибки для отладки
        insertErrors.push({ participantId, error: err.message });
      }
    }

    // Если были критические ошибки при добавлении участников, возвращаем ошибку
    if (insertErrors.length > 0 && participants.size === insertErrors.length) {
      return error(res, 'Ошибка при добавлении участников в чат', 500, { insertErrors });
    }

    // Получаем созданный чат
    const [newChat] = await pool.execute(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM messages m 
         WHERE m.chat_id = c.id 
         AND m.deleted_at IS NULL
         AND JSON_CONTAINS(COALESCE(m.unread_by, '[]'), JSON_QUOTE(?)) = 1
        ) as unread_count,
        (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) as participants_count
       FROM chats c
       WHERE c.id = ?`,
      [userId, chatId]
    );

    success(res, newChat[0], 'Групповой чат создан', 201);
  } catch (err) {
    error(res, 'Ошибка при создании группового чата', 500, err);
  }
});

/**
 * GET /api/chats/:chatId/messages
 * Получить историю сообщений чата
 */
router.get('/:chatId/messages', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { chatId } = req.params;
    const { limit = 50, offset = 0, before } = req.query;

    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 50));
    const offsetNum = Math.max(0, parseInt(offset) || 0);

    // Проверяем доступ к чату
    let [chats] = await pool.execute(
      `SELECT c.* FROM chats c
       INNER JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE c.id = ? AND cp.user_id = ?`,
      [chatId, userId]
    );

    // Если чат не найден через участников, проверяем, существует ли чат вообще
    if (chats.length === 0) {
      const [chatExists] = await pool.execute(
        `SELECT c.* FROM chats c WHERE c.id = ?`,
        [chatId]
      );

      if (chatExists.length === 0) {
        return error(res, 'Чат не найден', 404);
      }

      const chat = chatExists[0];

      // Проверяем, есть ли пользователь в участниках
      const [participants] = await pool.execute(
        `SELECT user_id FROM chat_participants WHERE chat_id = ?`,
        [chatId]
      );
      
      const participantIds = participants.map(p => p.user_id);
      
      // Для приватных чатов: проверяем, что пользователь должен быть участником
      if (chat.type === 'private') {
        // Проверяем, является ли пользователь одним из участников приватного чата
        if (!participantIds.includes(userId)) {
          const errorDetails = {
            message: `Пользователь ${userId} не является участником приватного чата ${chatId}`,
            chatId,
            userId,
            chatType: chat.type,
            participants: participantIds,
            chatUserId: chat.user_id,
            chatCreatedBy: chat.created_by
          };
          return error(res, 'Чат не найден или нет доступа', 404, new Error(JSON.stringify(errorDetails)));
        }
      }

      // Для чатов типа support: если пользователь создатель чата - добавляем его
      if (chat.type === 'support' && (chat.user_id === userId || chat.created_by === userId)) {
        const { addUserToChat } = require('../utils/chatHelpers');
        await addUserToChat(chatId, userId);
        
        // Повторно проверяем доступ
        [chats] = await pool.execute(
          `SELECT c.* FROM chats c
           INNER JOIN chat_participants cp ON c.id = cp.chat_id
           WHERE c.id = ? AND cp.user_id = ?`,
          [chatId, userId]
        );
      } else if (chat.type === 'support') {
        // Если пользователь не создатель, проверяем, является ли он участником
        if (!participantIds.includes(userId)) {
          const errorDetails = {
            message: `Пользователь ${userId} не является участником чата поддержки ${chatId}`,
            chatId,
            userId,
            chatType: chat.type,
            participants: participantIds,
            chatUserId: chat.user_id,
            chatCreatedBy: chat.created_by
          };
          return error(res, 'Чат не найден или нет доступа', 404, new Error(JSON.stringify(errorDetails)));
        }
      }

      // Для групповых чатов: если пользователь создатель чата - добавляем его
      if (chat.type === 'group' && chat.request_id && chat.created_by === userId) {
        const { addUserToChat } = require('../utils/chatHelpers');
        await addUserToChat(chatId, userId);
        
        // Повторно проверяем доступ
        [chats] = await pool.execute(
          `SELECT c.* FROM chats c
           INNER JOIN chat_participants cp ON c.id = cp.chat_id
           WHERE c.id = ? AND cp.user_id = ?`,
          [chatId, userId]
        );
      }

      if (chats.length === 0) {
        const errorDetails = {
          message: `Пользователь ${userId} не имеет доступа к чату ${chatId}`,
          chatId,
          userId,
          chatType: chat.type,
          participants: participantIds
        };
        return error(res, 'Чат не найден или нет доступа', 404, new Error(JSON.stringify(errorDetails)));
      }
    }

    // Получаем сообщения
    let query = `
      SELECT m.*, 
        u.display_name as sender_display_name,
        u.photo_url as sender_photo_url
      FROM messages m
      INNER JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ? AND m.deleted_at IS NULL
    `;
    const params = [chatId];

    if (before) {
      query += ` AND m.created_at < ?`;
      params.push(before);
    }

    // КРИТИЧЕСКИ ВАЖНО: LIMIT и OFFSET не могут быть плейсхолдерами в MySQL2
    // Вставляем значения напрямую (безопасно, так как limitNum и offsetNum - числа)
    query += ` ORDER BY m.created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`;

    const [messages] = await pool.execute(query, params);

    // Парсим JSON поля read_by и unread_by для каждого сообщения
    for (const message of messages) {
      // Безопасный парсинг JSON полей
      message.read_by = safeParseJsonArray(message.read_by);
      message.unread_by = safeParseJsonArray(message.unread_by);
      
      // Убеждаемся, что отправитель всегда в read_by
      if (!message.read_by.includes(message.sender_id)) {
        message.read_by.push(message.sender_id);
      }
      
      // Удаляем отправителя из unread_by (если он там есть)
      message.unread_by = message.unread_by.filter(id => id !== message.sender_id);
    }

    // Получаем общее количество сообщений
    let countQuery = `SELECT COUNT(*) as total FROM messages WHERE chat_id = ? AND deleted_at IS NULL`;
    const countParams = [chatId];
    if (before) {
      countQuery += ` AND created_at < ?`;
      countParams.push(before);
    }
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    // Формируем ответ с данными отправителя
    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      chat_id: msg.chat_id,
      sender_id: msg.sender_id,
      sender: {
        id: msg.sender_id,
        display_name: msg.sender_display_name,
        photo_url: msg.sender_photo_url
      },
      message: msg.message,
      message_type: msg.message_type,
      created_at: msg.created_at,
      read_by: msg.read_by,
      unread_by: msg.unread_by
    }));

    success(res, {
      messages: formattedMessages.reverse(), // Обратный порядок для хронологии
      total,
      has_more: total > offsetNum + limitNum
    });
  } catch (err) {
    error(res, 'Ошибка при получении сообщений', 500, err);
  }
});

/**
 * POST /api/chats/:chatId/messages
 * Отправить сообщение (альтернатива WebSocket)
 */
router.post('/:chatId/messages', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { chatId } = req.params;
    const { message, message_type = 'text' } = req.body;

    if (!message) {
      return error(res, 'message обязателен', 400);
    }

    // Проверяем доступ к чату
    let [chats] = await pool.execute(
      `SELECT c.* FROM chats c
       INNER JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE c.id = ? AND cp.user_id = ?`,
      [chatId, userId]
    );

    // Если чат не найден через участников, проверяем, существует ли чат вообще
    if (chats.length === 0) {
      const [chatExists] = await pool.execute(
        `SELECT c.* FROM chats c WHERE c.id = ?`,
        [chatId]
      );

      if (chatExists.length === 0) {
        return error(res, 'Чат не найден', 404);
      }

      const chat = chatExists[0];

      // Проверяем, есть ли пользователь в участниках
      const [participants] = await pool.execute(
        `SELECT user_id FROM chat_participants WHERE chat_id = ?`,
        [chatId]
      );
      
      const participantIds = participants.map(p => p.user_id);
      
      // Для приватных чатов: проверяем, что пользователь должен быть участником
      if (chat.type === 'private') {
        // Проверяем, является ли пользователь одним из участников приватного чата
        if (!participantIds.includes(userId)) {
          const errorDetails = {
            message: `Пользователь ${userId} не является участником приватного чата ${chatId}`,
            chatId,
            userId,
            chatType: chat.type,
            participants: participantIds,
            chatUserId: chat.user_id,
            chatCreatedBy: chat.created_by
          };
          return error(res, 'Чат не найден или нет доступа', 404, new Error(JSON.stringify(errorDetails)));
        }
      }

      // Для чатов типа support: если пользователь создатель чата - добавляем его
      if (chat.type === 'support' && (chat.user_id === userId || chat.created_by === userId)) {
        const { addUserToChat } = require('../utils/chatHelpers');
        await addUserToChat(chatId, userId);
        
        // Повторно проверяем доступ
        [chats] = await pool.execute(
          `SELECT c.* FROM chats c
           INNER JOIN chat_participants cp ON c.id = cp.chat_id
           WHERE c.id = ? AND cp.user_id = ?`,
          [chatId, userId]
        );
      } else if (chat.type === 'support') {
        // Если пользователь не создатель, проверяем, является ли он участником
        if (!participantIds.includes(userId)) {
          const errorDetails = {
            message: `Пользователь ${userId} не является участником чата поддержки ${chatId}`,
            chatId,
            userId,
            chatType: chat.type,
            participants: participantIds,
            chatUserId: chat.user_id,
            chatCreatedBy: chat.created_by
          };
          return error(res, 'Чат не найден или нет доступа', 404, new Error(JSON.stringify(errorDetails)));
        }
      }

      // Для групповых чатов: если пользователь создатель чата - добавляем его
      if (chat.type === 'group' && chat.request_id && chat.created_by === userId) {
        const { addUserToChat } = require('../utils/chatHelpers');
        await addUserToChat(chatId, userId);
        
        // Повторно проверяем доступ
        [chats] = await pool.execute(
          `SELECT c.* FROM chats c
           INNER JOIN chat_participants cp ON c.id = cp.chat_id
           WHERE c.id = ? AND cp.user_id = ?`,
          [chatId, userId]
        );
      }

      if (chats.length === 0) {
        const errorDetails = {
          message: `Пользователь ${userId} не имеет доступа к чату ${chatId}`,
          chatId,
          userId,
          chatType: chat.type,
          participants: participantIds
        };
        return error(res, 'Чат не найден или нет доступа', 404, new Error(JSON.stringify(errorDetails)));
      }
    }

    // Получаем всех участников чата
    const [participants] = await pool.execute(
      `SELECT user_id FROM chat_participants WHERE chat_id = ?`,
      [chatId]
    );

    // Формируем массивы: отправитель в read_by, остальные в unread_by
    const readBy = [userId]; // Отправитель сразу прочитал
    const unreadBy = participants
      .map(p => p.user_id)
      .filter(id => id !== userId); // Все остальные участники

    // Сохраняем сообщение с JSON полями
    const messageId = generateId();
    await pool.execute(
      `INSERT INTO messages (id, chat_id, sender_id, message, message_type, created_at, read_by, unread_by)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [
        messageId,
        chatId,
        userId,
        message,
        message_type,
        JSON.stringify(readBy),
        unreadBy.length > 0 ? JSON.stringify(unreadBy) : null
      ]
    );

    // Обновляем last_message_at в чате
    await pool.execute(
      `UPDATE chats SET last_message_at = NOW() WHERE id = ?`,
      [chatId]
    );

    // Получаем сохраненное сообщение
    const [messages] = await pool.execute(
      `SELECT m.*, 
        u.display_name as sender_display_name,
        u.photo_url as sender_photo_url
      FROM messages m
      INNER JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?`,
      [messageId]
    );

    const messageData = messages[0];
    
    // Безопасный парсинг JSON полей
    messageData.read_by = safeParseJsonArray(messageData.read_by);
    messageData.unread_by = safeParseJsonArray(messageData.unread_by);

    // Отправляем через SSE (Server-Sent Events)
    sendSSEEvent(chatId, {
      type: 'new_message',
      success: true,
      id: messageData.id,
      chat_id: messageData.chat_id,
      sender_id: messageData.sender_id,
      message: messageData.message,
      message_type: messageData.message_type,
      created_at: messageData.created_at,
      read_by: messageData.read_by,
      unread_by: messageData.unread_by
    });

    // Отправляем через Socket.io (если доступен) - для обратной совместимости
    try {
      const mainApp = req.app;
      const io = mainApp ? mainApp.get('io') : null;
      if (io) {
        io.to(`chat:${chatId}`).emit('new_message', {
          success: true,
          id: messageData.id,
          chat_id: messageData.chat_id,
          sender_id: messageData.sender_id,
          message: messageData.message,
          message_type: messageData.message_type,
          created_at: messageData.created_at
        });
      }
    } catch (socketError) {
      // Socket.io не доступен, но сообщение сохранено
    }

    success(res, {
      id: messageData.id,
      chat_id: messageData.chat_id,
      sender_id: messageData.sender_id,
      message: messageData.message,
      message_type: messageData.message_type,
      created_at: messageData.created_at,
      read_by: messageData.read_by,
      unread_by: messageData.unread_by
    }, 'Сообщение отправлено', 201);
  } catch (err) {
    error(res, 'Ошибка при отправке сообщения', 500, err);
  }
});

/**
 * POST /api/chats/:chatId/read
 * Отметить все сообщения в чате как прочитанные (при открытии чата)
 */
router.post('/:chatId/read', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { chatId } = req.params;

    // Проверяем доступ к чату
    let [chats] = await pool.execute(
      `SELECT c.* FROM chats c
       INNER JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE c.id = ? AND cp.user_id = ?`,
      [chatId, userId]
    );

    // Если чат не найден через участников, проверяем, существует ли чат вообще
    if (chats.length === 0) {
      const [chatExists] = await pool.execute(
        `SELECT c.* FROM chats c WHERE c.id = ?`,
        [chatId]
      );

      if (chatExists.length === 0) {
        return error(res, 'Чат не найден', 404);
      }

      const chat = chatExists[0];

      // Для групповых чатов: если пользователь создатель чата - добавляем его
      if (chat.type === 'group' && chat.request_id && chat.created_by === userId) {
        const { addUserToChat } = require('../utils/chatHelpers');
        await addUserToChat(chatId, userId);
        
        // Повторно проверяем доступ
        [chats] = await pool.execute(
          `SELECT c.* FROM chats c
           INNER JOIN chat_participants cp ON c.id = cp.chat_id
           WHERE c.id = ? AND cp.user_id = ?`,
          [chatId, userId]
        );
      }

      if (chats.length === 0) {
        return error(res, 'Чат не найден или нет доступа', 404);
      }
    }

    // Получаем все непрочитанные сообщения для этого пользователя
    const [messages] = await pool.execute(
      `SELECT id, read_by, unread_by FROM messages 
       WHERE chat_id = ? 
       AND deleted_at IS NULL
       AND JSON_CONTAINS(COALESCE(unread_by, '[]'), JSON_QUOTE(?)) = 1`,
      [chatId, userId]
    );

    // Обновляем каждое сообщение: перемещаем userId из unread_by в read_by
    for (const message of messages) {
      let readBy = safeParseJsonArray(message.read_by);
      let unreadBy = safeParseJsonArray(message.unread_by);

      // Перемещаем userId из unread_by в read_by
      if (unreadBy.includes(userId)) {
        unreadBy = unreadBy.filter(id => id !== userId);
        if (!readBy.includes(userId)) {
          readBy.push(userId);
        }
      }

      // Обновляем сообщение
      await pool.execute(
        `UPDATE messages 
         SET read_by = ?, unread_by = ? 
         WHERE id = ?`,
        [
          JSON.stringify(readBy),
          unreadBy.length > 0 ? JSON.stringify(unreadBy) : null,
          message.id
        ]
      );
    }

    // Отправляем через SSE (Server-Sent Events)
    sendSSEEvent(chatId, {
      type: 'all_messages_read',
      success: true,
      userId: userId,
      chatId: chatId,
      messagesCount: messages.length,
      readAt: new Date().toISOString()
    });

    // Отправляем через Socket.io (если доступен) - для обратной совместимости
    try {
      const mainApp = req.app;
      const io = mainApp ? mainApp.get('io') : null;
      if (io) {
        io.to(`chat:${chatId}`).emit('all_messages_read', {
          success: true,
          userId: userId,
          chatId: chatId,
          messagesCount: messages.length
        });
      }
    } catch (socketError) {
      // Socket.io не доступен
    }

    success(res, {
      chat_id: chatId,
      messages_marked_read: messages.length,
      read_at: new Date().toISOString()
    });
  } catch (err) {
    error(res, 'Ошибка при отметке сообщений как прочитанных', 500, err);
  }
});

/**
 * POST /api/chats/:chatId/messages/:messageId/read
 * Отметить одно сообщение как прочитанное (для обратной совместимости)
 */
router.post('/:chatId/messages/:messageId/read', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { chatId, messageId } = req.params;

    // Проверяем доступ к чату
    const [chats] = await pool.execute(
      `SELECT c.* FROM chats c
       INNER JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE c.id = ? AND cp.user_id = ?`,
      [chatId, userId]
    );

    if (chats.length === 0) {
      return error(res, 'Чат не найден или нет доступа', 404);
    }

    // Получаем сообщение
    const [messages] = await pool.execute(
      `SELECT id, read_by, unread_by FROM messages 
       WHERE id = ? AND chat_id = ? AND deleted_at IS NULL`,
      [messageId, chatId]
    );

    if (messages.length === 0) {
      return error(res, 'Сообщение не найдено', 404);
    }

    const message = messages[0];
    let readBy = safeParseJsonArray(message.read_by);
    let unreadBy = safeParseJsonArray(message.unread_by);

    // Перемещаем userId из unread_by в read_by
    if (unreadBy.includes(userId)) {
      unreadBy = unreadBy.filter(id => id !== userId);
      if (!readBy.includes(userId)) {
        readBy.push(userId);
      }
    }

    // Обновляем сообщение
    await pool.execute(
      `UPDATE messages 
       SET read_by = ?, unread_by = ? 
       WHERE id = ?`,
      [
        JSON.stringify(readBy),
        unreadBy.length > 0 ? JSON.stringify(unreadBy) : null,
        messageId
      ]
    );

    const readData = {
      success: true,
      messageId: messageId,
      userId: userId,
      readAt: new Date().toISOString()
    };

    // Отправляем через SSE (Server-Sent Events)
    sendSSEEvent(chatId, {
      type: 'message_read',
      ...readData
    });

    // Отправляем через Socket.io (если доступен) - для обратной совместимости
    try {
      const mainApp = req.app;
      const io = mainApp ? mainApp.get('io') : null;
      if (io) {
        io.to(`chat:${chatId}`).emit('message_read', readData);
      }
    } catch (socketError) {
      // Socket.io не доступен
    }

    success(res, {
      message_id: messageId,
      read_at: new Date().toISOString()
    });
  } catch (err) {
    error(res, 'Ошибка при отметке сообщения как прочитанного', 500, err);
  }
});

/**
 * GET /api/admin/chats
 * Получить все чаты (для админов)
 */
router.get('/admin/chats', authenticate, requireAdmin, async (req, res) => {
  try {
    const { type, request_id, user_id, limit = 20, offset = 0 } = req.query;
    
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offsetNum = Math.max(0, parseInt(offset) || 0);

    const adminId = req.user.userId || req.user.id;
    
    let query = `
      SELECT c.*, 
        (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) as participants_count,
        (SELECT COUNT(*) FROM messages m 
         WHERE m.chat_id = c.id 
         AND m.deleted_at IS NULL
         AND JSON_CONTAINS(COALESCE(m.unread_by, '[]'), JSON_QUOTE(?)) = 1
        ) as unread_count
      FROM chats c
      WHERE 1=1
    `;
    const params = [adminId];

    if (type) {
      query += ` AND c.type = ?`;
      params.push(type);
    }
    if (request_id) {
      query += ` AND c.request_id = ?`;
      params.push(request_id);
    }
    if (user_id) {
      query += ` AND c.user_id = ?`;
      params.push(user_id);
    }

    // КРИТИЧЕСКИ ВАЖНО: LIMIT и OFFSET не могут быть плейсхолдерами в MySQL2
    // Вставляем значения напрямую (безопасно, так как limitNum и offsetNum - числа)
    query += ` ORDER BY c.last_message_at DESC, c.created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`;

    const [chats] = await pool.execute(query, params);

    // Получаем общее количество
    let countQuery = `SELECT COUNT(*) as total FROM chats WHERE 1=1`;
    const countParams = [];
    if (type) {
      countQuery += ` AND type = ?`;
      countParams.push(type);
    }
    if (request_id) {
      countQuery += ` AND request_id = ?`;
      countParams.push(request_id);
    }
    if (user_id) {
      countQuery += ` AND user_id = ?`;
      countParams.push(user_id);
    }
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    success(res, {
      chats,
      total
    });
  } catch (err) {
    error(res, 'Ошибка при получении списка чатов', 500, err);
  }
});

/**
 * GET /api/admin/chats/:chatId/messages
 * Получить все сообщения чата (для админов, только просмотр)
 */
router.get('/admin/chats/:chatId/messages', authenticate, requireAdmin, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, offset = 0, before } = req.query;

    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 50));
    const offsetNum = Math.max(0, parseInt(offset) || 0);

    // Проверяем существование чата
    const [chats] = await pool.execute(
      `SELECT * FROM chats WHERE id = ?`,
      [chatId]
    );

    if (chats.length === 0) {
      return error(res, 'Чат не найден', 404);
    }

    // Получаем сообщения (аналогично обычному endpoint)
    let query = `
      SELECT m.*, 
        u.display_name as sender_display_name,
        u.photo_url as sender_photo_url
      FROM messages m
      INNER JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ? AND m.deleted_at IS NULL
    `;
    const params = [chatId];

    if (before) {
      query += ` AND m.created_at < ?`;
      params.push(before);
    }

    // КРИТИЧЕСКИ ВАЖНО: LIMIT и OFFSET не могут быть плейсхолдерами в MySQL2
    // Вставляем значения напрямую (безопасно, так как limitNum и offsetNum - числа)
    query += ` ORDER BY m.created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`;

    const [messages] = await pool.execute(query, params);

    // Парсим JSON поля read_by и unread_by для каждого сообщения
    for (const message of messages) {
      // Безопасный парсинг JSON полей
      message.read_by = safeParseJsonArray(message.read_by);
      message.unread_by = safeParseJsonArray(message.unread_by);
      
      // Убеждаемся, что отправитель всегда в read_by
      if (!message.read_by.includes(message.sender_id)) {
        message.read_by.push(message.sender_id);
      }
      
      // Удаляем отправителя из unread_by (если он там есть)
      message.unread_by = message.unread_by.filter(id => id !== message.sender_id);
    }

    // Получаем общее количество
    let countQuery = `SELECT COUNT(*) as total FROM messages WHERE chat_id = ? AND deleted_at IS NULL`;
    const countParams = [chatId];
    if (before) {
      countQuery += ` AND created_at < ?`;
      countParams.push(before);
    }
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      chat_id: msg.chat_id,
      sender_id: msg.sender_id,
      sender: {
        id: msg.sender_id,
        display_name: msg.sender_display_name,
        photo_url: msg.sender_photo_url
      },
      message: msg.message,
      message_type: msg.message_type,
      created_at: msg.created_at,
      read_by: msg.read_by,
      unread_by: msg.unread_by
    }));

    success(res, {
      messages: formattedMessages.reverse(),
      total,
      has_more: total > offsetNum + limitNum
    });
  } catch (err) {
    error(res, 'Ошибка при получении сообщений', 500, err);
  }
});

/**
 * GET /api/chats/:chatId/events
 * Server-Sent Events (SSE) поток для получения новых сообщений в реальном времени
 * 
 * Клиент открывает долгий HTTP GET запрос и получает события через SSE
 * Для отправки сообщений используется POST /api/chats/:chatId/messages
 */
router.get('/:chatId/events', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { chatId } = req.params;

    // Проверяем доступ к чату
    let [chats] = await pool.execute(
      `SELECT c.* FROM chats c
       INNER JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE c.id = ? AND cp.user_id = ?`,
      [chatId, userId]
    );

    // Если чат не найден через участников, проверяем, существует ли чат вообще
    if (chats.length === 0) {
      const [chatExists] = await pool.execute(
        `SELECT c.* FROM chats c WHERE c.id = ?`,
        [chatId]
      );

      if (chatExists.length === 0) {
        return error(res, 'Чат не найден', 404);
      }

      const chat = chatExists[0];

      // Для групповых чатов: если пользователь создатель чата - добавляем его
      if (chat.type === 'group' && chat.request_id && chat.created_by === userId) {
        const { addUserToChat } = require('../utils/chatHelpers');
        await addUserToChat(chatId, userId);
        
        // Повторно проверяем доступ
        [chats] = await pool.execute(
          `SELECT c.* FROM chats c
           INNER JOIN chat_participants cp ON c.id = cp.chat_id
           WHERE c.id = ? AND cp.user_id = ?`,
          [chatId, userId]
        );
      }

      if (chats.length === 0) {
        return error(res, 'Чат не найден или нет доступа', 404);
      }
    }

    // Устанавливаем заголовки для SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Отключаем буферизацию в nginx
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Отправляем начальное сообщение о подключении
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      message: 'Подключено к чату',
      chatId: chatId,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Добавляем подключение в хранилище
    if (!sseConnections.has(chatId)) {
      sseConnections.set(chatId, new Set());
    }
    sseConnections.get(chatId).add(res);

    // Отправляем ping каждые 30 секунд для поддержания соединения
    const pingInterval = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify({
          type: 'ping',
          timestamp: new Date().toISOString()
        })}\n\n`);
      } catch (err) {
        // Клиент отключился
        clearInterval(pingInterval);
        const connections = sseConnections.get(chatId);
        if (connections) {
          connections.delete(res);
          if (connections.size === 0) {
            sseConnections.delete(chatId);
          }
        }
      }
    }, 30000);

    // Обработка отключения клиента
    req.on('close', () => {
      clearInterval(pingInterval);
      const connections = sseConnections.get(chatId);
      if (connections) {
        connections.delete(res);
        // Если больше нет подключений, удаляем чат из Map
        if (connections.size === 0) {
          sseConnections.delete(chatId);
        }
      }
    });

  } catch (err) {
    error(res, 'Ошибка при подключении к SSE потоку', 500, err);
  }
});

module.exports = router;

