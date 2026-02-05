-- Одноразовые QR-токены для волонтёров. Каждый показ QR = новый токен, после списания или истечения — недействителен.

CREATE TABLE IF NOT EXISTS volunteer_qr_tokens (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT 'Волонтёр (users.id)',
  token VARCHAR(64) NOT NULL COMMENT 'Одноразовый токен (в QR)',
  used_at TIMESTAMP NULL COMMENT 'Когда использован (после списания)',
  expires_at TIMESTAMP NOT NULL COMMENT 'Срок действия (например 2 минуты)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qr_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_volunteer_qr_tokens_token (token),
  INDEX idx_qr_tokens_token (token),
  INDEX idx_qr_tokens_user_id (user_id),
  INDEX idx_qr_tokens_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
