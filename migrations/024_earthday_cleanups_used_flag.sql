-- Флаг: запись Earth Day уже использована для создания нашей заявки (миграция для БД, где уже применён 023 без этого поля).

ALTER TABLE earthday_cleanups
  ADD COLUMN used_for_internal_request TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = запись уже использована для создания заявки Joy Pick'
    AFTER lng;
