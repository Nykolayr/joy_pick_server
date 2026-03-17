-- News i18n: один контент переводится на 10 языков, храним JSON по локалям.
-- Разделитель при вводе: [|||] (title[|||]short_description[|||]text).

-- 1. Добавить колонки
ALTER TABLE news
  ADD COLUMN source_lang VARCHAR(10) NOT NULL DEFAULT 'en' COMMENT 'Язык оригинала (en, ru, es, ar, zh, hi, fr, pt, he, de)' AFTER id,
  ADD COLUMN title_i18n JSON DEFAULT NULL COMMENT 'Заголовок по локалям { "en": "...", "ru": "...", ... }' AFTER source_lang,
  ADD COLUMN short_description_i18n JSON DEFAULT NULL COMMENT 'Краткое описание по локалям' AFTER title_i18n,
  ADD COLUMN text_i18n JSON DEFAULT NULL COMMENT 'Текст по локалям' AFTER short_description_i18n;

-- 2. Перенести существующие данные в i18n (ключ en)
UPDATE news SET
  title_i18n = JSON_OBJECT('en', COALESCE(title, '')),
  short_description_i18n = JSON_OBJECT('en', COALESCE(short_description, '')),
  text_i18n = JSON_OBJECT('en', COALESCE(text, ''))
WHERE title_i18n IS NULL;

-- 3. Удалить старые колонки
ALTER TABLE news
  DROP COLUMN title,
  DROP COLUMN short_description,
  DROP COLUMN text;
