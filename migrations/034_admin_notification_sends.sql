-- История массовых push-рассылок из админки (POST /notifications/send).

CREATE TABLE IF NOT EXISTS admin_notification_sends (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  image_url VARCHAR(1000) DEFAULT NULL,
  sent_by_user_id VARCHAR(36) DEFAULT NULL,
  recipient_count INT NOT NULL DEFAULT 0 COMMENT 'Число user_ids в запросе',
  success_count INT NOT NULL DEFAULT 0 COMMENT 'Успешные доставки FCM (по токенам)',
  failed_count INT NOT NULL DEFAULT 0 COMMENT 'Неуспешные доставки FCM (по токенам)',
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_notification_sends_sent_at (sent_at),
  CONSTRAINT fk_admin_notification_sends_user FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
