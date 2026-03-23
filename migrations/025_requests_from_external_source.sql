-- Заявки, созданные из внешних источников (например импорт Earth Day cleanups).

ALTER TABLE requests
  ADD COLUMN from_external_source TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = заявка создана из внешнего источника (импорт карты и т.п.)'
    AFTER trash_pickup_only;
