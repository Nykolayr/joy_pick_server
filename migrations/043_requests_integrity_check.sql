-- Результат проверки целостности (создание / модерация) для админки и авто-reject
ALTER TABLE requests
  ADD COLUMN integrity_check_json JSON NULL DEFAULT NULL
    COMMENT 'Последний результат requestIntegrityCheck' AFTER moderation_cancelled_at,
  ADD COLUMN integrity_checked_at DATETIME NULL DEFAULT NULL
    COMMENT 'Когда выполнялась проверка integrity' AFTER integrity_check_json;
