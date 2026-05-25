-- Предварительное авторешение модерации (финал через grace period или вмешательство админа)
ALTER TABLE requests
  ADD COLUMN moderation_proposed_action ENUM('approve', 'reject') NULL DEFAULT NULL
    COMMENT 'Предложенное решение автомодерации' AFTER submitted_for_review_at,
  ADD COLUMN moderation_proposed_at DATETIME NULL DEFAULT NULL
    COMMENT 'Когда вынесено предложенное решение' AFTER moderation_proposed_action,
  ADD COLUMN moderation_finalize_at DATETIME NULL DEFAULT NULL
    COMMENT 'Когда предложение станет финальным (proposed_at + grace)' AFTER moderation_proposed_at,
  ADD COLUMN moderation_proposed_reason_code VARCHAR(64) NULL DEFAULT NULL
    COMMENT 'Код причины (reject/audit)' AFTER moderation_finalize_at,
  ADD COLUMN moderation_proposed_meta JSON NULL DEFAULT NULL
    COMMENT 'Снимок сигналов для админки' AFTER moderation_proposed_reason_code,
  ADD COLUMN moderation_proposed_rule_version VARCHAR(32) NULL DEFAULT NULL
    COMMENT 'Версия правил автомодерации' AFTER moderation_proposed_meta,
  ADD COLUMN moderation_confirmed_by CHAR(36) NULL DEFAULT NULL
    COMMENT 'Админ подтвердил предложенное решение' AFTER moderation_proposed_rule_version,
  ADD COLUMN moderation_confirmed_at DATETIME NULL DEFAULT NULL AFTER moderation_confirmed_by,
  ADD COLUMN moderation_cancelled_at DATETIME NULL DEFAULT NULL
    COMMENT 'Админ отменил авторешение' AFTER moderation_confirmed_at;

CREATE INDEX idx_requests_pending_moderation_finalize
  ON requests (status, moderation_finalize_at);
