-- Источник записи: ручная рассылка из админки или системный/cron пуш.

ALTER TABLE admin_notification_sends
  ADD COLUMN send_source VARCHAR(32) NOT NULL DEFAULT 'system' COMMENT 'admin_manual | system' AFTER sent_by_user_id,
  ADD INDEX idx_admin_notification_sends_send_source (send_source);

UPDATE admin_notification_sends SET send_source = 'admin_manual' WHERE sent_by_user_id IS NOT NULL;
