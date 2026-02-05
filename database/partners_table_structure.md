# Структура таблицы partners

**Всего колонок:** 12 (после миграций 010, 015, 016)

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `name` - varchar(255) - NOT NULL - Название партнера
3. `logo_url` - varchar(500) - NULL - URL логотипа партнёра (миграция 015)
4. `photo_urls` - json - NULL - Массив URL фотографий партнера
5. `activity` - text - NULL - Деятельность партнера
6. `website_url` - varchar(500) - NULL - URL сайта партнера
7. `created_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP
8. `updated_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
9. **`admin_email`** - varchar(255) - NULL - Логин админа партнёра для входа в админку (email)
10. **`admin_password_hash`** - varchar(255) - NULL - bcrypt хеш пароля админа партнёра
11. **`currency`** - varchar(10) - NOT NULL, DEFAULT 'USD' - Валюта скидки (USD, RUB и т.д.)
12. **`exchange_rate_cents_per_coin`** - int - NOT NULL, DEFAULT 50 - Скидка в центах за 1 коин (50 = 0.50 USD)

**Примечание (миграция 016):** Поля `address`, `latitude`, `longitude` у партнёра удалены. Адрес и координаты хранятся только в филиалах (`partner_branches`).

## Новые поля (миграция 010)

- **admin_email** — при создании партнёра задаётся email, им админ партнёра входит в админку.
- **admin_password_hash** — пароль генерируется на фронте при создании партнёра (или задаётся), хранится в виде bcrypt-хеша. Можно менять в кабинете партнёра.
- **currency** — валюта, в которой считается скидка за коины.
- **exchange_rate_cents_per_coin** — курс: 1 коин = N центов скидки. Пример: 50 → волонтёр списывает 4 коина → скидка 2 USD.

## Порядок колонок в INSERT запросе (после миграций 015, 016):

```sql
INSERT INTO partners (
  id, name, logo_url, photo_urls, activity, website_url,
  created_at, updated_at,
  admin_email, admin_password_hash, currency, exchange_rate_cents_per_coin
) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?)
```

## Формат JSON полей:

### `photo_urls`
Массив строк с URL фотографий:
```json
["http://example.com/photo1.jpg", "http://example.com/photo2.jpg"]
```

## Связанные таблицы

- [partner_branches](partner_branches_table_structure.md) — филиалы партнёра
- [partner_sellers](partner_sellers_table_structure.md) — продавцы партнёра
- [partner_coin_redemptions](partner_coin_redemptions_table_structure.md) — списания коинов у волонтёров
