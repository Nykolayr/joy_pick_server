-- Филиалы партнёра (кафе, магазин и т.д.). Продавец при списании выбирает филиал.

CREATE TABLE IF NOT EXISTS partner_branches (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  partner_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL COMMENT 'Название филиала (напр. Кафе Луна)',
  address TEXT NULL,
  latitude DECIMAL(10,8) NULL,
  longitude DECIMAL(11,8) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_partner_branches_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  INDEX idx_partner_branches_partner_id (partner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
