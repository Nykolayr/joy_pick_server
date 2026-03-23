# Структура таблицы `earthday_cleanups`

**Назначение:** кэш заявок с карты Earth Day (ArcGIS / The Great Global Cleanup), подтягивается суперадмином через **`POST /api/earthday-cleanups-admin/sync`**. Данные используются для подготовки заявок Joy Pick.

**Миграции:** `023_earthday_cleanups.sql`, `024_earthday_cleanups_used_flag.sql` (поле `used_for_internal_request`, если таблица создана до неё), `026_earthday_cleanups_continent_country.sql` (поля `continent`, `country`, `location_hint`, если таблица создана до неё).

## Колонки

| Колонка | Тип | Nullable | Описание |
|---------|-----|----------|----------|
| `objectid` | BIGINT | NO | PK, ArcGIS FeatureServer `objectid` |
| `globalid` | VARCHAR(64) | NO | UUID из ArcGIS, UNIQUE |
| `first_name_` | VARCHAR(255) | YES | Имя |
| `last_name_` | VARCHAR(255) | YES | Фамилия |
| `email_address_` | VARCHAR(255) | YES | Email |
| `phone_number_pub` | VARCHAR(64) | YES | Телефон (публичный) |
| `cleanup_date` | BIGINT | NO | Дата события, epoch ms (как в ArcGIS) |
| `start_time` | VARCHAR(32) | NO | Время начала; записи без времени не импортируются |
| `who_is_holding_the_cleanup` | VARCHAR(512) | YES | Организатор |
| `name_of_the_cleanup_event` | VARCHAR(512) | YES | Название события |
| `name_of_cleanup_location` | VARCHAR(512) | YES | Название локации |
| `cleanup_event_location` | VARCHAR(255) | YES | Тип/описание локации |
| `how_should_volunteers_register` | VARCHAR(128) | YES | Как регистрироваться |
| `GeoCodedAddress` | TEXT | YES | Геокодированный адрес |
| `lat` | DOUBLE | YES | Широта WGS84 |
| `lng` | DOUBLE | YES | Долгота WGS84 |
| `continent` | VARCHAR(64) | YES | Континент **на английском**, вычисляется при синке по правилам lat/lng (без внешних геокодеров); см. `api/utils/geoContinentCountry.js` |
| `country` | VARCHAR(128) | YES | Страна **на английском** по первому попавшемуся bbox или **NULL** (приближение для UI/фильтров) |
| `location_hint` | TEXT | YES | Человекочитаемая строка: `continent · approx: country` (если `country` задан) + при непустом `GeoCodedAddress` — ` · ` + адрес |
| `used_for_internal_request` | TINYINT(1) | NO | **0** — ещё не использовали для создания заявки Joy Pick; **1** — уже использовали (повторно не брать). При повторном синке из ArcGIS значение **не сбрасывается**. |
| `created_at` | TIMESTAMP | NO | Создание строки |
| `updated_at` | TIMESTAMP | NO | Обновление строки |

## Связанные API

- Список с пагинацией и фильтром по дате: **`GET /api/earthday-cleanups-admin`** (query: `page`, `limit`, `cleanup_date_from`, `cleanup_date_to`, опционально **`exclude_used=true`**, опционально **`continent`**, **`country`** — точное совпадение с БД, **`sort_by`**, **`sort_dir`**).
- Синхронизация: **`POST /api/earthday-cleanups-admin/sync`** (суперадмин).
- Обновление флага «использовано для нашей заявки»: **`PATCH /api/earthday-cleanups-admin/:objectid`** с телом `{ "used_for_internal_request": true }` или `false` (также допускаются `0`/`1`).

При создании заявки Joy Pick из строки импорта: **`POST /api/requests`** с **`from_external_source`: `true`** (JWT **суперадмина**), затем **`PATCH`** по `objectid` этой строки с **`used_for_internal_request`: `true`**.

Подробности ответов и коды ошибок парсинга — в **`API_DOCUMENTATION.md`**, раздел Earth Day cleanups.
