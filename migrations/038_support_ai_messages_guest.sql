-- Гостевая история AI-поддержки (лендинг без JWT): ключ X-Support-Guest-Id (UUID).

CREATE TABLE IF NOT EXISTS support_ai_messages_guest (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  guest_key VARCHAR(64) NOT NULL COMMENT 'UUID v4 от клиента (localStorage)',
  user_message TEXT NOT NULL,
  answer TEXT NOT NULL,
  answer_en TEXT DEFAULT NULL,
  locale VARCHAR(10) NOT NULL,
  model VARCHAR(128) DEFAULT NULL,
  sources_json JSON DEFAULT NULL,
  translation_fallback TINYINT(1) NOT NULL DEFAULT 0,
  error_message TEXT DEFAULT NULL COMMENT 'Если генерация упала',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_support_ai_guest_created (guest_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
