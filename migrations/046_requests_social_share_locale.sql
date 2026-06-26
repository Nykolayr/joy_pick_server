ALTER TABLE requests
  ADD COLUMN social_share_locale VARCHAR(8) NULL DEFAULT NULL AFTER social_share_og_image_url;
