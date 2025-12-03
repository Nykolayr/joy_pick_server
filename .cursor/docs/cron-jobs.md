# Cron задачи

## Общая информация

На сервере Beget **НЕТ** системного cron (команда `crontab` недоступна). Используется `node-cron` внутри приложения для автоматических задач.

Cron задачи запускаются автоматически при старте сервера. Расписание настраивается через переменную окружения `CRON_SCHEDULE` в `.env`.

## Список cron задач

### 1. autoCompleteSpeedCleanup
**Описание:** Автоматическое завершение speedCleanup заявок через 24 часа после одобрения

**Частота:** Каждые 5-10 минут

**Логика:**
- Находит все заявки типа `speedCleanup` со статусом `approved`
- Проверяет: если `updated_at` (время одобрения) + 24 часа < текущее время
- Действия:
  - Изменяет статус на `completed`
  - Начисляет коины донатерам (по 1 коину каждому)
  - Отправляет push-уведомление донатерам

**Файл:** `scripts/cronTasks.js` → `autoCompleteSpeedCleanup()`

### 2. checkWasteReminders
**Описание:** Напоминание исполнителю за 2 часа до окончания срока (22 часа после присоединения)

**Частота:** Каждые 5-10 минут

**Логика:**
- Находит все заявки типа `wasteLocation` со статусом `inProgress`
- Проверяет: если `join_date + 22 часа = текущее время` (с точностью до минуты)
- Действия:
  - Отправляет push-уведомление исполнителю (`joined_user_id`)
  - Сообщение: "You have 2 hours left to complete the request!"

**SQL запрос:**
```sql
SELECT id, join_date, joined_user_id 
FROM requests 
WHERE category = 'wasteLocation' 
  AND status = 'inProgress' 
  AND joined_user_id IS NOT NULL
  AND join_date IS NOT NULL
  AND join_date <= DATE_SUB(NOW(), INTERVAL 1320 MINUTE)
  AND join_date > DATE_SUB(NOW(), INTERVAL 1321 MINUTE)
```

**Важно:** Используется `INTERVAL 1320 MINUTE` и `INTERVAL 1321 MINUTE`, **НЕ** `INTERVAL 22 HOUR 1 MINUTE` (неправильный синтаксис MySQL)

**Файл:** `scripts/cronTasks.js` → `checkWasteReminders()`

### 3. checkExpiredWasteJoins
**Описание:** Проверка истекших присоединений для waste (24 часа)

**Частота:** Каждые 5-10 минут

**Логика:**
- Находит все заявки типа `wasteLocation` со статусом `inProgress`
- Проверяет: если `join_date + 24 часа < текущее время`
- Действия:
  - Отправляет push-уведомление исполнителю и создателю
  - Изменяет статус на `new`
  - Обнуляет `joined_user_id` и `join_date`

**Файл:** `scripts/cronTasks.js` → `checkExpiredWasteJoins()`

### 4. deleteInactiveRequests
**Описание:** Удаление неактивных заявок (7 дней без присоединения)

**Частота:** Каждые 24 часа (только в 00:00)

**Логика:**
- Находит все заявки со статусом `new`
- Проверяет: если `created_at + 7 дней < текущее время`
- Действия:
  - Возвращает деньги создателю и донатерам
  - Отправляет push-уведомления
  - Удаляет заявку из БД

**Файл:** `scripts/cronTasks.js` → `deleteInactiveRequests()`

### 5. checkEventTimes
**Описание:** Проверка времени до события для event

**Частота:** Каждые 5-10 минут

**Логика:**
- Находит все заявки типа `event` со статусом `inProgress`
- Проверяет время до события:
  - **За 24 часа:** Отправляет push-уведомление всем участникам
  - **За 2 часа:** Отправляет push-уведомление всем участникам
  - **Начало события:** Отправляет push-уведомление заказчику

**Файл:** `scripts/cronTasks.js` → `checkEventTimes()`

## Логирование действий

Все выполненные cron задачи записываются в таблицу `cron_actions` через функцию `logCronAction()`:

```javascript
await logCronAction(
  'checkWasteReminders',
  request.id,
  'wasteLocation',
  'Напоминание исполнителю заявки ...',
  'completed'
);
```

## Просмотр истории

Историю выполненных cron задач можно получить через API:
- `GET /api/cron/actions` - список последних выполненных и запланированных действий

## Ручной запуск

Cron задачи можно запустить вручную через API:
- `POST /api/cron/run` - запуск всех cron задач

## См. также

- [REQUEST_CONCEPT.md](../../REQUEST_CONCEPT.md) - детальная логика cron задач
- [scripts/cronTasks.js](../../scripts/cronTasks.js) - реализация cron задач
- [api/routes/cron.js](../../api/routes/cron.js) - API endpoints для cron

