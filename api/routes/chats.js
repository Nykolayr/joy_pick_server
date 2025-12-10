const express = require('express');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');

const router = express.Router();

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

    let query = `
      SELECT DISTINCT c.*, 
        (SELECT COUNT(*) FROM messages m 
         WHERE m.chat_id = c.id 
         AND m.deleted_at IS NULL
         AND m.id NOT IN (
           SELECT message_id FROM message_reads WHERE user_id = ?
         )) as unread_count,
        (SELECT m.id FROM messages m 
         WHERE m.chat_id = c.id 
         AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC LIMIT 1) as last_message_id
      FROM chats c
      INNER JOIN chat_participants cp ON c.id = cp.chat_id
      WHERE cp.user_id = ?
    `;
    const params = [userId, userId];

    if (type) {
      query += ` AND c.type = ?`;
      params.push(type);
    }

    query += ` ORDER BY c.last_message_at DESC, c.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limitNum, offsetNum);

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
      WHERE cp.user_id = ?
    `;
    const countParams = [userId];
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
         AND m.id NOT IN (
           SELECT message_id FROM message_reads WHERE user_id = ?
         )) as unread_count
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
         AND m.id NOT IN (
           SELECT message_id FROM message_reads WHERE user_id = ?
         )) as unread_count
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
 * Создать приватный чат с создателем заявки
 */
router.post('/private', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { request_id } = req.body;

    if (!request_id) {
      return error(res, 'request_id обязателен', 400);
    }

    // Проверяем существование заявки
    const [requests] = await pool.execute(
      `SELECT created_by FROM requests WHERE id = ?`,
      [request_id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const createdBy = requests[0].created_by;

    if (userId === createdBy) {
      return error(res, 'Нельзя создать приватный чат с самим собой', 400);
    }

    // Проверяем, существует ли уже чат
    const [existing] = await pool.execute(
      `SELECT * FROM chats 
       WHERE type = 'private' AND request_id = ? AND user_id = ?`,
      [request_id, userId]
    );

    if (existing.length > 0) {
      return success(res, existing[0]);
    }

    // Создаем новый чат
    const chatId = generateId();
    await pool.execute(
      `INSERT INTO chats (id, type, request_id, user_id, created_by, created_at, last_message_at)
       VALUES (?, 'private', ?, ?, ?, NOW(), NOW())`,
      [chatId, request_id, userId, userId]
    );

    // Добавляем участников
    await pool.execute(
      `INSERT INTO chat_participants (chat_id, user_id, joined_at)
       VALUES (?, ?, NOW())`,
      [chatId, userId]
    );
    await pool.execute(
      `INSERT INTO chat_participants (chat_id, user_id, joined_at)
       VALUES (?, ?, NOW())`,
      [chatId, createdBy]
    );

    const [newChat] = await pool.execute(
      `SELECT * FROM chats WHERE id = ?`,
      [chatId]
    );

    success(res, { ...newChat[0], unread_count: 0 }, 'Приватный чат создан', 201);
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
         AND m.id NOT IN (
           SELECT message_id FROM message_reads WHERE user_id = ?
         )) as unread_count,
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
    const [chats] = await pool.execute(
      `SELECT c.* FROM chats c
       INNER JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE c.id = ? AND cp.user_id = ?`,
      [chatId, userId]
    );

    if (chats.length === 0) {
      return error(res, 'Чат не найден или нет доступа', 404);
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

    query += ` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limitNum, offsetNum);

    const [messages] = await pool.execute(query, params);

    // Получаем информацию о прочтении для каждого сообщения
    for (const message of messages) {
      const [reads] = await pool.execute(
        `SELECT user_id, read_at FROM message_reads WHERE message_id = ?`,
        [message.id]
      );
      message.read_by = reads;
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
      read_by: msg.read_by
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
    const [chats] = await pool.execute(
      `SELECT c.* FROM chats c
       INNER JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE c.id = ? AND cp.user_id = ?`,
      [chatId, userId]
    );

    if (chats.length === 0) {
      return error(res, 'Чат не найден или нет доступа', 404);
    }

    // Сохраняем сообщение
    const messageId = generateId();
    await pool.execute(
      `INSERT INTO messages (id, chat_id, sender_id, message, message_type, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [messageId, chatId, userId, message, message_type]
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

    // Отправляем через Socket.io (если доступен)
    try {
      // Получаем io из главного app через req.app
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
      created_at: messageData.created_at
    }, 'Сообщение отправлено', 201);
  } catch (err) {
    error(res, 'Ошибка при отправке сообщения', 500, err);
  }
});

/**
 * POST /api/chats/:chatId/messages/:messageId/read
 * Отметить сообщение как прочитанное
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

    // Сохраняем отметку о прочтении
    await pool.execute(
      `INSERT INTO message_reads (message_id, user_id, read_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE read_at = NOW()`,
      [messageId, userId]
    );

    // Отправляем через Socket.io (если доступен)
    try {
      const mainApp = req.app;
      const io = mainApp ? mainApp.get('io') : null;
      if (io) {
        io.to(`chat:${chatId}`).emit('message_read', {
          success: true,
          messageId: messageId,
          userId: userId,
          readAt: new Date().toISOString()
        });
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

    let query = `
      SELECT c.*, 
        (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) as participants_count
      FROM chats c
      WHERE 1=1
    `;
    const params = [];

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

    query += ` ORDER BY c.last_message_at DESC, c.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limitNum, offsetNum);

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

    query += ` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limitNum, offsetNum);

    const [messages] = await pool.execute(query, params);

    // Получаем информацию о прочтении
    for (const message of messages) {
      const [reads] = await pool.execute(
        `SELECT user_id, read_at FROM message_reads WHERE message_id = ?`,
        [message.id]
      );
      message.read_by = reads;
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
      read_by: msg.read_by
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

module.exports = router;

