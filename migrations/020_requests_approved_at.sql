-- Момент одобрения заявки (для выплат: «донаты после одобрения» при переводе в архив)
ALTER TABLE requests ADD COLUMN approved_at DATETIME DEFAULT NULL COMMENT 'Когда статус установлен в approved (для speed/event: донаты после этой даты выплачиваются перед архивом)' AFTER updated_at;
