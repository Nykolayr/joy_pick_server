-- Связь заявки со строкой earthday_cleanups (objectid ArcGIS), чтобы при удалении заявки снова показывать парсинг.

ALTER TABLE requests
  ADD COLUMN earthday_cleanup_objectid BIGINT NULL DEFAULT NULL
    COMMENT 'earthday_cleanups.objectid, если заявка создана из импорта Earth Day'
    AFTER from_external_source;

CREATE INDEX idx_requests_earthday_cleanup_objectid ON requests (earthday_cleanup_objectid);
