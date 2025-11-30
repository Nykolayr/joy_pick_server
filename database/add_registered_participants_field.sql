-- Миграция: Добавление поля registered_participants для event
-- Дата: 2025-01-28
-- Описание: Добавляет поле registered_participants для хранения всех зарегистрированных участников event до закрытия события

ALTER TABLE requests 
ADD COLUMN registered_participants JSON NULL 
COMMENT 'Массив ID всех зарегистрированных участников события (только для event, до закрытия)';

