const { verifyToken } = require('./utils/jwt');
const pool = require('./config/database');

/**
 * Инициализация Socket.io сервера
 * @param {Server} io - Socket.io сервер
 */
module.exports = function(io) {
  // Диагностика: отслеживание всех подключений
  io.engine.on('connection_error', (err) => {
    // Эта ошибка будет передана клиенту через connect_error
    // Детали доступны в err.message и err.context
    // ВСЕ ОШИБКИ ВОЗВРАЩАЮТСЯ В JSON - НЕ ЛОГИРУЕМ В ФАЙЛЫ
  });

  // Диагностика: отслеживание попыток подключения
  io.engine.on('initial_headers', (headers, req) => {
    // Заголовки для диагностики (не логируем, только для отладки)
  });

  // Диагностика: отслеживание установки соединения
  io.engine.on('connection', (socket) => {
    // Соединение установлено на уровне engine
  });

  // Middleware для аутентификации Socket.io
  io.use((socket, next) => {
    try {
      // Пробуем получить токен из разных мест
      const authToken = socket.handshake.auth?.token;
      const headerAuth = socket.handshake.headers?.authorization || 
                        socket.handshake.headers?.Authorization;
      const queryToken = socket.handshake.query?.token;
      
      let token = authToken;
      
      if (!token && headerAuth) {
        token = headerAuth.replace(/^Bearer\s+/i, '').trim();
      }
      
      if (!token && queryToken) {
        token = queryToken;
      }
      
      // КРИТИЧЕСКИ ВАЖНО: Для диагностики возвращаем детальную ошибку
      if (!token) {
        const error = new Error('Токен авторизации не предоставлен. Проверьте, что токен передается в auth.token при подключении');
        error.data = {
          message: 'Токен авторизации не предоставлен',
          hint: 'Проверьте, что токен передается в auth.token при подключении',
          received: {
            hasAuthToken: !!authToken,
            hasHeaderAuth: !!headerAuth,
            hasQueryToken: !!queryToken,
            authKeys: Object.keys(socket.handshake.auth || {}),
            headerKeys: Object.keys(socket.handshake.headers || {}),
            queryKeys: Object.keys(socket.handshake.query || {})
          }
        };
        return next(error);
      }
      
      // Проверяем токен
      const decoded = verifyToken(token);
      
      if (!decoded) {
        const error = new Error('Недействительный или истекший токен. Проверьте, что токен действителен и не истек');
        error.data = {
          message: 'Недействительный или истекший токен',
          hint: 'Проверьте, что токен действителен и не истек',
          tokenLength: token.length,
          tokenStart: token.substring(0, 20) + '...'
        };
        return next(error);
      }
      
      // Сохраняем данные пользователя в socket
      socket.userId = decoded.userId || decoded.id;
      socket.isAdmin = decoded.isAdmin || false;
      
      next();
    } catch (err) {
      const error = new Error(`Ошибка аутентификации: ${err.message}`);
      error.data = {
        message: err.message,
        originalError: err.name,
        stack: err.stack
      };
      next(error);
    }
  });

  io.on('connection', (socket) => {
    // Подключение успешно установлено
    // Все ошибки возвращаем клиенту через события, не логируем в файлы
    socket.on('error', (error) => {
      socket.emit('error', {
        success: false,
        message: error.message || 'Ошибка Socket.io',
        error: error.message
      });
    });
    
    // Обработка ошибок подключения (если они произошли после установки соединения)
    socket.on('disconnect', (reason) => {
      // Все комнаты автоматически покидаются при отключении
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

        // Получаем всех участников чата
        const [participants] = await pool.execute(
          `SELECT user_id FROM chat_participants WHERE chat_id = ?`,
          [chatId]
        );

        // Формируем массивы: отправитель в read_by, остальные в unread_by
        const readBy = [socket.userId]; // Отправитель сразу прочитал
        const unreadBy = participants
          .map(p => p.user_id)
          .filter(id => id !== socket.userId); // Все остальные участники

        // Сохранение сообщения в БД с JSON полями
        const messageId = require('./utils/uuid').generateUUID();
        await pool.execute(
          `INSERT INTO messages (id, chat_id, sender_id, message, message_type, created_at, read_by, unread_by)
           VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
          [
            messageId,
            chatId,
            socket.userId,
            message,
            messageType,
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
          `SELECT * FROM messages WHERE id = ?`,
          [messageId]
        );

        const messageData = messages[0];
        
        // Парсим JSON поля
        messageData.read_by = messageData.read_by ? JSON.parse(messageData.read_by) : [];
        messageData.unread_by = messageData.unread_by ? JSON.parse(messageData.unread_by) : [];

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

        // Получаем сообщение
        const [messages] = await pool.execute(
          `SELECT id, read_by, unread_by FROM messages 
           WHERE id = ? AND chat_id = ? AND deleted_at IS NULL`,
          [messageId, chatId]
        );

        if (messages.length === 0) {
          return socket.emit('error', {
            success: false,
            message: 'Сообщение не найдено'
          });
        }

        const message = messages[0];
        let readBy = message.read_by ? JSON.parse(message.read_by) : [];
        let unreadBy = message.unread_by ? JSON.parse(message.unread_by) : [];

        // Перемещаем userId из unread_by в read_by
        if (unreadBy.includes(socket.userId)) {
          unreadBy = unreadBy.filter(id => id !== socket.userId);
          if (!readBy.includes(socket.userId)) {
            readBy.push(socket.userId);
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

