-- Краткое описание (подзаголовок) новости.
ALTER TABLE news
  ADD COLUMN short_description VARCHAR(500) DEFAULT NULL COMMENT 'Краткое описание / подзаголовок статьи' AFTER title;
