# Структура таблицы partners

**Всего колонок:** 10

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `name` - varchar(255) - NOT NULL - Название партнера
3. `photo_urls` - json - NULL - Массив URL фотографий партнера
4. `latitude` - decimal(10,8) - NULL - Широта
5. `longitude` - decimal(11,8) - NULL - Долгота
6. `address` - text - NULL - Адрес партнера
7. `activity` - text - NULL - Деятельность партнера
8. `website_url` - varchar(500) - NULL - URL сайта партнера
9. `created_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP
10. `updated_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

## Порядок колонок в INSERT запросе:

```sql
INSERT INTO partners (
  id, name, photo_urls, latitude, longitude, address, activity, website_url,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
```

**Всего:** 10 колонок = 8 плейсхолдеров `?` + 2 `NOW()` для `created_at` и `updated_at`

## Формат JSON полей:

### `photo_urls`
Массив строк с URL фотографий:
```json
["http://example.com/photo1.jpg", "http://example.com/photo2.jpg"]
```

## Пример использования:

```sql
INSERT INTO partners (
  id, name, photo_urls, latitude, longitude, address, activity, website_url,
  created_at, updated_at
) VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'ЭкоПартнер',
  '["http://example.com/photo1.jpg", "http://example.com/photo2.jpg"]',
  56.4962847,
  84.9802779,
  'г. Томск, ул. Ленина, д. 1',
  'Переработка пластика',
  'https://ecopartner.ru',
  NOW(),
  NOW()
);
```

