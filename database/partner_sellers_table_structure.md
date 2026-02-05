# Структура таблицы partner_sellers

**Миграция:** 012_partner_sellers.sql

Продавцы партнёра. Вход в приложение по логину и паролю. Логин уникален в рамках одного партнёра (один и тот же login может быть у продавцов разных партнёров).

**Всего колонок:** 9

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `partner_id` - varchar(36) - NOT NULL, FK → partners.id
3. `full_name` - varchar(255) - NOT NULL - ФИО
4. `login` - varchar(255) - NOT NULL - Логин для входа в приложение
5. `password_hash` - varchar(255) - NOT NULL - bcrypt хеш пароля
6. `job_title` - varchar(255) - NULL - Должность
7. `created_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP
8. `updated_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

## Уникальность

- **UNIQUE (partner_id, login)** — один логин на партнёра; в разных партнёрах логины могут совпадать.

## Индексы

- `idx_partner_sellers_partner_id` — по partner_id
- FK `fk_partner_sellers_partner` → partners(id) ON DELETE CASCADE

## Порядок колонок в INSERT:

```sql
INSERT INTO partner_sellers (
  id, partner_id, full_name, login, password_hash, job_title,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
```
