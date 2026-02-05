-- Поле для логотипа партнёра (одно изображение, URL после загрузки или внешняя ссылка).

ALTER TABLE partners
  ADD COLUMN logo_url VARCHAR(500) NULL COMMENT 'URL логотипа партнёра' AFTER photo_urls;
