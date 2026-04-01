# Структура таблицы requests

**Важно:** Этот файл содержит актуальную структуру таблицы `requests`. При изменении структуры таблицы обновляйте этот файл.

## Все колонки таблицы (44 колонки):

**ВАЖНО:** Поля `cost` и `payment_intent_id` удалены. Теперь все платежи идут через донаты.

1. `id` - varchar(36) - PRIMARY KEY
2. `user_id` - varchar(36)
3. `category` - enum('wasteLocation', 'speedCleanup', 'event')
4. `name` - varchar(255)
5. `description` - text
6. `latitude` - decimal(10,8)
7. `longitude` - decimal(11,8)
8. `city` - varchar(100)
9. `garbage_size` - int
10. `only_foot` - tinyint(1)
11. `possible_by_car` - tinyint(1)
12. `reward_amount` - decimal(10,2)
13. `is_open` - tinyint(1)
14. `start_date` - datetime
15. `end_date` - datetime
16. `status` - varchar(20)
17. `priority` - enum('low', 'medium', 'high', 'urgent')
18. `assigned_to` - varchar(36)
19. `notes` - text
20. `created_by` - varchar(36)
21. `taken_by` - varchar(36)
22. `total_contributed` - decimal(10,2)
23. `target_amount` - decimal(10,2)
24. `joined_user_id` - varchar(36)
25. `join_date` - datetime
26. `completion_comment` - text
27. `plant_tree` - tinyint(1)
28. `trash_pickup_only` - tinyint(1)
29. `from_external_source` - tinyint(1) NOT NULL DEFAULT 0 — **1** = заявка создана из внешнего источника (импорт Earth Day и т.п.)
30. `earthday_cleanup_objectid` - bigint NULL — **`earthday_cleanups.objectid`**, если заявка создана из парсинга Earth Day; при удалении заявки флаг **`used_for_internal_request`** у строки импорта сбрасывается, если нет другой заявки с тем же id
31. `created_at` - timestamp
32. `updated_at` - timestamp
33. `rejection_reason` - text
34. `rejection_message` - text
35. `actual_participants` - json
36. `photos_before` - json
37. `photos_after` - json
38. `registered_participants` - json
39. `waste_types` - json
40. `expires_at` - datetime
41. `extended_count` - int - **NOT NULL, DEFAULT 0**
42. `participant_completions` - json
43. `group_chat_id` - varchar(36)
44. `private_chats` - json

## Порядок колонок в INSERT запросе

При создании INSERT запроса ВСЕГДА используйте все 44 колонки в правильном порядке:

```sql
INSERT INTO requests (
  id, user_id, category, name, description, latitude, longitude, city,
  garbage_size, only_foot, possible_by_car, reward_amount, is_open,
  start_date, end_date, status, priority, assigned_to, notes, created_by,
  taken_by, total_contributed, target_amount, joined_user_id, join_date,
  completion_comment, plant_tree, trash_pickup_only, from_external_source, earthday_cleanup_objectid,
  created_at, updated_at, rejection_reason, rejection_message, actual_participants,
  photos_before, photos_after, registered_participants, waste_types, expires_at,
  extended_count, participant_completions, group_chat_id, private_chats
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

**Всего:** 44 колонки = 42 плейсхолдера `?` + 2 `NOW()` для `created_at` и `updated_at`

## Значения по умолчанию для новых заявок

- `is_open` - true (1)
- `from_external_source` - false (0)
- Все остальные колонки, не указанные явно - NULL (где допустимо)

## Дата обновления структуры

Последнее обновление: миграция `029_requests_earthday_cleanup_objectid.sql` — колонка `earthday_cleanup_objectid`.

## Примечание по API-ответу

В таблице нет отдельной колонки `photos`, но API `/api/requests` и `/api/requests/:id` всегда возвращает поле `photos` как массив URL (агрегировано из `photos_before` + `photos_after`, либо `[]`).
