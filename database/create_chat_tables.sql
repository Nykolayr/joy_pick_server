-- Миграция: Создание таблиц для системы чатов
-- Дата: 2024-12-06
-- Описание: Создание таблиц chats, messages, message_reads, chat_participants

-- Таблица чатов
CREATE TABLE IF NOT EXISTS chats (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID чата',
  type ENUM('support', 'private', 'group') NOT NULL COMMENT 'Тип чата',
  request_id VARCHAR(36) NULL COMMENT 'ID заявки (для private и group)',
  user_id VARCHAR(36) NULL COMMENT 'ID пользователя (для support и private)',
  created_by VARCHAR(36) NULL COMMENT 'ID создателя чата',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Дата создания',
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP COMMENT 'Дата обновления',
  last_message_at DATETIME NULL COMMENT 'Дата последнего сообщения',
  INDEX idx_type (type),
  INDEX idx_request_id (request_id),
  INDEX idx_user_id (user_id),
  INDEX idx_last_message_at (last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Добавление внешних ключей для таблицы chats
-- Примечание: Если таблицы requests или users не существуют, эти ключи не будут созданы
-- В таком случае выполните ALTER TABLE вручную после создания таблиц

ALTER TABLE chats 
  ADD CONSTRAINT fk_chats_request_id 
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE;

ALTER TABLE chats 
  ADD CONSTRAINT fk_chats_user_id 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE chats 
  ADD CONSTRAINT fk_chats_created_by 
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- Таблица сообщений
CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID сообщения',
  chat_id VARCHAR(36) NOT NULL COMMENT 'ID чата',
  sender_id VARCHAR(36) NOT NULL COMMENT 'ID отправителя',
  message TEXT NOT NULL COMMENT 'Текст сообщения',
  message_type ENUM('text', 'image', 'file') NOT NULL DEFAULT 'text' COMMENT 'Тип сообщения',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Дата отправки',
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP COMMENT 'Дата обновления',
  deleted_at DATETIME NULL COMMENT 'Дата удаления (soft delete)',
  INDEX idx_chat_id (chat_id),
  INDEX idx_sender_id (sender_id),
  INDEX idx_created_at (created_at),
  INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Добавление внешних ключей для таблицы messages
ALTER TABLE messages 
  ADD CONSTRAINT fk_messages_chat_id 
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE;

ALTER TABLE messages 
  ADD CONSTRAINT fk_messages_sender_id 
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

-- Таблица прочтений сообщений
CREATE TABLE IF NOT EXISTS message_reads (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID записи',
  message_id VARCHAR(36) NOT NULL COMMENT 'ID сообщения',
  user_id VARCHAR(36) NOT NULL COMMENT 'ID пользователя',
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Дата прочтения',
  UNIQUE KEY unique_message_user (message_id, user_id),
  INDEX idx_user_id (user_id),
  INDEX idx_read_at (read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Добавление внешних ключей для таблицы message_reads
ALTER TABLE message_reads 
  ADD CONSTRAINT fk_message_reads_message_id 
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;

ALTER TABLE message_reads 
  ADD CONSTRAINT fk_message_reads_user_id 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Таблица участников чатов
CREATE TABLE IF NOT EXISTS chat_participants (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID записи',
  chat_id VARCHAR(36) NOT NULL COMMENT 'ID чата',
  user_id VARCHAR(36) NOT NULL COMMENT 'ID участника',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Дата присоединения',
  last_read_at DATETIME NULL COMMENT 'Дата последнего прочтения',
  UNIQUE KEY unique_chat_user (chat_id, user_id),
  INDEX idx_user_id (user_id),
  INDEX idx_last_read_at (last_read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Добавление внешних ключей для таблицы chat_participants
ALTER TABLE chat_participants 
  ADD CONSTRAINT fk_chat_participants_chat_id 
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE;

ALTER TABLE chat_participants 
  ADD CONSTRAINT fk_chat_participants_user_id 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

