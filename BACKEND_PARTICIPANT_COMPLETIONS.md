# Документация для бэкенда: Новая система закрытия работы участниками

## Обзор изменений

Изменена парадигма работы с заявками типа `event` и `waste`. Теперь каждый присоединившийся участник может самостоятельно закрыть свою часть работы, а создатель заявки должен одобрить или отклонить закрытие каждого участника.

## Новая структура данных

### Поле `participant_completions` в модели заявки

Добавлено новое поле `participant_completions` в модель заявки (таблица `requests`).

**Тип:** JSON объект (Map), где:
- **Ключ:** `userId` (UUID пользователя из таблицы `users`)
- **Значение:** JSON объект с данными закрытия работы участником

### Структура объекта данных закрытия

```json
{
  "status": "inProgress" | "pending" | "rejected" | "approved",
  "photos_after": ["url1", "url2", ...],
  "completion_comment": "Комментарий участника",
  "completion_latitude": 56.4962847,
  "completion_longitude": 84.9802779,
  "rejection_reason": "Причина отказа (только для rejected)",
  "completed_at": "2025-12-21T13:35:00.000Z"
}
```

### Описание полей

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `status` | string | Да | Статус закрытия: `"inProgress"` (по умолчанию для всех присоединившихся), `"pending"` (участник закрыл работу, ожидает одобрения), `"rejected"` (создатель отклонил), `"approved"` (создатель одобрил) |
| `photos_after` | array[string] | Да | Массив URL фотографий "после" работы |
| `completion_comment` | string | Нет | Комментарий участника при закрытии работы |
| `completion_latitude` | number | Да | Широта координат пользователя в момент закрытия |
| `completion_longitude` | number | Да | Долгота координат пользователя в момент закрытия |
| `rejection_reason` | string | Нет | Причина отказа (заполняется создателем при reject) |
| `completed_at` | string (ISO 8601) | Нет | Дата и время закрытия работы участником |

## Логика работы

### Для заявок типа `event`

1. **При присоединении к событию:**
   - Пользователь добавляется в `registered_participants`
   - В `participant_completions` создается запись для этого пользователя со статусом `"inProgress"`:
     ```json
     {
       "user_id_1": {
         "status": "inProgress",
         "photos_after": [],
         "completion_comment": null,
         "completion_latitude": null,
         "completion_longitude": null,
         "rejection_reason": null,
         "completed_at": null
       }
     }
     ```

2. **Когда участник закрывает свою работу:**
   - Участник отправляет POST запрос с фото, комментарием и координатами
   - Статус меняется на `"pending"`
   - Заполняются все поля (фото, комментарий, координаты, `completed_at`)
   - **Отправляется push-уведомление создателю заявки**

3. **Когда создатель одобряет/отклоняет:**
   - Создатель отправляет PATCH запрос для изменения статуса конкретного участника
   - Статус меняется на `"approved"` или `"rejected"`
   - При `"rejected"` обязательно заполняется `rejection_reason`

4. **Когда создатель закрывает заявку:**
   - Создатель может закрыть заявку в любой момент
   - Заявка переходит в статус `"pending"` (для рассмотрения в админке)
   - **Коины получают только те участники, у которых статус `"approved"`**

### Для заявок типа `waste`

Логика полностью аналогична `event`, но:
- Вместо `registered_participants` используется `joined_user_id` (один пользователь)
- В `participant_completions` будет только одна запись для `joined_user_id`

## API Endpoints

### 1. Закрытие работы участником

**POST** `/api/requests/:requestId/participant-completion`

**Требования:**
- Пользователь должен быть в `registered_participants` (для event) или `joined_user_id` (для waste)
- Событие должно начаться (для event: `start_date <= now()`)
- Статус заявки должен быть `"inProgress"`

**Body (multipart/form-data):**
```
photos_after: File[] (обязательно, минимум 1 фото)
completion_comment: string (опционально)
completion_latitude: number (обязательно)
completion_longitude: number (обязательно)
```

**Ответ:**
```json
{
  "success": true,
  "message": "Успешно",
  "data": {
    "request": { ... }
  }
}
```

**Действия на бэкенде:**
1. Сохранить фото на сервер
2. Обновить `participant_completions[userId]`:
   - `status` → `"pending"`
   - `photos_after` → массив URL сохраненных фото
   - `completion_comment` → комментарий (если есть)
   - `completion_latitude` → широта
   - `completion_longitude` → долгота
   - `completed_at` → текущее время
3. Отправить push-уведомление создателю заявки

### 2. Одобрение/отклонение закрытия создателем

**PATCH** `/api/requests/:requestId/participant-completion/:userId`

**Требования:**
- Пользователь должен быть создателем заявки (`created_by`)
- Участник должен иметь статус `"pending"`

**Body (JSON):**
```json
{
  "action": "approve" | "reject",
  "rejection_reason": "string" // Обязательно при action="reject"
}
```

**Ответ:**
```json
{
  "success": true,
  "message": "Успешно",
  "data": {
    "request": { ... }
  }
}
```

**Действия на бэкенде:**
1. Обновить `participant_completions[userId].status`:
   - При `"approve"` → `"approved"`
   - При `"reject"` → `"rejected"` + сохранить `rejection_reason`
2. Отправить push-уведомление участнику (при reject - с причиной)

### 3. Закрытие заявки создателем

**POST** `/api/requests/:requestId/close-by-creator`

**Требования:**
- Пользователь должен быть создателем заявки (`created_by`)
- Заявка должна быть в статусе `"inProgress"`

**Body (JSON):**
```json
{
  "completion_comment": "string" // Опционально
}
```

**Ответ:**
```json
{
  "success": true,
  "message": "Успешно",
  "data": {
    "request": { ... }
  }
}
```

**Действия на бэкенде:**
1. Изменить статус заявки на `"pending"`
2. Заполнить `completion_comment` (если указан)
3. **Начислить коины только участникам со статусом `"approved"`**:
   - Создателю: 1 коин
   - Каждому участнику со статусом `"approved"`: по 1 коину
   - Всем донатерам: по 1 коину

## Push-уведомления

### 1. Уведомление создателю при закрытии работы участником

**Триггер:** Когда участник закрывает свою работу (статус меняется на `"pending"`)

**Текст:** "Участник [Имя] закрыл свою часть работы. Требуется ваше одобрение."

**Действие при клике:** Переход на страницу детализации заявки `/request/:category/:requestId`

### 2. Уведомление участнику при отклонении

**Триггер:** Когда создатель отклоняет закрытие (статус меняется на `"rejected"`)

**Текст:** "Ваше закрытие работы отклонено. Причина: [rejection_reason]"

**Действие при клике:** Переход на страницу детализации заявки `/request/:category/:requestId`

## Важные замечания

1. **Инициализация статусов:**
   - При присоединении к событию автоматически создается запись в `participant_completions` со статусом `"inProgress"`
   - Для waste: при присоединении (`joined_user_id` устанавливается) создается запись для этого пользователя

2. **Валидация:**
   - При закрытии работы участником обязательно должны быть: минимум 1 фото, координаты
   - При reject обязательно должна быть указана причина

3. **Начисление коинов:**
   - Коины начисляются только при закрытии заявки создателем
   - Получают коины только участники со статусом `"approved"` на момент закрытия
   - Если участник закрыл работу после закрытия заявки создателем, он не получит коины

4. **Обратная совместимость:**
   - Если `participant_completions` отсутствует или пусто, фронтенд должен работать с существующей логикой
   - Старые заявки без `participant_completions` должны обрабатываться корректно

## Примеры данных

### Пример 1: Event с несколькими участниками

```json
{
  "id": "request-uuid",
  "category": "event",
  "status": "inProgress",
  "registered_participants": ["user1", "user2", "user3"],
  "participant_completions": {
    "user1": {
      "status": "inProgress",
      "photos_after": [],
      "completion_comment": null,
      "completion_latitude": null,
      "completion_longitude": null,
      "rejection_reason": null,
      "completed_at": null
    },
    "user2": {
      "status": "pending",
      "photos_after": ["http://.../photo1.jpg", "http://.../photo2.jpg"],
      "completion_comment": "Убрал весь мусор",
      "completion_latitude": 56.4962847,
      "completion_longitude": 84.9802779,
      "rejection_reason": null,
      "completed_at": "2025-12-21T13:35:00.000Z"
    },
    "user3": {
      "status": "approved",
      "photos_after": ["http://.../photo3.jpg"],
      "completion_comment": "Готово",
      "completion_latitude": 56.4962847,
      "completion_longitude": 84.9802779,
      "rejection_reason": null,
      "completed_at": "2025-12-21T13:30:00.000Z"
    }
  }
}
```

### Пример 2: Waste с одним участником

```json
{
  "id": "request-uuid",
  "category": "wasteLocation",
  "status": "inProgress",
  "joined_user_id": "user1",
  "participant_completions": {
    "user1": {
      "status": "pending",
      "photos_after": ["http://.../photo1.jpg"],
      "completion_comment": "Вывез мусор",
      "completion_latitude": 56.4962847,
      "completion_longitude": 84.9802779,
      "rejection_reason": null,
      "completed_at": "2025-12-21T13:35:00.000Z"
    }
  }
}
```

## Вопросы для уточнения

Если возникнут вопросы при реализации, пожалуйста, свяжитесь с фронтенд-командой для уточнения деталей.

