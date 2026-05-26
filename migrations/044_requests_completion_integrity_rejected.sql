-- Результат провала integrity при сдаче на модерацию (заявка остаётся inProgress)
ALTER TABLE requests
  ADD COLUMN completion_integrity_rejected TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Последняя сдача отклонена автопроверкой' AFTER integrity_checked_at,
  ADD COLUMN completion_integrity_rejected_at DATETIME NULL DEFAULT NULL
    COMMENT 'Когда отклонена сдача' AFTER completion_integrity_rejected,
  ADD COLUMN completion_integrity_summary VARCHAR(512) NULL DEFAULT NULL
    COMMENT 'Краткий текст для UI' AFTER completion_integrity_rejected_at,
  ADD COLUMN completion_integrity_issues JSON NULL DEFAULT NULL
    COMMENT 'Массив issues как в 422' AFTER completion_integrity_summary,
  ADD COLUMN completion_integrity_primary_code VARCHAR(64) NULL DEFAULT NULL
    COMMENT 'Код основной причины' AFTER completion_integrity_issues,
  ADD COLUMN completion_integrity_locale VARCHAR(8) NULL DEFAULT NULL
    COMMENT 'Локаль ответа' AFTER completion_integrity_primary_code;
