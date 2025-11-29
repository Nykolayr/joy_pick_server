-- Миграция: Добавление новых полей в таблицу requests
-- Дата: 2025-01-28
-- Описание: Добавляет поля rejection_reason, rejection_message, actual_participants для новой концепции заявок

-- Добавление поля rejection_reason (причина отклонения)
ALTER TABLE requests 
ADD COLUMN rejection_reason TEXT NULL 
COMMENT 'Причина отклонения заявки (стандартное или кастомное сообщение)';

-- Добавление поля rejection_message (кастомное сообщение от модератора)
ALTER TABLE requests 
ADD COLUMN rejection_message TEXT NULL 
COMMENT 'Кастомное сообщение от модератора при отклонении';

-- Добавление поля actual_participants (реальные участники события)
ALTER TABLE requests 
ADD COLUMN actual_participants JSON NULL 
COMMENT 'Массив ID реальных участников события (только для event)';

-- Индексы для оптимизации запросов
CREATE INDEX idx_requests_status_category ON requests(status, category);
CREATE INDEX idx_requests_join_date ON requests(join_date);
CREATE INDEX idx_requests_start_date ON requests(start_date);
CREATE INDEX idx_requests_created_at_status ON requests(created_at, status);

