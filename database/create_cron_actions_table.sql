-- Таблица для хранения истории выполненных действий cron
CREATE TABLE IF NOT EXISTS cron_actions (
  id VARCHAR(36) PRIMARY KEY,
  action_type VARCHAR(50) NOT NULL COMMENT 'Тип действия: autoCompleteSpeedCleanup, checkWasteReminders, checkExpiredWasteJoins, deleteInactiveRequests, checkEventTimes',
  request_id VARCHAR(36) NULL COMMENT 'ID заявки, к которой относится действие',
  request_category VARCHAR(20) NULL COMMENT 'Категория заявки: speedCleanup, wasteLocation, event',
  action_description TEXT NOT NULL COMMENT 'Описание действия',
  status VARCHAR(20) DEFAULT 'completed' COMMENT 'Статус: completed, failed',
  executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Время выполнения',
  metadata JSON NULL COMMENT 'Дополнительные данные (количество обработанных заявок, ошибки и т.д.)',
  INDEX idx_executed_at (executed_at),
  INDEX idx_action_type (action_type),
  INDEX idx_request_id (request_id),
  CONSTRAINT fk_cron_actions_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

