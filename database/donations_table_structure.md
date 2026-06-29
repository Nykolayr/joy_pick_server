# Структура таблицы `donations`

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | VARCHAR | UUID |
| `request_id` | VARCHAR | Заявка |
| `user_id` | VARCHAR | Донатер |
| `amount` | DECIMAL | Сумма в USD |
| `payment_intent_id` | VARCHAR | Stripe PI (rail A) |
| `provider` | VARCHAR | `stripe` \| `manual` \| `crypto` \| `psp` (default `stripe`) |
| `rail_code` | VARCHAR(2) | `A` \| `E` \| `D` \| `B` (default `A`) |
| `created_at` | DATETIME | |

Миграция: `migrations/047_donation_rails_phase0.sql`
