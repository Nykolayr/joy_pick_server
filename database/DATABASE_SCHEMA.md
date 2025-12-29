# Структура базы данных

**Важно:** Этот файл содержит актуальную структуру всех таблиц базы данных. При изменении структуры таблиц обновляйте соответствующие разделы.

## Список всех таблиц (13 таблиц)

1. `users` - Пользователи (27 колонок) - [users_table_structure.md](users_table_structure.md)
2. `requests` - Заявки (44 колонки) - [requests_table_structure.md](requests_table_structure.md)
3. `chats` - Чаты (8 колонок) - [chats_table_structure.md](chats_table_structure.md)
4. `messages` - Сообщения в чатах (10 колонок) - [messages_table_structure.md](messages_table_structure.md)
5. `chat_participants` - Участники чатов (5 колонок) - [chat_participants_table_structure.md](chat_participants_table_structure.md)
6. `donations` - Донаты (6 колонок) - [donations_table_structure.md](donations_table_structure.md)
7. `partners` - Партнеры (10 колонок) - [partners_table_structure.md](partners_table_structure.md)
8. `recycling_stations` - Станции переработки (11 колонок) - [recycling_stations_table_structure.md](recycling_stations_table_structure.md)
9. `user_completed_requests` - Завершенные заявки (5 колонок) - TODO
10. `waste_types` - Типы отходов (5 колонок) - TODO
11. `email_verifications` - Верификация email (16 колонок) - TODO
12. `push_notifications` - Push уведомления (8 колонок) - TODO
13. `cron_actions` - Действия cron (8 колонок) - TODO

## Удаленные таблицы (помечены на удаление)

- ❌ `members` - Участники событий (не используется, участники хранятся в `requests.registered_participants`)
- ❌ `partner_photos` - Фотографии партнеров (не используется, фотографии хранятся в `partners.photo_urls`)
- ❌ `partner_types` - Типы партнеров (не используется)

## Документация по таблицам

Детальная документация по каждой таблице находится в отдельных файлах:
- ✅ `requests_table_structure.md` - структура таблицы requests
- ✅ `users_table_structure.md` - структура таблицы users
- ✅ `chats_table_structure.md` - структура таблицы chats
- ✅ `messages_table_structure.md` - структура таблицы messages
- ✅ `chat_participants_table_structure.md` - структура таблицы chat_participants
- ✅ `donations_table_structure.md` - структура таблицы donations
- ✅ `partners_table_structure.md` - структура таблицы partners
- ✅ `recycling_stations_table_structure.md` - структура таблицы recycling_stations
- ⏳ Остальные таблицы - TODO

## Как обновить документацию

1. Выполните SQL запрос из `get_all_tables_structure.sql`
2. Обновите соответствующий файл структуры таблицы
3. Обновите этот файл, если добавились новые таблицы

## Дата последнего обновления

2025-12-24 - Создана полная структура документации для основных таблиц
2025-12-24 - Упрощена таблица partners, создана таблица recycling_stations, удалены неиспользуемые таблицы (members, partner_photos, partner_types)
