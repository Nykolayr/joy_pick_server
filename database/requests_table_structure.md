# Структура таблицы requests

**Важно:** Этот файл содержит актуальную структуру таблицы `requests`. При изменении структуры таблицы обновляйте этот файл.

## Все колонки таблицы (44 колонки):

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
12. `cost` - int
13. `reward_amount` - int
14. `is_open` - tinyint(1)
15. `start_date` - datetime
16. `end_date` - datetime
17. `status` - varchar(20)
18. `priority` - enum('low', 'medium', 'high', 'urgent')
19. `assigned_to` - varchar(36)
20. `notes` - text
21. `created_by` - varchar(36)
22. `taken_by` - varchar(36)
23. `total_contributed` - int
24. `target_amount` - int
25. `joined_user_id` - varchar(36)
26. `join_date` - datetime
27. `payment_intent_id` - varchar(255)
28. `completion_comment` - text
29. `plant_tree` - tinyint(1)
30. `trash_pickup_only` - tinyint(1)
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

При создании INSERT запроса ВСЕГДА используйте ВСЕ 44 колонки в правильном порядке:

```sql
INSERT INTO requests (
  id, user_id, category, name, description, latitude, longitude, city,
  garbage_size, only_foot, possible_by_car, cost, reward_amount, is_open,
  start_date, end_date, status, priority, assigned_to, notes, created_by,
  taken_by, total_contributed, target_amount, joined_user_id, join_date,
  payment_intent_id, completion_comment, plant_tree, trash_pickup_only,
  created_at, updated_at, rejection_reason, rejection_message, actual_participants,
  photos_before, photos_after, registered_participants, waste_types, expires_at,
  extended_count, participant_completions, group_chat_id, private_chats
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

**Всего:** 44 колонки = 42 плейсхолдера `?` + 2 `NOW()` для `created_at` и `updated_at`

## Значения по умолчанию для новых заявок

- `is_open` - true (1)
- Все остальные колонки, не указанные явно - NULL

## Дата обновления структуры

Последнее обновление: 2025-12-24 (добавлены `group_chat_id` и `private_chats`)

