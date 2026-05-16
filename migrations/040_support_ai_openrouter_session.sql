-- Текущая OpenRouter session_id для Support AI (одна на активный чат до очистки истории).

CREATE TABLE IF NOT EXISTS support_ai_openrouter_session (
  owner_key VARCHAR(70) NOT NULL PRIMARY KEY COMMENT 'user:<userId> или guest:<guestKey>',
  session_id VARCHAR(256) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
