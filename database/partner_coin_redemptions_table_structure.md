# Структура таблицы partner_coin_redemptions

**Миграция:** 013_partner_coin_redemptions.sql

Списание коинов волонтёра у партнёра в обмен на скидку. Одна запись = одна транзакция. История для партнёра — выборка по partner_id, для волонтёра — по user_id.

**Всего колонок:** 10

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `partner_id` - varchar(36) - NOT NULL, FK → partners.id
3. `branch_id` - varchar(36) - NOT NULL, FK → partner_branches.id - Филиал, где произошло списание
4. `seller_id` - varchar(36) - NOT NULL, FK → partner_sellers.id - Продавец, который провёл списание
5. `user_id` - varchar(36) - NOT NULL, FK → users.id - Волонтёр (у кого списали коины)
6. `coins_spent` - int - NOT NULL - Сколько коинов списано
7. `amount_cents` - int - NOT NULL - Сумма скидки в центах (по курсу партнёра на момент списания)
8. `currency` - varchar(10) - NOT NULL, DEFAULT 'USD' - Валюта
9. `created_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP - Дата/время списания

## Связи

- partner_id → partners(id) ON DELETE CASCADE
- branch_id → partner_branches(id) ON DELETE CASCADE
- seller_id → partner_sellers(id) ON DELETE CASCADE
- user_id → users(id) ON DELETE CASCADE

## Индексы

- `idx_redemptions_partner_id` — история у партнёра
- `idx_redemptions_user_id` — история у волонтёра
- `idx_redemptions_created_at` — сортировка по дате

## Порядок колонок в INSERT:

```sql
INSERT INTO partner_coin_redemptions (
  id, partner_id, branch_id, seller_id, user_id,
  coins_spent, amount_cents, currency, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
```

## Пример

Волонтёр списал 4 коина при курсе 50 центов за коин → скидка 200 центов = 2 USD.

```sql
INSERT INTO partner_coin_redemptions (
  id, partner_id, branch_id, seller_id, user_id,
  coins_spent, amount_cents, currency, created_at
) VALUES (
  '550e8400-e29b-41d4-a716-446655440010',
  '550e8400-e29b-41d4-a716-446655440000',
  '550e8400-e29b-41d4-a716-446655440001',
  '550e8400-e29b-41d4-a716-446655440002',
  '353f958d-8796-44c7-a877-3e376eca6784',
  4,
  200,
  'USD',
  NOW()
);
```
