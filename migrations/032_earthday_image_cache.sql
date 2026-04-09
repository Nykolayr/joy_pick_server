-- Кэш локальных картинок для Earth Day батч-создания заявок.
-- Матч: по стране + нормализованный location_hint (region_key).

CREATE TABLE IF NOT EXISTS earthday_image_cache (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  image_url TEXT NOT NULL COMMENT 'Только локальный URL из request_creation_gallery (/uploads/...)',
  country VARCHAR(128) NOT NULL,
  location_hint TEXT DEFAULT NULL,
  region_key VARCHAR(255) NOT NULL COMMENT 'Нормализованный ключ местности для грубого матча',
  use_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_earthday_image_cache_url_country_region (image_url(255), country, region_key),
  KEY idx_earthday_image_cache_lookup (country, region_key),
  KEY idx_earthday_image_cache_last_used (last_used_at),
  KEY idx_earthday_image_cache_use_count (use_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
