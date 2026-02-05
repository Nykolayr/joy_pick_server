# Структура таблицы partner_branches

**Миграция:** 011_partner_branches.sql

Филиалы партнёра (кафе, магазин и т.д.). Продавец при списании коинов выбирает филиал, в котором работает.

**Всего колонок:** 8

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `partner_id` - varchar(36) - NOT NULL, FK → partners.id
3. `name` - varchar(255) - NOT NULL - Название филиала (напр. «Кафе Луна»)
4. `address` - text - NULL - Адрес
5. `latitude` - decimal(10,8) - NULL - Широта
6. `longitude` - decimal(11,8) - NULL - Долгота
7. `created_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP
8. `updated_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

## Индексы

- `idx_partner_branches_partner_id` — по partner_id
- FK `fk_partner_branches_partner` → partners(id) ON DELETE CASCADE

## Порядок колонок в INSERT:

```sql
INSERT INTO partner_branches (
  id, partner_id, name, address, latitude, longitude,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
```

## Пример

```sql
INSERT INTO partner_branches (id, partner_id, name, address, latitude, longitude, created_at, updated_at)
VALUES (
  '550e8400-e29b-41d4-a716-446655440001',
  '550e8400-e29b-41d4-a716-446655440000',
  'Кафе Луна',
  'г. Томск, ул. Ленина, д. 1',
  56.4962847,
  84.9802779,
  NOW(),
  NOW()
);
```
