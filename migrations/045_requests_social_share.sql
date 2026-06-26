-- Публичная share-страница для соцсетей (OG + HTML)
ALTER TABLE requests
  ADD COLUMN social_share_url VARCHAR(512) NULL DEFAULT NULL AFTER private_chats,
  ADD COLUMN social_share_created_at DATETIME NULL DEFAULT NULL AFTER social_share_url,
  ADD COLUMN social_share_og_image_url VARCHAR(512) NULL DEFAULT NULL AFTER social_share_created_at;
