-- Продавцы партнёра. Вход в приложение по логину/паролю. Логин уникален в рамках партнёра.

CREATE TABLE IF NOT EXISTS partner_sellers (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  partner_id VARCHAR(36) NOT NULL,
  full_name VARCHAR(255) NOT NULL COMMENT 'ФИО',
  login VARCHAR(255) NOT NULL COMMENT 'Логин для входа (уникален в рамках partner_id)',
  password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt хеш пароля',
  job_title VARCHAR(255) NULL COMMENT 'Должность',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_partner_sellers_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  UNIQUE KEY uk_partner_sellers_partner_login (partner_id, login),
  INDEX idx_partner_sellers_partner_id (partner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
