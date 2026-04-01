-- Best-effort backfill для уже созданных external-заявок:
-- если photos_before пуст, но есть photos_after, копируем photos_after в photos_before.
-- Это помогает клиенту показать превью в карточке/детализации без изменений на фронте.
UPDATE requests
SET photos_before = photos_after,
    updated_at = NOW()
WHERE from_external_source = 1
  AND (
    photos_before IS NULL
    OR JSON_VALID(photos_before) = 0
    OR JSON_LENGTH(photos_before) = 0
  )
  AND photos_after IS NOT NULL
  AND JSON_VALID(photos_after) = 1
  AND JSON_LENGTH(photos_after) > 0;
