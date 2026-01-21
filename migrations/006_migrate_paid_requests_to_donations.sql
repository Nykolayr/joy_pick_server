-- ============================================================================
-- МИГРАЦИЯ: От платных заявок к донатам
-- ============================================================================
-- Дата: 2025-01-XX
-- Описание: Убираем понятие "платная заявка". Платеж создателя = донат от создателя.
--           Все платежи идут через таблицу donations.
-- ============================================================================

-- ШАГ 1: Миграция существующих платных заявок в донаты
-- Находим все заявки с payment_intent_id и cost > 0
-- Создаем донаты от создателя для этих заявок

INSERT INTO donations (id, request_id, user_id, amount, payment_intent_id, created_at)
SELECT 
    UUID() as id,
    r.id as request_id,
    r.created_by as user_id,
    r.cost as amount,
    r.payment_intent_id,
    r.created_at
FROM requests r
WHERE r.payment_intent_id IS NOT NULL 
  AND r.cost > 0
  AND r.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM donations d 
    WHERE d.request_id = r.id 
      AND d.user_id = r.created_by
      AND d.payment_intent_id = r.payment_intent_id
  );

-- ШАГ 2: Обновление статусов заявок с pending_payment на стандартные
UPDATE requests 
SET status = CASE 
    WHEN category = 'event' THEN 'inProgress'
    WHEN category IN ('wasteLocation', 'speedCleanup') THEN 'new'
    ELSE 'new'
END
WHERE status = 'pending_payment';

-- ШАГ 3: Обновление типов PaymentIntent с request_payment на donation
UPDATE payment_intents
SET type = 'donation'
WHERE type = 'request_payment';

-- ШАГ 4: Обновление total_contributed для всех заявок (сумма всех донатов)
UPDATE requests r
SET total_contributed = (
    SELECT COALESCE(SUM(d.amount), 0)
    FROM donations d
    WHERE d.request_id = r.id
);

-- ШАГ 5: Удаление полей cost и payment_intent_id из таблицы requests
-- ВНИМАНИЕ: Это удалит колонки из таблицы. Убедитесь, что миграция данных завершена!

ALTER TABLE requests 
DROP COLUMN cost,
DROP COLUMN payment_intent_id;

-- ============================================================================
-- ПРОВЕРКА ПОСЛЕ МИГРАЦИИ:
-- ============================================================================
-- 1. Проверить, что донаты созданы для всех мигрированных заявок:
--    SELECT COUNT(*) FROM donations WHERE created_at = (SELECT created_at FROM requests WHERE id = donations.request_id);
--
-- 2. Проверить, что статусы обновлены:
--    SELECT COUNT(*) FROM requests WHERE status = 'pending_payment'; -- должно быть 0
--
-- 3. Проверить, что типы PaymentIntent обновлены:
--    SELECT COUNT(*) FROM payment_intents WHERE type = 'request_payment'; -- должно быть 0
--
-- 4. Проверить, что поля удалены из таблицы:
--    DESCRIBE requests; -- не должно быть полей cost и payment_intent_id
-- ============================================================================
