-- Асинхронное массовое создание заявок из Earth Day: очередь + прогресс для фронта.

CREATE TABLE IF NOT EXISTS earthday_bulk_create_jobs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  created_by VARCHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | running | done | failed',
  objectids_json JSON NOT NULL COMMENT 'Массив целых objectid earthday_cleanups',
  progress_offset INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Сколько id уже обработано с начала массива',
  total INT UNSIGNED NOT NULL,
  created_summary JSON NULL COMMENT 'Накопленный массив { objectid, request_id }',
  errors_summary JSON NULL COMMENT 'Накопленный массив ошибок по objectid',
  message TEXT NULL COMMENT 'Сообщение при failed или пояснение',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_earthday_bulk_jobs_status (status, created_at),
  KEY idx_earthday_bulk_jobs_created_by (created_by, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
