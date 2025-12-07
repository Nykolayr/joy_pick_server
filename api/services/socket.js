const { Server } = require('socket.io');
const { verifyToken } = require('../utils/jwt');
const pool = require('../config/database');
const { generateId } = require('../utils/uuid');
const { normalizeDatesInObject } = require('../utils/datetime');
const { sendNotificationToUsers } = require('./pushNotification');

/**
 * Инициализация Socket.io сервера
 * @param {http.Server} httpServer - HTTP сервер Express
 * @returns {Server} Socket.io сервер
 */
function initializeSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Middleware для аутентификации
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        return next(new Error('Токен авторизации не предоставлен'));
      }

      const decoded = verifyToken(token);
      
      if (!decoded) {
        return next(new Error('Недействительный или истекший токен'));
      }

      // Проверяем существование пользователя в БД
      const [users] = await pool.execute(
        'SELECT id, email, admin FROM users WHERE id = ?',
        [decoded.userId || decoded.id]
      );

      if (users.length === 0) {
        return next(new Error('Пользователь не найден'));
      }

      const user = users[0];
      
      // Сохраняем данные пользователя в socket
      socket.userId = user.id;
      socket.userEmail = user.email;
      socket.isAdmin = user.admin || false;
      
      next();
    } catch (error) {
      next(new Error(`Ошибка аутентификации: ${error.message}`));
    }
  });

  // Обработка подключения
  io.on('connection', (socket) => {
    console.log(`Пользователь подключен: ${socket.userId} (${socket.userEmail})`);

    // Присоединение к чату
    socket.on('join_chat', async (data) => {
      try {
        const { chatId } = data;

        if (!chatId) {
          return socket.emit('error', { message: 'chatId обязателен' });
        }

        // Проверяем права доступа к чату
        const hasAccess = await checkChatAccess(socket.userId, chatId, socket.isAdmin);
        
        if (!hasAccess) {
          return socket.emit('error', { message: 'Нет доступа к этому чату' });
        }

        // Присоединяемся к комнате
        socket.join(`chat:${chatId}`);
        
        // Обновляем last_read_at для участника
        await pool.execute(
          `UPDATE chat_participants 
           SET last_read_at = NOW() 
           WHERE chat_id = ? AND user_id = ?`,
          [chatId, socket.userId]
        );

        socket.emit('joined_chat', { chatId });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Отправка сообщения
    socket.on('send_message', async (data) => {
      try {
        const { chatId, message, messageType = 'text' } = data;

        if (!chatId || !message) {
          return socket.emit('error', { message: 'chatId и message обязательны' });
        }

        // Проверяем права доступа к чату
        const hasAccess = await checkChatAccess(socket.userId, chatId, socket.isAdmin);
        
        if (!hasAccess) {
          return socket.emit('error', { message: 'Нет доступа к этому чату' });
        }

        // Создаем сообщение
        const messageId = generateId();
        await pool.execute(
          `INSERT INTO messages (id, chat_id, sender_id, message, message_type, created_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [messageId, chatId, socket.userId, message, messageType]
        );

        // Помечаем сообщение как прочитанное отправителем
        await pool.execute(
          `INSERT INTO message_reads (id, message_id, user_id, read_at)
           VALUES (?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE read_at = NOW()`,
          [generateId(), messageId, socket.userId]
        );

        // Обновляем last_message_at в чате
        await pool.execute(
          `UPDATE chats SET last_message_at = NOW(), updated_at = NOW() WHERE id = ?`,
          [chatId]
        );

        // Получаем данные отправителя
        const [senders] = await pool.execute(
          'SELECT id, display_name, photo_url, email FROM users WHERE id = ?',
          [socket.userId]
        );
        const sender = senders[0] || {};

        // Получаем созданное сообщение
        const [messages] = await pool.execute(
          `SELECT m.*, 
                  (SELECT COUNT(*) FROM message_reads mr WHERE mr.message_id = m.id) as read_count
           FROM messages m
           WHERE m.id = ?`,
          [messageId]
        );

        const messageData = normalizeDatesInObject(messages[0] || {});
        messageData.sender = {
          id: sender.id,
          display_name: sender.display_name,
          photo_url: sender.photo_url,
          email: sender.email
        };

        // Отправляем сообщение всем участникам комнаты
        io.to(`chat:${chatId}`).emit('new_message', messageData);

        // Отправляем push-уведомления всем участникам чата (кроме отправителя)
        await sendChatPushNotifications(chatId, socket.userId, message, messageType);

      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Отметка о прочтении
    socket.on('mark_as_read', async (data) => {
      try {
        const { messageId, chatId } = data;

        if (!messageId || !chatId) {
          return socket.emit('error', { message: 'messageId и chatId обязательны' });
        }

        // Проверяем права доступа к чату
        const hasAccess = await checkChatAccess(socket.userId, chatId, socket.isAdmin);
        
        if (!hasAccess) {
          return socket.emit('error', { message: 'Нет доступа к этому чату' });
        }

        // Помечаем сообщение как прочитанное
        await pool.execute(
          `INSERT INTO message_reads (id, message_id, user_id, read_at)
           VALUES (?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE read_at = NOW()`,
          [generateId(), messageId, socket.userId]
        );

        // Обновляем last_read_at для участника
        await pool.execute(
          `UPDATE chat_participants 
           SET last_read_at = NOW() 
           WHERE chat_id = ? AND user_id = ?`,
          [chatId, socket.userId]
        );

        // Отправляем событие всем участникам комнаты
        io.to(`chat:${chatId}`).emit('message_read', {
          messageId,
          userId: socket.userId,
          readAt: new Date().toISOString()
        });

      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Индикатор набора текста
    socket.on('typing', async (data) => {
      try {
        const { chatId, isTyping = true } = data;

        if (!chatId) {
          return socket.emit('error', { message: 'chatId обязателен' });
        }

        // Проверяем права доступа к чату
        const hasAccess = await checkChatAccess(socket.userId, chatId, socket.isAdmin);
        
        if (!hasAccess) {
          return socket.emit('error', { message: 'Нет доступа к этому чату' });
        }

        // Отправляем событие всем участникам комнаты (кроме отправителя)
        socket.to(`chat:${chatId}`).emit('user_typing', {
          chatId,
          userId: socket.userId,
          isTyping
        });

      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Отключение
    socket.on('disconnect', () => {
      console.log(`Пользователь отключен: ${socket.userId} (${socket.userEmail})`);
    });
  });

  return io;
}

/**
 * Проверка прав доступа к чату
 * @param {string} userId - ID пользователя
 * @param {string} chatId - ID чата
 * @param {boolean} isAdmin - Является ли пользователь админом
 * @returns {Promise<boolean>}
 */
async function checkChatAccess(userId, chatId, isAdmin) {
  try {
    // Получаем информацию о чате
    const [chats] = await pool.execute(
      'SELECT type, request_id, user_id, created_by FROM chats WHERE id = ?',
      [chatId]
    );

    if (chats.length === 0) {
      return false;
    }

    const chat = chats[0];

    // Админы имеют доступ ко всем чатам
    if (isAdmin) {
      return true;
    }

    // Проверяем по типу чата
    if (chat.type === 'support') {
      // Для support чата: доступ только владельцу (user_id)
      return chat.user_id === userId;
    }

    if (chat.type === 'private') {
      // Для private чата: доступ пользователю (user_id) или создателю заявки
      if (chat.user_id === userId) {
        return true;
      }
      
      // Проверяем, является ли пользователь создателем заявки
      if (chat.request_id) {
        const [requests] = await pool.execute(
          'SELECT created_by FROM requests WHERE id = ?',
          [chat.request_id]
        );
        if (requests.length > 0 && requests[0].created_by === userId) {
          return true;
        }
      }
      
      return false;
    }

    if (chat.type === 'group') {
      // Для group чата: проверяем участие в чате
      const [participants] = await pool.execute(
        'SELECT id FROM chat_participants WHERE chat_id = ? AND user_id = ?',
        [chatId, userId]
      );
      
      return participants.length > 0;
    }

    return false;
  } catch (error) {
    console.error('Ошибка проверки доступа к чату:', error);
    return false;
  }
}

/**
 * Отправка push-уведомлений для новых сообщений в чате
 * @param {string} chatId - ID чата
 * @param {string} senderId - ID отправителя
 * @param {string} message - Текст сообщения
 * @param {string} messageType - Тип сообщения
 */
async function sendChatPushNotifications(chatId, senderId, message, messageType) {
  try {
    // Получаем информацию о чате
    const [chats] = await pool.execute(
      'SELECT type FROM chats WHERE id = ?',
      [chatId]
    );

    if (chats.length === 0) {
      return;
    }

    const chat = chats[0];

    // Для support чата пуши админам НЕ отправляются
    if (chat.type === 'support') {
      // Получаем только пользователя (не админов)
      const [chatsFull] = await pool.execute(
        'SELECT user_id FROM chats WHERE id = ?',
        [chatId]
      );
      
      if (chatsFull.length > 0 && chatsFull[0].user_id !== senderId) {
        await sendNotificationToUsers({
          title: 'Новое сообщение',
          body: message.length > 100 ? message.substring(0, 100) + '...' : message,
          userIds: [chatsFull[0].user_id],
          sound: 'default',
          data: {
            type: 'chat_message',
            chatId: chatId,
            chatType: 'support',
            deeplink: `joypick://chat/${chatId}`
          }
        });
      }
      return;
    }

    // Для других типов чатов: получаем всех участников кроме отправителя
    const [participants] = await pool.execute(
      `SELECT DISTINCT cp.user_id 
       FROM chat_participants cp
       WHERE cp.chat_id = ? AND cp.user_id != ?`,
      [chatId, senderId]
    );

    if (participants.length === 0) {
      return;
    }

    const userIds = participants.map(p => p.user_id);

    await sendNotificationToUsers({
      title: 'Новое сообщение в чате',
      body: message.length > 100 ? message.substring(0, 100) + '...' : message,
      userIds: userIds,
      sound: 'default',
      data: {
        type: 'chat_message',
        chatId: chatId,
        chatType: chat.type,
        deeplink: `joypick://chat/${chatId}`
      }
    });
  } catch (error) {
    console.error('Ошибка отправки push-уведомлений для чата:', error);
  }
}

module.exports = {
  initializeSocket
};

