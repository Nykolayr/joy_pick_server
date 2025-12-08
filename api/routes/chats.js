const express = require('express');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { normalizeDatesInObject, normalizeDatesInArray } = require('../utils/datetime');

const router = express.Router();

/**
 * GET /api/chats/support
 * Получить чат техподдержки текущего пользователя
 */
router.get('/support', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    // Ищем существующий чат support для пользователя
    const [chats] = await pool.execute(
      `SELECT c.*, 
              (SELECT COUNT(*) FROM messages m 
               WHERE m.chat_id = c.id 
               AND m.deleted_at IS NULL 
               AND m.id NOT IN (
                 SELECT mr.message_id FROM message_reads mr 
                 WHERE mr.user_id = ? AND mr.message_id = m.id
               )) as unread_count
       FROM chats c
       WHERE c.type = 'support' AND c.user_id = ?`,
      [userId, userId]
    );

    if (chats.length === 0) {
      return success(res, null, 'Чат техподдержки не найден. Создайте его через POST /api/chats/support', 200);
    }

    const chat = normalizeDatesInObject(chats[0]);
    return success(res, chat);
  } catch (err) {
    return error(res, 'Ошибка при получении чата техподдержки', 500, err);
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
    const [existingChats] = await pool.execute(
      'SELECT id FROM chats WHERE type = ? AND user_id = ?',
      ['support', userId]
    );

    if (existingChats.length > 0) {
      // Возвращаем существующий чат
      const [chats] = await pool.execute(
        `SELECT c.*, 
                (SELECT COUNT(*) FROM messages m 
                 WHERE m.chat_id = c.id 
                 AND m.deleted_at IS NULL 
                 AND m.id NOT IN (
                   SELECT mr.message_id FROM message_reads mr 
                   WHERE mr.user_id = ? AND mr.message_id = m.id
                 )) as unread_count
         FROM chats c
         WHERE c.id = ?`,
        [userId, existingChats[0].id]
      );
      const chat = normalizeDatesInObject(chats[0]);
      return success(res, chat);
    }

    // Создаем новый чат
    const chatId = generateId();
    await pool.execute(
      `INSERT INTO chats (id, type, user_id, created_by, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [chatId, 'support', userId, userId]
    );

    // Проверяем, является ли пользователь админом
    const [userCheck] = await pool.execute(
      'SELECT admin FROM users WHERE id = ?',
      [userId]
    );
    const isUserAdmin = userCheck.length > 0 && userCheck[0].admin === 1;

    // Получаем всех админов (исключая текущего пользователя, если он админ)
    let adminsQuery = 'SELECT id FROM users WHERE admin = true';
    const adminParams = [];
    if (isUserAdmin) {
      adminsQuery += ' AND id != ?';
      adminParams.push(userId);
    }
    const [admins] = await pool.execute(adminsQuery, adminParams);

    // Добавляем пользователя в участники
    await pool.execute(
      `INSERT INTO chat_participants (id, chat_id, user_id, joined_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE joined_at = joined_at`,
      [generateId(), chatId, userId]
    );

    // Добавляем всех админов в участники (исключая пользователя, если он админ)
    for (const admin of admins) {
      await pool.execute(
        `INSERT INTO chat_participants (id, chat_id, user_id, joined_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE joined_at = joined_at`,
        [generateId(), chatId, admin.id]
      );
    }

    // Получаем созданный чат
    const [chats] = await pool.execute(
      `SELECT c.*, 
              (SELECT COUNT(*) FROM messages m 
               WHERE m.chat_id = c.id 
               AND m.deleted_at IS NULL 
               AND m.id NOT IN (
                 SELECT mr.message_id FROM message_reads mr 
                 WHERE mr.user_id = ? AND mr.message_id = m.id
               )) as unread_count
       FROM chats c
       WHERE c.id = ?`,
      [userId, chatId]
    );

    const chat = normalizeDatesInObject(chats[0]);
    return success(res, chat, 'Чат техподдержки создан', 201);
  } catch (err) {
    return error(res, 'Ошибка при создании чата техподдержки', 500, err);
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
      'SELECT created_by FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const requestCreatorId = requests[0].created_by;

    // Нельзя создать чат с самим собой
    if (userId === requestCreatorId) {
      return error(res, 'Нельзя создать чат с самим собой', 400);
    }

    // Ищем существующий чат
    const [chats] = await pool.execute(
      `SELECT c.*, 
              (SELECT COUNT(*) FROM messages m 
               WHERE m.chat_id = c.id 
               AND m.deleted_at IS NULL 
               AND m.id NOT IN (
                 SELECT mr.message_id FROM message_reads mr 
                 WHERE mr.user_id = ? AND mr.message_id = m.id
               )) as unread_count
       FROM chats c
       WHERE c.type = 'private' 
         AND c.request_id = ? 
         AND c.user_id = ?`,
      [userId, requestId, userId]
    );

    if (chats.length === 0) {
      return success(res, null, 'Приватный чат не найден. Создайте его через POST /api/chats/private', 200);
    }

    const chat = normalizeDatesInObject(chats[0]);
    return success(res, chat);
  } catch (err) {
    return error(res, 'Ошибка при получении приватного чата', 500, err);
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
      'SELECT created_by, status FROM requests WHERE id = ?',
      [request_id]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    const requestCreatorId = requests[0].created_by;
    const requestStatus = requests[0].status;

    // Нельзя создать чат с самим собой
    if (userId === requestCreatorId) {
      return error(res, 'Нельзя создать чат с самим собой', 400);
    }

    // Нельзя создать чат для завершенной или удаленной заявки
    if (requestStatus === 'completed' || requestStatus === 'rejected') {
      return error(res, 'Нельзя создать чат для завершенной или отклоненной заявки', 400);
    }

    // Проверяем, существует ли уже чат
    const [existingChats] = await pool.execute(
      'SELECT id FROM chats WHERE type = ? AND request_id = ? AND user_id = ?',
      ['private', request_id, userId]
    );

    if (existingChats.length > 0) {
      // Возвращаем существующий чат
      const [chats] = await pool.execute(
        `SELECT c.*, 
                (SELECT COUNT(*) FROM messages m 
                 WHERE m.chat_id = c.id 
                 AND m.deleted_at IS NULL 
                 AND m.id NOT IN (
                   SELECT mr.message_id FROM message_reads mr 
                   WHERE mr.user_id = ? AND mr.message_id = m.id
                 )) as unread_count
         FROM chats c
         WHERE c.id = ?`,
        [userId, existingChats[0].id]
      );
      const chat = normalizeDatesInObject(chats[0]);
      return success(res, chat);
    }

    // Создаем новый чат
    const chatId = generateId();
    await pool.execute(
      `INSERT INTO chats (id, type, request_id, user_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [chatId, 'private', request_id, userId, userId]
    );

    // Добавляем обоих пользователей в участники
    await pool.execute(
      `INSERT INTO chat_participants (id, chat_id, user_id, joined_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE joined_at = joined_at`,
      [generateId(), chatId, userId]
    );

    await pool.execute(
      `INSERT INTO chat_participants (id, chat_id, user_id, joined_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE joined_at = joined_at`,
      [generateId(), chatId, requestCreatorId]
    );

    // Получаем созданный чат
    const [chats] = await pool.execute(
      `SELECT c.*, 
              (SELECT COUNT(*) FROM messages m 
               WHERE m.chat_id = c.id 
               AND m.deleted_at IS NULL 
               AND m.id NOT IN (
                 SELECT mr.message_id FROM message_reads mr 
                 WHERE mr.user_id = ? AND mr.message_id = m.id
               )) as unread_count
       FROM chats c
       WHERE c.id = ?`,
      [userId, chatId]
    );

    const chat = normalizeDatesInObject(chats[0]);
    return success(res, chat, 'Приватный чат создан', 201);
  } catch (err) {
    return error(res, 'Ошибка при создании приватного чата', 500, err);
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
      'SELECT id FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length === 0) {
      return error(res, 'Заявка не найдена', 404);
    }

    // Ищем групповой чат
    const [chats] = await pool.execute(
      `SELECT c.*, 
              (SELECT COUNT(*) FROM chat_participants cp WHERE cp.chat_id = c.id) as participants_count,
              (SELECT COUNT(*) FROM messages m 
               WHERE m.chat_id = c.id 
               AND m.deleted_at IS NULL 
               AND m.id NOT IN (
                 SELECT mr.message_id FROM message_reads mr 
                 WHERE mr.user_id = ? AND mr.message_id = m.id
               )) as unread_count
       FROM chats c
       WHERE c.type = 'group' AND c.request_id = ?`,
      [userId, requestId]
    );

    if (chats.length === 0) {
      return error(res, 'Групповой чат не найден', 404);
    }

    const chat = normalizeDatesInObject(chats[0]);
    return success(res, chat);
  } catch (err) {
    return error(res, 'Ошибка при получении группового чата', 500, err);
  }
});

/**
 * GET /api/chats
 * Получить список всех чатов текущего пользователя
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { type, limit = 20, offset = 0 } = req.query;

    let query = `
      SELECT c.*,
             (SELECT m.message FROM messages m 
              WHERE m.chat_id = c.id AND m.deleted_at IS NULL 
              ORDER BY m.created_at DESC LIMIT 1) as last_message_text,
             (SELECT m.created_at FROM messages m 
              WHERE m.chat_id = c.id AND m.deleted_at IS NULL 
              ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
             (SELECT m.sender_id FROM messages m 
              WHERE m.chat_id = c.id AND m.deleted_at IS NULL 
              ORDER BY m.created_at DESC LIMIT 1) as last_message_sender_id,
             (SELECT COUNT(*) FROM messages m 
              WHERE m.chat_id = c.id 
              AND m.deleted_at IS NULL 
              AND m.id NOT IN (
                SELECT mr.message_id FROM message_reads mr 
                WHERE mr.user_id = ? AND mr.message_id = m.id
              )) as unread_count
      FROM chats c
      INNER JOIN chat_participants cp ON cp.chat_id = c.id
      WHERE cp.user_id = ?
    `;

    const params = [userId, userId];

    if (type) {
      query += ' AND c.type = ?';
      params.push(type);
    }

    query += ' ORDER BY c.last_message_at DESC, c.created_at DESC LIMIT ? OFFSET ?';
    const limitNum = parseInt(limit) || 20;
    const offsetNum = parseInt(offset) || 0;
    params.push(limitNum, offsetNum);

    const [chats] = await pool.execute(query, params);

    // Получаем информацию о последнем сообщении
    const chatsWithLastMessage = await Promise.all(
      chats.map(async (chat) => {
        const normalizedChat = normalizeDatesInObject(chat);
        
        if (normalizedChat.last_message_sender_id) {
          const [senders] = await pool.execute(
            'SELECT id, display_name, photo_url FROM users WHERE id = ?',
            [normalizedChat.last_message_sender_id]
          );
          
          normalizedChat.last_message = {
            text: normalizedChat.last_message_text,
            sender: senders[0] || null,
            created_at: normalizedChat.last_message_at
          };
        }

        delete normalizedChat.last_message_text;
        delete normalizedChat.last_message_at;
        delete normalizedChat.last_message_sender_id;

        return normalizedChat;
      })
    );

    // Получаем общее количество
    let countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM chats c
      INNER JOIN chat_participants cp ON cp.chat_id = c.id
      WHERE cp.user_id = ?
    `;
    const countParams = [userId];

    if (type) {
      countQuery += ' AND c.type = ?';
      countParams.push(type);
    }

    const [counts] = await pool.execute(countQuery, countParams);
    const total = counts[0]?.total || 0;

    return success(res, {
      chats: chatsWithLastMessage,
      total,
      limit: limitNum,
      offset: offsetNum
    });
  } catch (err) {
    return error(res, 'Ошибка при получении списка чатов', 500, err);
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

    // Проверяем доступ к чату
    const [chats] = await pool.execute(
      'SELECT type, request_id, user_id FROM chats WHERE id = ?',
      [chatId]
    );

    if (chats.length === 0) {
      return error(res, 'Чат не найден', 404);
    }

    const chat = chats[0];
    const isAdmin = req.user.isAdmin || false;

    // Проверяем права доступа (упрощенная версия, полная проверка в Socket.io)
    let hasAccess = false;
    if (isAdmin) {
      hasAccess = true;
    } else if (chat.type === 'support' && chat.user_id === userId) {
      hasAccess = true;
    } else if (chat.type === 'private') {
      hasAccess = chat.user_id === userId;
      if (!hasAccess && chat.request_id) {
        const [requests] = await pool.execute(
          'SELECT created_by FROM requests WHERE id = ?',
          [chat.request_id]
        );
        hasAccess = requests.length > 0 && requests[0].created_by === userId;
      }
    } else if (chat.type === 'group') {
      const [participants] = await pool.execute(
        'SELECT id FROM chat_participants WHERE chat_id = ? AND user_id = ?',
        [chatId, userId]
      );
      hasAccess = participants.length > 0;
    }

    if (!hasAccess) {
      return error(res, 'Нет доступа к этому чату', 403);
    }

    // Получаем сообщения
    let query = `
      SELECT m.*,
             u.id as sender_id,
             u.display_name as sender_display_name,
             u.photo_url as sender_photo_url,
             u.email as sender_email
      FROM messages m
      INNER JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = ? AND m.deleted_at IS NULL
    `;

    const params = [chatId];

    if (before) {
      query += ' AND m.created_at < ?';
      params.push(before);
    }

    query += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
    const limitNum = parseInt(limit) || 50;
    const offsetNum = parseInt(offset) || 0;
    params.push(limitNum, offsetNum);

    const [messages] = await pool.execute(query, params);

    // Получаем информацию о прочтении для каждого сообщения
    const messagesWithReads = await Promise.all(
      messages.map(async (message) => {
        const normalizedMessage = normalizeDatesInObject(message);
        
        normalizedMessage.sender = {
          id: normalizedMessage.sender_id,
          display_name: normalizedMessage.sender_display_name,
          photo_url: normalizedMessage.sender_photo_url,
          email: normalizedMessage.sender_email
        };

        delete normalizedMessage.sender_id;
        delete normalizedMessage.sender_display_name;
        delete normalizedMessage.sender_photo_url;
        delete normalizedMessage.sender_email;

        // Получаем список прочитавших
        const [reads] = await pool.execute(
          `SELECT mr.user_id, mr.read_at, u.display_name
           FROM message_reads mr
           INNER JOIN users u ON u.id = mr.user_id
           WHERE mr.message_id = ?
           ORDER BY mr.read_at ASC`,
          [normalizedMessage.id]
        );

        normalizedMessage.read_by = normalizeDatesInArray(reads);

        return normalizedMessage;
      })
    );

    // Реверсируем массив (самые старые первыми)
    messagesWithReads.reverse();

    // Получаем общее количество
    let countQuery = `
      SELECT COUNT(*) as total
      FROM messages m
      WHERE m.chat_id = ? AND m.deleted_at IS NULL
    `;
    const countParams = [chatId];

    if (before) {
      countQuery += ' AND m.created_at < ?';
      countParams.push(before);
    }

    const [counts] = await pool.execute(countQuery, countParams);
    const total = counts[0]?.total || 0;

    return success(res, {
      messages: messagesWithReads,
      total,
      limit: limitNum,
      offset: offsetNum,
      has_more: (offsetNum + messagesWithReads.length) < total
    });
  } catch (err) {
    return error(res, 'Ошибка при получении сообщений', 500, err);
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

    // Проверяем доступ к чату (аналогично GET)
    const [chats] = await pool.execute(
      'SELECT type, request_id, user_id FROM chats WHERE id = ?',
      [chatId]
    );

    if (chats.length === 0) {
      return error(res, 'Чат не найден', 404);
    }

    // Создаем сообщение
    const messageId = generateId();
    await pool.execute(
      `INSERT INTO messages (id, chat_id, sender_id, message, message_type, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [messageId, chatId, userId, message, message_type]
    );

    // Помечаем сообщение как прочитанное отправителем
    await pool.execute(
      `INSERT INTO message_reads (id, message_id, user_id, read_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE read_at = NOW()`,
      [generateId(), messageId, userId]
    );

    // Обновляем last_message_at в чате
    await pool.execute(
      `UPDATE chats SET last_message_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [chatId]
    );

    // Получаем созданное сообщение
    const [messages] = await pool.execute(
      `SELECT m.*,
              u.id as sender_id,
              u.display_name as sender_display_name,
              u.photo_url as sender_photo_url,
              u.email as sender_email
       FROM messages m
       INNER JOIN users u ON u.id = m.sender_id
       WHERE m.id = ?`,
      [messageId]
    );

    const messageData = normalizeDatesInObject(messages[0]);
    messageData.sender = {
      id: messageData.sender_id,
      display_name: messageData.sender_display_name,
      photo_url: messageData.sender_photo_url,
      email: messageData.sender_email
    };

    delete messageData.sender_id;
    delete messageData.sender_display_name;
    delete messageData.sender_photo_url;
    delete messageData.sender_email;

    // TODO: Отправить через Socket.io всем участникам чата
    // Это можно сделать через глобальный io объект

    return success(res, messageData, 'Сообщение отправлено', 201);
  } catch (err) {
    return error(res, 'Ошибка при отправке сообщения', 500, err);
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
      'SELECT id FROM chats WHERE id = ?',
      [chatId]
    );

    if (chats.length === 0) {
      return error(res, 'Чат не найден', 404);
    }

    // Помечаем сообщение как прочитанное
    await pool.execute(
      `INSERT INTO message_reads (id, message_id, user_id, read_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE read_at = NOW()`,
      [generateId(), messageId, userId]
    );

    // Обновляем last_read_at для участника
    await pool.execute(
      `UPDATE chat_participants 
       SET last_read_at = NOW() 
       WHERE chat_id = ? AND user_id = ?`,
      [chatId, userId]
    );

    return success(res, {
      message_id: messageId,
      read_at: new Date().toISOString()
    }, 'Сообщение отмечено как прочитанное');
  } catch (err) {
    return error(res, 'Ошибка при отметке сообщения как прочитанного', 500, err);
  }
});

/**
 * GET /api/admin/chats
 * Получить все чаты (для админов, только просмотр)
 */
router.get('/admin/chats', authenticate, requireAdmin, async (req, res) => {
  try {
    const { type, request_id, user_id, limit = 20, offset = 0 } = req.query;

    let query = `
      SELECT c.*,
             (SELECT m.message FROM messages m 
              WHERE m.chat_id = c.id AND m.deleted_at IS NULL 
              ORDER BY m.created_at DESC LIMIT 1) as last_message_text,
             (SELECT m.created_at FROM messages m 
              WHERE m.chat_id = c.id AND m.deleted_at IS NULL 
              ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
             (SELECT m.sender_id FROM messages m 
              WHERE m.chat_id = c.id AND m.deleted_at IS NULL 
              ORDER BY m.created_at DESC LIMIT 1) as last_message_sender_id,
             (SELECT COUNT(*) FROM chat_participants cp WHERE cp.chat_id = c.id) as participants_count
      FROM chats c
      WHERE 1=1
    `;

    const params = [];

    if (type) {
      query += ' AND c.type = ?';
      params.push(type);
    }

    if (request_id) {
      query += ' AND c.request_id = ?';
      params.push(request_id);
    }

    if (user_id) {
      query += ' AND c.user_id = ?';
      params.push(user_id);
    }

    query += ' ORDER BY c.last_message_at DESC, c.created_at DESC LIMIT ? OFFSET ?';
    const limitNum = parseInt(limit) || 20;
    const offsetNum = parseInt(offset) || 0;
    params.push(limitNum, offsetNum);

    const [chats] = await pool.execute(query, params);

    // Получаем информацию о последнем сообщении
    const chatsWithLastMessage = await Promise.all(
      chats.map(async (chat) => {
        const normalizedChat = normalizeDatesInObject(chat);
        
        if (normalizedChat.last_message_sender_id) {
          const [senders] = await pool.execute(
            'SELECT id, display_name, photo_url FROM users WHERE id = ?',
            [normalizedChat.last_message_sender_id]
          );
          
          normalizedChat.last_message = {
            text: normalizedChat.last_message_text,
            sender: senders[0] || null,
            created_at: normalizedChat.last_message_at
          };
        }

        delete normalizedChat.last_message_text;
        delete normalizedChat.last_message_at;
        delete normalizedChat.last_message_sender_id;

        return normalizedChat;
      })
    );

    // Получаем общее количество
    let countQuery = `
      SELECT COUNT(*) as total
      FROM chats c
      WHERE 1=1
    `;
    const countParams = [];

    if (type) {
      countQuery += ' AND c.type = ?';
      countParams.push(type);
    }

    if (request_id) {
      countQuery += ' AND c.request_id = ?';
      countParams.push(request_id);
    }

    if (user_id) {
      countQuery += ' AND c.user_id = ?';
      countParams.push(user_id);
    }

    const [counts] = await pool.execute(countQuery, countParams);
    const total = counts[0]?.total || 0;

    return success(res, {
      chats: chatsWithLastMessage,
      total,
      limit: limitNum,
      offset: offsetNum
    });
  } catch (err) {
    return error(res, 'Ошибка при получении списка чатов', 500, err);
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

    // Проверяем существование чата
    const [chats] = await pool.execute(
      'SELECT id FROM chats WHERE id = ?',
      [chatId]
    );

    if (chats.length === 0) {
      return error(res, 'Чат не найден', 404);
    }

    // Получаем сообщения
    let query = `
      SELECT m.*,
             u.id as sender_id,
             u.display_name as sender_display_name,
             u.photo_url as sender_photo_url,
             u.email as sender_email
      FROM messages m
      INNER JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = ? AND m.deleted_at IS NULL
    `;

    const params = [chatId];

    if (before) {
      query += ' AND m.created_at < ?';
      params.push(before);
    }

    query += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [messages] = await pool.execute(query, params);

    // Получаем информацию о прочтении для каждого сообщения
    const messagesWithReads = await Promise.all(
      messages.map(async (message) => {
        const normalizedMessage = normalizeDatesInObject(message);
        
        normalizedMessage.sender = {
          id: normalizedMessage.sender_id,
          display_name: normalizedMessage.sender_display_name,
          photo_url: normalizedMessage.sender_photo_url,
          email: normalizedMessage.sender_email
        };

        delete normalizedMessage.sender_id;
        delete normalizedMessage.sender_display_name;
        delete normalizedMessage.sender_photo_url;
        delete normalizedMessage.sender_email;

        // Получаем список прочитавших
        const [reads] = await pool.execute(
          `SELECT mr.user_id, mr.read_at, u.display_name
           FROM message_reads mr
           INNER JOIN users u ON u.id = mr.user_id
           WHERE mr.message_id = ?
           ORDER BY mr.read_at ASC`,
          [normalizedMessage.id]
        );

        normalizedMessage.read_by = normalizeDatesInArray(reads);

        return normalizedMessage;
      })
    );

    // Реверсируем массив (самые старые первыми)
    messagesWithReads.reverse();

    // Получаем общее количество
    let countQuery = `
      SELECT COUNT(*) as total
      FROM messages m
      WHERE m.chat_id = ? AND m.deleted_at IS NULL
    `;
    const countParams = [chatId];

    if (before) {
      countQuery += ' AND m.created_at < ?';
      countParams.push(before);
    }

    const [counts] = await pool.execute(countQuery, countParams);
    const total = counts[0]?.total || 0;
    const limitNum = parseInt(limit) || 50;
    const offsetNum = parseInt(offset) || 0;

    return success(res, {
      messages: messagesWithReads,
      total,
      limit: limitNum,
      offset: offsetNum,
      has_more: (offsetNum + messagesWithReads.length) < total
    });
  } catch (err) {
    return error(res, 'Ошибка при получении сообщений', 500, err);
  }
});

module.exports = router;

