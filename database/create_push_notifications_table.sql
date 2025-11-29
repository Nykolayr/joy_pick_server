-- Миграция: Создание таблицы push_notifications
-- Дата: 2025-01-28
-- Описание: Таблица для хранения всех push-уведомлений, отправленных пользователям

-- Создание таблицы push_notifications
CREATE TABLE IF NOT EXISTS push_notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  data JSON NULL COMMENT 'Дополнительные данные уведомления (type, requestId и т.д.)',
  `read` BOOLEAN DEFAULT FALSE COMMENT 'Прочитано ли уведомление',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_user_read (user_id, `read`),
  INDEX idx_created_at (created_at),
  CONSTRAINT fk_push_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

