-- История AI-поддержки в приложении (только владелец, без админских роутов).

CREATE TABLE IF NOT EXISTS support_ai_messages (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  user_message TEXT NOT NULL,
  answer TEXT NOT NULL,
  answer_en TEXT DEFAULT NULL,
  locale VARCHAR(10) NOT NULL,
  model VARCHAR(128) DEFAULT NULL,
  sources_json JSON DEFAULT NULL,
  translation_fallback TINYINT(1) NOT NULL DEFAULT 0,
  error_message TEXT DEFAULT NULL COMMENT 'Если генерация упала, текст ошибки (без секретов)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_support_ai_user_created (user_id, created_at),
  CONSTRAINT fk_support_ai_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
