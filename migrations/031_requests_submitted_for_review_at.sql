-- Момент отправки заявки на модерацию (status = pending) — для SLA 7+1 суток в кроне
ALTER TABLE requests
  ADD COLUMN submitted_for_review_at DATETIME NULL DEFAULT NULL
  COMMENT 'Первая установка при переходе заявки на модерацию (pending)'
  AFTER approved_at;

-- Старые pending: приближённо считаем, что модерация началась с последнего updated_at
UPDATE requests
SET submitted_for_review_at = updated_at
WHERE status = 'pending' AND submitted_for_review_at IS NULL;
