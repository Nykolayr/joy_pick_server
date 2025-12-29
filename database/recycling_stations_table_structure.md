# Структура таблицы recycling_stations

**Всего колонок:** 11

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `name` - varchar(255) - NOT NULL - Название станции переработки
3. `photo_urls` - json - NULL - Массив URL фотографий станции
4. `latitude` - decimal(10,8) - NULL - Широта
5. `longitude` - decimal(11,8) - NULL - Долгота
6. `address` - text - NULL - Адрес станции
7. `activity` - text - NULL - Деятельность/описание станции
8. `website_url` - varchar(500) - NULL - URL сайта станции
9. `accepted_waste_types` - json - NULL - Массив типов мусора, которые можно переработать (как в requests.waste_types)
10. `created_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP
11. `updated_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

## Порядок колонок в INSERT запросе:

```sql
INSERT INTO recycling_stations (
  id, name, photo_urls, latitude, longitude, address, activity, website_url,
  accepted_waste_types, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
```

**Всего:** 11 колонок = 9 плейсхолдеров `?` + 2 `NOW()` для `created_at` и `updated_at`

## Формат JSON полей:

### `photo_urls`
Массив строк с URL фотографий:
```json
["http://example.com/photo1.jpg", "http://example.com/photo2.jpg"]
```

### `accepted_waste_types`
Массив объектов с типами мусора (как в `requests.waste_types`):
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Пластик",
    "danger": false
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Стекло",
    "danger": false
  }
]
```

## Индексы:

- `idx_recycling_stations_location` - индекс на (latitude, longitude) для быстрого поиска по местоположению
- `idx_recycling_stations_name` - индекс на name для быстрого поиска по названию

## Пример использования:

```sql
INSERT INTO recycling_stations (
  id, name, photo_urls, latitude, longitude, address, activity, website_url,
  accepted_waste_types, created_at, updated_at
) VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'Станция переработки "ЭкоТомск"',
  '["http://example.com/photo1.jpg"]',
  56.4962847,
  84.9802779,
  'г. Томск, ул. Экологическая, д. 10',
  'Прием и переработка пластика, стекла, бумаги',
  'https://ecotomsk.ru',
  '[{"id":"550e8400-e29b-41d4-a716-446655440000","name":"Пластик","danger":false},{"id":"550e8400-e29b-41d4-a716-446655440001","name":"Стекло","danger":false}]',
  NOW(),
  NOW()
);
```

