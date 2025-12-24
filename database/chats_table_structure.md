# Структура таблицы chats

**Всего колонок:** 8

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `type` - enum('support','private','group') - NOT NULL
3. `request_id` - varchar(36) - NULL
4. `user_id` - varchar(36) - NULL
5. `created_by` - varchar(36) - NULL
6. `created_at` - datetime - NOT NULL, DEFAULT CURRENT_TIMESTAMP
7. `updated_at` - datetime - NULL, ON UPDATE CURRENT_TIMESTAMP
8. `last_message_at` - datetime - NULL

## Порядок колонок в INSERT запросе:

```sql
INSERT INTO chats (
  id, type, request_id, user_id, created_by, created_at, last_message_at
) VALUES (?, ?, ?, ?, ?, NOW(), NOW())
```

**Всего:** 8 колонок = 5 плейсхолдеров `?` + 2 `NOW()` для `created_at` и `last_message_at` (или можно использовать `NOW()` для обоих)

