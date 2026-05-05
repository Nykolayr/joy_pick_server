-- Старт окна донатов (7 дней) — момент первой сдачи работы пользователем (отправка на модерацию).
-- Не очищается при approve модератором (в отличие от submitted_for_review_at).
ALTER TABLE requests
  ADD COLUMN donation_window_started_at DATETIME NULL DEFAULT NULL
    COMMENT 'Первая сдача работы пользователем; отсчёт 7 дн для донатов и выплат'
  AFTER submitted_for_review_at;

UPDATE requests
SET donation_window_started_at = submitted_for_review_at
WHERE submitted_for_review_at IS NOT NULL AND donation_window_started_at IS NULL;
