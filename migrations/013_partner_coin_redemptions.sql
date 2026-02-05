-- Списание коинов волонтёра у партнёра (скидка). История у партнёра и у волонтёра — выборка из этой таблицы.

CREATE TABLE IF NOT EXISTS partner_coin_redemptions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  partner_id VARCHAR(36) NOT NULL,
  branch_id VARCHAR(36) NOT NULL,
  seller_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL COMMENT 'Волонтёр (users.id)',
  coins_spent INT NOT NULL COMMENT 'Списано коинов',
  amount_cents INT NOT NULL COMMENT 'Сумма скидки в центах (по курсу партнёра)',
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_redemptions_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  CONSTRAINT fk_redemptions_branch FOREIGN KEY (branch_id) REFERENCES partner_branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_redemptions_seller FOREIGN KEY (seller_id) REFERENCES partner_sellers(id) ON DELETE CASCADE,
  CONSTRAINT fk_redemptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_redemptions_partner_id (partner_id),
  INDEX idx_redemptions_user_id (user_id),
  INDEX idx_redemptions_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
