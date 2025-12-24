# Структура таблицы donations

**Всего колонок:** 6

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `request_id` - varchar(36) - NOT NULL
3. `user_id` - varchar(36) - NOT NULL
4. `amount` - int - NOT NULL
5. `payment_intent_id` - varchar(255) - NOT NULL
6. `created_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP

## Порядок колонок в INSERT запросе:

```sql
INSERT INTO donations (
  id, request_id, user_id, amount, payment_intent_id, created_at
) VALUES (?, ?, ?, ?, ?, NOW())
```

**Всего:** 6 колонок = 5 плейсхолдеров `?` + 1 `NOW()` для `created_at`

