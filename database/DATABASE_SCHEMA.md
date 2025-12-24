# Структура базы данных

**Важно:** Этот файл содержит актуальную структуру всех таблиц базы данных. При изменении структуры таблиц обновляйте соответствующие разделы.

## Список всех таблиц (15 таблиц)

1. `users` - Пользователи (27 колонок) - [users_table_structure.md](users_table_structure.md)
2. `requests` - Заявки (44 колонки) - [requests_table_structure.md](requests_table_structure.md)
3. `chats` - Чаты (8 колонок) - [chats_table_structure.md](chats_table_structure.md)
4. `messages` - Сообщения в чатах (10 колонок) - [messages_table_structure.md](messages_table_structure.md)
5. `chat_participants` - Участники чатов (5 колонок) - [chat_participants_table_structure.md](chat_participants_table_structure.md)
6. `donations` - Донаты (6 колонок) - [donations_table_structure.md](donations_table_structure.md)
7. `members` - Участники событий (7 колонок) - TODO
8. `partners` - Партнеры (9 колонок) - TODO
9. `partner_photos` - Фотографии партнеров (4 колонки) - TODO
10. `partner_types` - Типы партнеров (4 колонки) - TODO
11. `user_completed_requests` - Завершенные заявки (5 колонок) - TODO
12. `waste_types` - Типы отходов (5 колонок) - TODO
13. `email_verifications` - Верификация email (16 колонок) - TODO
14. `push_notifications` - Push уведомления (8 колонок) - TODO
15. `cron_actions` - Действия cron (8 колонок) - TODO

## Документация по таблицам

Детальная документация по каждой таблице находится в отдельных файлах:
- ✅ `requests_table_structure.md` - структура таблицы requests
- ✅ `users_table_structure.md` - структура таблицы users
- ✅ `chats_table_structure.md` - структура таблицы chats
- ✅ `messages_table_structure.md` - структура таблицы messages
- ✅ `chat_participants_table_structure.md` - структура таблицы chat_participants
- ✅ `donations_table_structure.md` - структура таблицы donations
- ⏳ Остальные таблицы - TODO

## Как обновить документацию

1. Выполните SQL запрос из `get_all_tables_structure.sql`
2. Обновите соответствующий файл структуры таблицы
3. Обновите этот файл, если добавились новые таблицы

## Дата последнего обновления

2025-12-24 - Создана полная структура документации для основных таблиц
