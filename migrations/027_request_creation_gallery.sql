CREATE TABLE IF NOT EXISTS request_creation_gallery (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  image_url TEXT NOT NULL,
  uploaded_by VARCHAR(36) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_request_creation_gallery_created_at (created_at),
  KEY idx_request_creation_gallery_uploaded_by (uploaded_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
