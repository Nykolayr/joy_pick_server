-- Очередь ревью качества Support AI (замечания админа → правки агентом).

CREATE TABLE IF NOT EXISTS support_ai_review_tickets (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  status ENUM('draft', 'pending_review', 'fixed') NOT NULL DEFAULT 'draft',
  locale VARCHAR(10) NOT NULL,
  history_json JSON NOT NULL,
  created_by_admin_id VARCHAR(36) NOT NULL,
  fixed_at TIMESTAMP NULL DEFAULT NULL,
  fixed_by VARCHAR(64) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_support_ai_review_status_updated (status, updated_at DESC),
  CONSTRAINT fk_support_ai_review_admin FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
