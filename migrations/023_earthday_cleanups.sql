-- Заявки с карты Earth Day (The Great Global Cleanup), синхронизация из ArcGIS по запросу суперадмина.

CREATE TABLE IF NOT EXISTS earthday_cleanups (
  objectid BIGINT NOT NULL PRIMARY KEY COMMENT 'ArcGIS FeatureServer objectid',
  globalid VARCHAR(64) NOT NULL COMMENT 'ArcGIS globalid (UUID)',
  first_name_ VARCHAR(255) DEFAULT NULL,
  last_name_ VARCHAR(255) DEFAULT NULL,
  email_address_ VARCHAR(255) DEFAULT NULL,
  phone_number_pub VARCHAR(64) DEFAULT NULL,
  cleanup_date BIGINT NOT NULL COMMENT 'Epoch ms (как в ArcGIS)',
  start_time VARCHAR(32) NOT NULL COMMENT 'Время начала; пустые не импортируются',
  who_is_holding_the_cleanup VARCHAR(512) DEFAULT NULL,
  name_of_the_cleanup_event VARCHAR(512) DEFAULT NULL,
  name_of_cleanup_location VARCHAR(512) DEFAULT NULL,
  cleanup_event_location VARCHAR(255) DEFAULT NULL,
  how_should_volunteers_register VARCHAR(128) DEFAULT NULL,
  GeoCodedAddress TEXT DEFAULT NULL,
  lat DOUBLE DEFAULT NULL,
  lng DOUBLE DEFAULT NULL,
  used_for_internal_request TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = запись уже использована для создания заявки Joy Pick',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_earthday_cleanups_globalid (globalid),
  KEY idx_earthday_cleanups_cleanup_date (cleanup_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
