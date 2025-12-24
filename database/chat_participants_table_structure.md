# Структура таблицы chat_participants

**Всего колонок:** 5

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `chat_id` - varchar(36) - NOT NULL
3. `user_id` - varchar(36) - NOT NULL
4. `joined_at` - datetime - NOT NULL, DEFAULT CURRENT_TIMESTAMP
5. `last_read_at` - datetime - NULL

## Порядок колонок в INSERT запросе:

```sql
INSERT INTO chat_participants (
  id, chat_id, user_id, joined_at, last_read_at
) VALUES (?, ?, ?, NOW(), ?)
```

**Всего:** 5 колонок = 4 плейсхолдера `?` + 1 `NOW()` для `joined_at`

