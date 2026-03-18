-- Типы статей: simple (массив фото) и from_request (привязка к заявке).
-- simple: image_urls JSON (массив URL). from_request: request_id, без картинок в статье.

-- 1. Добавить колонки
ALTER TABLE news
  ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'simple' COMMENT 'simple | from_request' AFTER source_lang,
  ADD COLUMN image_urls JSON DEFAULT NULL COMMENT 'Массив URL фото (только для type=simple)' AFTER text_i18n,
  ADD COLUMN request_id VARCHAR(36) DEFAULT NULL COMMENT 'ID заявки (только для type=from_request)' AFTER image_urls;

-- 2. Перенести image_url в image_urls (один элемент массива), затем удалить image_url
UPDATE news
SET image_urls = CASE
  WHEN image_url IS NOT NULL AND TRIM(image_url) != '' THEN JSON_ARRAY(image_url)
  ELSE JSON_ARRAY()
END
WHERE image_urls IS NULL;

ALTER TABLE news DROP COLUMN image_url;

-- 3. Индекс для проверки заявок при выдаче
ALTER TABLE news
  ADD INDEX idx_news_request_id (request_id),
  ADD INDEX idx_news_type (type);

-- Опционально: FK на requests (если таблица requests существует и id совпадает по типу)
-- ALTER TABLE news ADD CONSTRAINT fk_news_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE SET NULL;
