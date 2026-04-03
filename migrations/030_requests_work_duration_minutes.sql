-- Длительность работы в минутах (клиент): speedCleanup — на заявке; event/waste — в participant_completions.
ALTER TABLE requests
  ADD COLUMN work_duration_minutes INT UNSIGNED NULL DEFAULT NULL
  COMMENT 'speedCleanup: минуты с клиента (таймер start–end)'
  AFTER earthday_cleanup_objectid;
