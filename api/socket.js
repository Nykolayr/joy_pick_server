const { verifyToken } = require('./utils/jwt');
const pool = require('./config/database');

/**
 * Инициализация Socket.io сервера
 * @param {Server} io - Socket.io сервер
 */
module.exports = function(io) {
  // Middleware для аутентификации Socket.io
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return next(new Error('Токен авторизации не предоставлен'));
    }
    
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return next(new Error('Недействительный или истекший токен'));
    }
    
    // Сохраняем данные пользователя в socket
    socket.userId = decoded.userId || decoded.id;
    socket.isAdmin = decoded.isAdmin || false;
    
    next();
  });

  io.on('connection', (socket) => {
    // Все ошибки возвращаем клиенту через события, не логируем в файлы
    socket.on('error', (error) => {
      socket.emit('error', {
        success: false,
        message: error.message || 'Ошибка Socket.io',
        error: error.message
      });
    });

    /**
     * Присоединение к чату
     * Событие: join_chat
     * Данные: { chatId: string }
     */
    socket.on('join_chat', async (data) => {
      try {
        const { chatId } = data;
        
        if (!chatId) {
          return socket.emit('error', {
            success: false,
            message: 'chatId обязателен'
          });
        }

        // Проверка прав доступа к чату
        const [chats] = await pool.execute(
          `SELECT c.*, cp.user_id 
           FROM chats c
           LEFT JOIN chat_participants cp ON c.id = cp.chat_id
           WHERE c.id = ? AND (cp.user_id = ? OR c.type = 'support' AND ? = 1)`,
          [chatId, socket.userId, socket.isAdmin ? 1 : 0]
        );

        if (!chats || chats.length === 0) {
          return socket.emit('error', {
            success: false,
            message: 'Чат не найден или нет доступа'
          });
        }

        // Присоединяемся к комнате
        socket.join(`chat:${chatId}`);
        
        socket.emit('joined_chat', {
          success: true,
          chatId: chatId,
          message: 'Успешно присоединен к чату'
        });
      } catch (error) {
        socket.emit('error', {
          success: false,
          message: 'Ошибка при присоединении к чату',
          error: error.message,
          errorDetails: {
            name: error.name,
            code: error.code,
            sqlMessage: error.sqlMessage
          }
        });
      }
    });

    /**
     * Отправка сообщения
     * Событие: send_message
     * Данные: { chatId: string, message: string, messageType: string }
     */
    socket.on('send_message', async (data) => {
      try {
        const { chatId, message, messageType = 'text' } = data;
        
        if (!chatId || !message) {
          return socket.emit('error', {
            success: false,
            message: 'chatId и message обязательны'
          });
        }

        // Проверка прав доступа
        const [chats] = await pool.execute(
          `SELECT c.*, cp.user_id 
           FROM chats c
           LEFT JOIN chat_participants cp ON c.id = cp.chat_id
           WHERE c.id = ? AND cp.user_id = ?`,
          [chatId, socket.userId]
        );

        if (!chats || chats.length === 0) {
          return socket.emit('error', {
            success: false,
            message: 'Чат не найден или нет доступа'
          });
        }

        // Сохранение сообщения в БД
        const messageId = require('./utils/uuid').generateUUID();
        await pool.execute(
          `INSERT INTO messages (id, chat_id, sender_id, message, message_type, created_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [messageId, chatId, socket.userId, message, messageType]
        );

        // Получаем сохраненное сообщение
        const [messages] = await pool.execute(
          `SELECT * FROM messages WHERE id = ?`,
          [messageId]
        );

        const messageData = messages[0];

        // Отправляем сообщение всем участникам комнаты
        io.to(`chat:${chatId}`).emit('new_message', {
          success: true,
          ...messageData
        });

        // TODO: Отправка push-уведомлений (через API)
      } catch (error) {
        socket.emit('error', {
          success: false,
          message: 'Ошибка при отправке сообщения',
          error: error.message,
          errorDetails: {
            name: error.name,
            code: error.code,
            sqlMessage: error.sqlMessage
          }
        });
      }
    });

    /**
     * Отметка о прочтении
     * Событие: mark_as_read
     * Данные: { messageId: string, chatId: string }
     */
    socket.on('mark_as_read', async (data) => {
      try {
        const { messageId, chatId } = data;
        
        if (!messageId || !chatId) {
          return socket.emit('error', {
            success: false,
            message: 'messageId и chatId обязательны'
          });
        }

        // Сохранение отметки о прочтении
        await pool.execute(
          `INSERT INTO message_reads (message_id, user_id, read_at)
           VALUES (?, ?, NOW())
           ON DUPLICATE KEY UPDATE read_at = NOW()`,
          [messageId, socket.userId]
        );

        // Отправляем событие всем участникам комнаты
        io.to(`chat:${chatId}`).emit('message_read', {
          success: true,
          messageId: messageId,
          userId: socket.userId,
          readAt: new Date().toISOString()
        });
      } catch (error) {
        socket.emit('error', {
          success: false,
          message: 'Ошибка при отметке о прочтении',
          error: error.message,
          errorDetails: {
            name: error.name,
            code: error.code,
            sqlMessage: error.sqlMessage
          }
        });
      }
    });

    /**
     * Индикатор набора текста
     * Событие: typing
     * Данные: { chatId: string, isTyping: boolean }
     */
    socket.on('typing', (data) => {
      try {
        const { chatId, isTyping } = data;
        
        if (!chatId) {
          return socket.emit('error', {
            success: false,
            message: 'chatId обязателен'
          });
        }

        // Отправляем событие всем участникам комнаты, кроме отправителя
        socket.to(`chat:${chatId}`).emit('user_typing', {
          chatId: chatId,
          userId: socket.userId,
          isTyping: isTyping || false
        });
      } catch (error) {
        socket.emit('error', {
          success: false,
          message: 'Ошибка при отправке индикатора набора',
          error: error.message
        });
      }
    });

    // Отключение
    socket.on('disconnect', (reason) => {
      // Все комнаты автоматически покидаются при отключении
    });
  });
};

