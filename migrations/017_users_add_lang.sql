-- Язык интерфейса, выбранный пользователем на фронте (например en, ru).

ALTER TABLE users
  ADD COLUMN lang VARCHAR(10) DEFAULT NULL COMMENT 'Language code from frontend (e.g. en, ru)';
