-- Добавление полей для управления сроком действия заявок (waste)
-- expires_at - дата истечения заявки (изначально created_at + 7 дней)
-- extended_count - количество продлений (максимум 1)

-- ВАЖНО: Если колонки уже существуют, будет ошибка - это нормально, просто игнорируйте её

-- Добавляем expires_at
ALTER TABLE requests 
ADD COLUMN expires_at DATETIME NULL COMMENT 'Дата истечения заявки (для waste, автоматически устанавливается при создании: created_at + 7 дней)';

-- Добавляем extended_count
ALTER TABLE requests 
ADD COLUMN extended_count INT NOT NULL DEFAULT 0 COMMENT 'Количество продлений заявки (максимум 1 для waste)';

-- Устанавливаем expires_at для существующих waste заявок со статусом new
UPDATE requests 
SET expires_at = DATE_ADD(created_at, INTERVAL 7 DAY)
WHERE category = 'wasteLocation' 
  AND status = 'new' 
  AND expires_at IS NULL;

