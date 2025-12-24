# Структура таблицы messages

**Всего колонок:** 10

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `chat_id` - varchar(36) - NOT NULL
3. `sender_id` - varchar(36) - NOT NULL
4. `message` - text - NOT NULL
5. `message_type` - enum('text','image','file') - NOT NULL, DEFAULT 'text'
6. `created_at` - datetime - NOT NULL, DEFAULT CURRENT_TIMESTAMP
7. `updated_at` - datetime - NULL, ON UPDATE CURRENT_TIMESTAMP
8. `deleted_at` - datetime - NULL
9. `read_by` - json - NULL
10. `unread_by` - json - NULL

## Порядок колонок в INSERT запросе:

```sql
INSERT INTO messages (
  id, chat_id, sender_id, message, message_type, created_at, read_by, unread_by
) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)
```

**Всего:** 10 колонок = 6 плейсхолдеров `?` + 1 `NOW()` для `created_at`

