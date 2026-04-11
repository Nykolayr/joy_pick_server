-- Контекст рассылки: триггер, причина, заявка, полный payload data.

ALTER TABLE admin_notification_sends
  ADD COLUMN push_trigger VARCHAR(255) DEFAULT NULL COMMENT 'Тип/источник триггера (код или метка)' AFTER body,
  ADD COLUMN send_reason TEXT DEFAULT NULL COMMENT 'Зачем отправили (человекочитаемо)' AFTER push_trigger,
  ADD COLUMN request_id VARCHAR(36) DEFAULT NULL COMMENT 'Связанная заявка, если есть' AFTER send_reason,
  ADD COLUMN payload_json JSON DEFAULT NULL COMMENT 'Копия data из POST /send' AFTER request_id,
  ADD INDEX idx_admin_notification_sends_request_id (request_id);
