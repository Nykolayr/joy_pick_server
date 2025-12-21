-- Миграция: Добавление поля participant_completions в таблицу requests
-- Дата: 2025-12-16
-- Описание: Добавляет поле participant_completions для хранения данных о закрытии работы участниками

ALTER TABLE requests 
ADD COLUMN participant_completions JSON NULL 
COMMENT 'JSON объект с данными закрытия работы участниками. Ключ - userId, значение - объект с полями: status, photos_after, completion_comment, completion_latitude, completion_longitude, rejection_reason, completed_at';

-- Индекс не нужен, так как это JSON поле и поиск будет через JSON функции MySQL

