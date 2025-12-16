# Концепция чатов (Chat Concept)

## Типы чатов

### 1. Чат с админами (техподдержка)
- **Тип:** `support`
- **Участники:** Один пользователь + все админы
- **Создание:** При первом обращении пользователя к админам (из профиля)
- **Удаление:** Не удаляется (постоянный чат)
- **Доступ:**
  - Пользователь видит свой чат в профиле
  - Админы видят все чаты в админ-панели
- **Особенности:**
  - Пуши админам НЕ отправляются (они заходят в админку)
  - Пуши пользователю отправляются при ответе админа

---

### 2. Чат пользователя с создателем заявки
- **Тип:** `private`
- **Участники:** Пользователь + создатель заявки
- **Создание:** При первом обращении любого пользователя к создателю заявки
- **Удаление:** При удалении заявки или переводе в статус `completed`
- **Доступ:**
  - Пользователь видит чат в карточке заявки
  - Создатель видит все свои приватные чаты
  - Админы могут просматривать через админ-панель (только просмотр)
- **Особенности:**
  - Любой пользователь может создать чат с создателем
  - Один чат на пару пользователь-создатель для конкретной заявки

---

### 3. Общий чат для заявки (групповой чат)
- **Тип:** `group`
- **Участники:** 
  - Создатель заявки (добавляется автоматически при создании заявки)
  - Присоединившиеся (для waste: `joined_user_id` - добавляется автоматически при присоединении)
  - Участники событий (для event: `registered_participants` - добавляются автоматически при участии)
  - Донатеры (из таблицы `donations` - добавляются автоматически при донате)
  - Админы (могут просматривать через админ-панель)
- **Создание:** **Автоматически при создании заявки любого типа** (wasteLocation, speedCleanup, event)
- **Удаление:** 
  - При удалении заявки
  - При переводе заявки в статус `completed`
  - При переводе заявки в статус `rejected`
- **Доступ:**
  - Все участники могут писать и читать
  - Админы могут просматривать через админ-панель (только просмотр)
- **Особенности:**
  - Создается автоматически для всех типов заявок
  - Участники добавляются автоматически при соответствующих действиях (присоединение, донат, участие)
  - Могут писать все участники
  - Могут отвечать все участники

---

## Структура базы данных

### Таблица `chats`

```sql
CREATE TABLE chats (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID чата',
  type ENUM('support', 'private', 'group') NOT NULL COMMENT 'Тип чата',
  request_id VARCHAR(36) NULL COMMENT 'ID заявки (для private и group)',
  user_id VARCHAR(36) NULL COMMENT 'ID пользователя (для support и private)',
  created_by VARCHAR(36) NULL COMMENT 'ID создателя чата',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Дата создания',
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP COMMENT 'Дата обновления',
  last_message_at DATETIME NULL COMMENT 'Дата последнего сообщения',
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_type (type),
  INDEX idx_request_id (request_id),
  INDEX idx_user_id (user_id),
  INDEX idx_last_message_at (last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Логика создания:**
- `support`: `request_id = NULL`, `user_id = ID пользователя`, `created_by = ID пользователя`
- `private`: `request_id = ID заявки`, `user_id = ID пользователя (не создателя)`, `created_by = ID пользователя`
- `group`: `request_id = ID заявки`, `user_id = NULL`, `created_by = ID создателя заявки`

---

### Таблица `messages`

```sql
CREATE TABLE messages (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID сообщения',
  chat_id VARCHAR(36) NOT NULL COMMENT 'ID чата',
  sender_id VARCHAR(36) NOT NULL COMMENT 'ID отправителя',
  message TEXT NOT NULL COMMENT 'Текст сообщения',
  message_type ENUM('text', 'image', 'file') NOT NULL DEFAULT 'text' COMMENT 'Тип сообщения',
  read_by JSON NULL COMMENT 'Массив ID пользователей, которые прочитали сообщение',
  unread_by JSON NULL COMMENT 'Массив ID пользователей, которые не прочитали сообщение',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Дата отправки',
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP COMMENT 'Дата обновления',
  deleted_at DATETIME NULL COMMENT 'Дата удаления (soft delete)',
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_chat_id (chat_id),
  INDEX idx_sender_id (sender_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Логика прочтения:**
- При отправке сообщения: отправитель автоматически добавляется в `read_by`, все остальные участники чата - в `unread_by`
- При открытии чата: вызывается `POST /api/chats/:chatId/read`, который перемещает текущего пользователя из `unread_by` в `read_by` для всех непрочитанных сообщений
- При получении сообщений: возвращаются оба массива `read_by` и `unread_by` для каждого сообщения

---

### Таблица `chat_participants`

```sql
CREATE TABLE chat_participants (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID записи',
  chat_id VARCHAR(36) NOT NULL COMMENT 'ID чата',
  user_id VARCHAR(36) NOT NULL COMMENT 'ID участника',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Дата присоединения',
  last_read_at DATETIME NULL COMMENT 'Дата последнего прочтения',
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_chat_user (chat_id, user_id),
  INDEX idx_user_id (user_id),
  INDEX idx_last_read_at (last_read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Логика:**
- Для `support`: автоматически добавляется пользователь и все админы при создании
- Для `private`: автоматически добавляются оба пользователя при создании
- Для `group`: автоматически добавляются все участники заявки (создатель, присоединившиеся, донатеры)

---

## Логика работы

### Создание чатов

#### 1. Чат с админами (support)
- **Триггер:** Пользователь нажимает "Написать в техподдержку" в профиле
- **Проверка:** Существует ли уже чат `support` для этого пользователя
- **Создание:** Если нет, создается новый чат
- **Участники:** Пользователь + все админы (из таблицы `users` где `admin = true`)

#### 2. Чат пользователя с создателем (private)
- **Триггер:** Пользователь нажимает "Написать создателю" в карточке заявки
- **Проверка:** Существует ли уже чат `private` для этой пары пользователь-создатель и заявки
- **Создание:** Если нет, создается новый чат
- **Участники:** Пользователь + создатель заявки

#### 3. Общий чат для заявки (group)
- **Триггер:** При создании заявки любого типа (wasteLocation, speedCleanup, event) - **автоматически**
- **Проверка:** Существует ли уже чат `group` для этой заявки
- **Создание:** Если нет, создается новый чат автоматически через `createGroupChatForRequest()`
- **Участники (добавляются автоматически):** 
  - **Создатель заявки** - добавляется сразу при создании заявки
  - **Присоединившиеся (waste)** - добавляются автоматически при присоединении к заявке через `POST /api/requests/:id/join`
  - **Участники событий (event)** - добавляются автоматически при участии через `POST /api/requests/:id/participate`
  - **Донатеры** - добавляются автоматически при донате через `POST /api/donations`

---

### Удаление чатов

#### Автоматическое удаление
- При удалении заявки: удаляются все связанные чаты (`private` и `group`) через `deleteGroupChatForRequest()`
- При переводе заявки в статус `completed`: удаляются все связанные чаты (`private` и `group`) через `deleteGroupChatForRequest()`
- При переводе заявки в статус `rejected`: удаляются все связанные чаты (`private` и `group`) через `deleteGroupChatForRequest()`
- Чат `support` НЕ удаляется (постоянный чат)

#### Автоматическое обновление участников group чата
- **При создании заявки:** создатель автоматически добавляется в `chat_participants` через `createGroupChatForRequest()`
- **При присоединении к заявке (waste):** участник автоматически добавляется в `chat_participants` через `addParticipantToGroupChatByRequest()`
- **При участии в событии (event):** участник автоматически добавляется в `chat_participants` через `addParticipantToGroupChatByRequest()`
- **При донате:** донатер автоматически добавляется в `chat_participants` через `addParticipantToGroupChatByRequest()`
- **При отсоединении:** участник остается в чате (история сохраняется, но он больше не получает уведомления)

---

### Отправка сообщений

#### WebSocket события (Socket.io)

**Клиент → Сервер:**
- `join_chat` - присоединение к чату
  ```json
  {
    "chatId": "uuid",
    "userId": "uuid"
  }
  ```
- `send_message` - отправка сообщения
  ```json
  {
    "chatId": "uuid",
    "message": "Текст сообщения",
    "messageType": "text"
  }
  ```
- `mark_as_read` - отметка о прочтении
  ```json
  {
    "messageId": "uuid",
    "chatId": "uuid"
  }
  ```
- `typing` - индикатор набора текста
  ```json
  {
    "chatId": "uuid",
    "isTyping": true
  }
  ```

**Сервер → Клиент:**
- `new_message` - новое сообщение
  ```json
  {
    "id": "uuid",
    "chatId": "uuid",
    "senderId": "uuid",
    "message": "Текст сообщения",
    "messageType": "text",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
  ```
- `message_read` - сообщение прочитано
  ```json
  {
    "messageId": "uuid",
    "userId": "uuid",
    "readAt": "2024-01-01T00:00:00.000Z"
  }
  ```
- `user_typing` - пользователь печатает
  ```json
  {
    "chatId": "uuid",
    "userId": "uuid",
    "isTyping": true
  }
  ```

---

### Push-уведомления

#### Отправка пуша при новом сообщении
- **Получатели:** Все участники чата, кроме отправителя
- **Исключение:** Для чата `support` - пуши админам НЕ отправляются
- **Сообщение:** "Новое сообщение в чате" (или кастомное)
- **Deeplink:** `joypick://chat/{chatId}`

---

### Получение истории сообщений

#### HTTP API (не через WebSocket)
- **Endpoint:** `GET /api/chats/:chatId/messages`
- **Параметры:**
  - `limit` - количество сообщений (по умолчанию 50)
  - `offset` - смещение для пагинации
  - `before` - получить сообщения до указанной даты
- **Ответ:** Массив сообщений с информацией о прочтении

---

## API Endpoints

### Чат с админами (support)

#### GET `/api/chats/support`
Получить чат техподдержки текущего пользователя

**Ответ:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "support",
    "user_id": "uuid",
    "created_at": "2024-01-01T00:00:00.000Z",
    "last_message_at": "2024-01-01T00:00:00.000Z",
    "unread_count": 5
  }
}
```

#### POST `/api/chats/support`
Создать чат техподдержки (если не существует)

**Ответ:** Аналогично GET

---

### Чат пользователя с создателем (private)

#### GET `/api/chats/private/:requestId`
Получить приватный чат с создателем заявки

**Параметры:**
- `requestId` - ID заявки

**Ответ:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "private",
    "request_id": "uuid",
    "user_id": "uuid",
    "created_at": "2024-01-01T00:00:00.000Z",
    "last_message_at": "2024-01-01T00:00:00.000Z",
    "unread_count": 2
  }
}
```

#### POST `/api/chats/private`
Создать приватный чат между двумя пользователями

**Описание:**
Создать приватный чат между двумя пользователями. Приватный чат не отличается от группового по структуре, но содержит только двух участников.

**Тело запроса:**
```json
{
  "user_id_1": "uuid",
  "user_id_2": "uuid",
  "request_id": "uuid" // опционально, для связи с заявкой
}
```

**Параметры:**
- `user_id_1` (обязательно) - ID первого пользователя
- `user_id_2` (обязательно) - ID второго пользователя
- `request_id` (опционально) - ID заявки, с которой связан чат

**Альтернативный формат (для обратной совместимости):**
```json
{
  "request_id": "uuid"
}
```
В этом случае создается чат между текущим пользователем (кто делает запрос) и создателем заявки.

**Ответ:** Аналогично GET

---

### Общий чат для заявки (group)

#### GET `/api/chats/group/:requestId`
Получить групповой чат заявки

**Параметры:**
- `requestId` - ID заявки

**Ответ:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "group",
    "request_id": "uuid",
    "created_at": "2024-01-01T00:00:00.000Z",
    "last_message_at": "2024-01-01T00:00:00.000Z",
    "unread_count": 3,
    "participants_count": 5
  }
}
```

#### POST `/api/chats/group`
Создать групповой чат для заявки

**Описание:**
Создать групповой чат для заявки. Если чат уже существует, возвращает существующий чат. Автоматически добавляет всех участников:
- Создателя заявки (`created_by`)
- Для waste: присоединившегося пользователя (`joined_user_id`, если есть)
- Для event: зарегистрированных участников (`registered_participants`)
- Всех донатеров из таблицы `donations`

**Тело запроса:**
```json
{
  "request_id": "uuid"
}
```

**Ответ:**
```json
{
  "success": true,
  "message": "Групповой чат создан",
  "data": {
    "id": "uuid",
    "type": "group",
    "request_id": "uuid",
    "created_by": "uuid",
    "created_at": "2024-01-01T00:00:00.000Z",
    "last_message_at": "2024-01-01T00:00:00.000Z",
    "unread_count": 0,
    "participants_count": 5
  }
}
```

**Примечание:**
Если групповой чат для указанной заявки уже существует, возвращается существующий чат вместо создания нового.

---

### Список чатов

#### GET `/api/chats`
Получить список всех чатов текущего пользователя

**Параметры:**
- `type` - фильтр по типу (`support`, `private`, `group`)
- `limit` - количество (по умолчанию 20)
- `offset` - смещение

**Ответ:**
```json
{
  "success": true,
  "data": {
    "chats": [
      {
        "id": "uuid",
        "type": "support",
        "last_message": {
          "id": "uuid",
          "message": "Последнее сообщение",
          "sender_id": "uuid",
          "created_at": "2024-01-01T00:00:00.000Z"
        },
        "unread_count": 5,
        "last_message_at": "2024-01-01T00:00:00.000Z"
      }
    ],
    "total": 10
  }
}
```

---

### Сообщения

#### GET `/api/chats/:chatId/messages`
Получить историю сообщений чата

**Параметры:**
- `chatId` - ID чата
- `limit` - количество (по умолчанию 50)
- `offset` - смещение
- `before` - получить сообщения до указанной даты (ISO 8601)

**Ответ:**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "uuid",
        "chat_id": "uuid",
        "sender_id": "uuid",
        "sender": {
          "id": "uuid",
          "display_name": "Иван Иванов",
          "photo_url": "url"
        },
        "message": "Текст сообщения",
        "message_type": "text",
        "created_at": "2024-01-01T00:00:00.000Z",
        "read_by": [
          {
            "user_id": "uuid",
            "read_at": "2024-01-01T00:00:00.000Z"
          }
        ]
      }
    ],
    "total": 100,
    "has_more": true
  }
}
```

#### POST `/api/chats/:chatId/messages`
Отправить сообщение (альтернатива WebSocket)

**Тело запроса:**
```json
{
  "message": "Текст сообщения",
  "message_type": "text"
}
```

**Ответ:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "chat_id": "uuid",
    "sender_id": "uuid",
    "message": "Текст сообщения",
    "message_type": "text",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### POST `/api/chats/:chatId/messages/:messageId/read`
Отметить сообщение как прочитанное

**Ответ:**
```json
{
  "success": true,
  "data": {
    "message_id": "uuid",
    "read_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### Админ-панель

#### GET `/api/admin/chats`
Получить все чаты (для админов)

**Параметры:**
- `type` - фильтр по типу
- `request_id` - фильтр по заявке
- `user_id` - фильтр по пользователю
- `limit`, `offset` - пагинация

**Ответ:** Аналогично GET `/api/chats`, но со всеми чатами

#### GET `/api/admin/chats/:chatId/messages`
Получить все сообщения чата (для админов, только просмотр)

**Ответ:** Аналогично GET `/api/chats/:chatId/messages`

---

## WebSocket сервер (Socket.io)

### Подключение

**Важно:** Используйте тот же домен, что и для HTTP API, БЕЗ указания порта!

- **Production URL:** `http://autogie1.bget.ru` или `https://autogie1.bget.ru`
- **Development URL:** `http://localhost:3000` (только для локальной разработки)

**НЕ используйте:**
- ❌ `wss://autogie1.bget.ru:46218` (неправильный порт)
- ❌ `ws://autogie1.bget.ru:3000` (не указывайте порт на production)

**Аутентификация:** JWT токен передается в параметре `auth`:

**Пример для JavaScript/TypeScript:**
```javascript
import { io } from 'socket.io-client';

const socket = io('http://autogie1.bget.ru', {
  transports: ['polling', 'websocket'], // polling - основной транспорт для Passenger
  auth: {
    token: 'your_jwt_token'
  }
});
```

**Пример для Flutter/Dart:**
```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

final socket = IO.io(
  'http://autogie1.bget.ru',
  IO.OptionBuilder()
    .setTransports(['polling', 'websocket']) // polling - основной транспорт
    .setAuth({'token': yourJwtToken})
    .setExtraHeaders({'Authorization': 'Bearer $yourJwtToken'})
    .build()
);
```

**Обработка событий подключения:**
```javascript
socket.on('connect', () => {
  console.log('Подключено к Socket.io');
});

socket.on('connect_error', (error) => {
  console.error('Ошибка подключения:', error);
});

socket.on('disconnect', (reason) => {
  console.log('Отключено:', reason);
});
```

### Комнаты (Rooms)
- Каждый чат = отдельная комната Socket.io
- Название комнаты: `chat:{chatId}`
- При присоединении к чату: `socket.join('chat:{chatId}')`

### События

#### `join_chat`
Присоединение к чату

**Клиент отправляет:**
```json
{
  "chatId": "uuid"
}
```

**Сервер:**
- Проверяет права доступа
- Добавляет socket в комнату `chat:{chatId}`
- Отправляет последние N сообщений (опционально)

#### `send_message`
Отправка сообщения

**Клиент отправляет:**
```json
{
  "chatId": "uuid",
  "message": "Текст сообщения",
  "messageType": "text"
}
```

**Сервер:**
- Проверяет права доступа
- Сохраняет сообщение в БД
- Отправляет событие `new_message` всем участникам комнаты
- Отправляет push-уведомления (кроме отправителя и админов для support)

#### `mark_as_read`
Отметка о прочтении

**Клиент отправляет:**
```json
{
  "messageId": "uuid",
  "chatId": "uuid"
}
```

**Сервер:**
- Сохраняет запись в `message_reads`
- Отправляет событие `message_read` всем участникам комнаты

#### `typing`
Индикатор набора текста

**Клиент отправляет:**
```json
{
  "chatId": "uuid",
  "isTyping": true
}
```

**Сервер:**
- Отправляет событие `user_typing` всем участникам комнаты (кроме отправителя)

---

## Права доступа

### Чат с админами (support)
- **Читать/писать:** Пользователь (владелец чата) + все админы
- **Просмотр в админке:** Да (все админы)

### Чат пользователя с создателем (private)
- **Читать/писать:** Пользователь + создатель заявки
- **Просмотр в админке:** Да (только просмотр, без возможности писать)

### Общий чат для заявки (group)
- **Читать/писать:** 
  - Создатель заявки
  - Присоединившиеся (для waste: `joined_user_id`, для event: `registered_participants`)
  - Донатеры (из таблицы `donations`)
- **Просмотр в админке:** Да (только просмотр, без возможности писать)

---

## Автоматические действия

### При создании заявки (любого типа: wasteLocation, speedCleanup, event)
1. **Автоматически** создается групповой чат (`group`) для заявки через `createGroupChatForRequest()`
2. **Автоматически** добавляется создатель в `chat_participants`
3. Чат готов к использованию сразу после создания заявки

### При присоединении к заявке (waste)
1. **Автоматически** пользователь добавляется в `chat_participants` группового чата через `addParticipantToGroupChatByRequest()`
2. Если чат не существует (старые заявки), он создается автоматически
3. Пользователь получает доступ к групповому чату

### При участии в событии (event)
1. **Автоматически** участник добавляется в `chat_participants` группового чата через `addParticipantToGroupChatByRequest()`
2. Если чат не существует (старые заявки), он создается автоматически
3. Участник получает доступ к групповому чату

### При донате
1. **Автоматически** донатер добавляется в `chat_participants` группового чата через `addParticipantToGroupChatByRequest()`
2. Если чат не существует (старые заявки), он создается автоматически
3. Донатер получает доступ к групповому чату

### При удалении заявки
1. **Автоматически** удаляется групповой чат через `deleteGroupChatForRequest()`
2. Удаляются все связанные чаты (`private` и `group`) через CASCADE
3. Удаляются все сообщения (CASCADE)
4. Удаляются все записи о прочтении (CASCADE)

### При переводе заявки в статус `completed`
1. **Автоматически** удаляется групповой чат через `deleteGroupChatForRequest()`
2. Удаляются все связанные чаты (`private` и `group`) через CASCADE
3. Удаляются все сообщения (CASCADE)
4. Удаляются все записи о прочтении (CASCADE)

### При переводе заявки в статус `rejected`
1. **Автоматически** удаляется групповой чат через `deleteGroupChatForRequest()`
2. Удаляются все связанные чаты (`private` и `group`) через CASCADE
3. Удаляются все сообщения (CASCADE)
4. Удаляются все записи о прочтении (CASCADE)

---

## Технические детали

### Формат дат
- Все даты в UTC, формат ISO 8601: `2024-01-01T00:00:00.000Z`

### ID пользователей
- **ВСЕГДА** используются UUID из базы данных (поле `id` из таблицы `users`)
- **НИКОГДА** не используются Firebase UID

### Пагинация
- По умолчанию: 50 сообщений за раз
- Использовать `offset` и `limit` для пагинации
- Для бесконечной прокрутки: использовать `before` (дата последнего загруженного сообщения)

### Статусы прочтения
- При отправке сообщения: автоматически помечается как прочитанное отправителем
- При получении сообщения через WebSocket: автоматически помечается как прочитанное
- При открытии чата: все непрочитанные сообщения помечаются как прочитанные

---

## Утилиты для работы с групповыми чатами

Все функции для автоматического управления групповыми чатами находятся в `api/utils/chatHelpers.js`:

### `createGroupChatForRequest(requestId, createdBy, category)`
Создает групповой чат для заявки и добавляет создателя в участники.

**Параметры:**
- `requestId` - ID заявки
- `createdBy` - ID создателя заявки
- `category` - Категория заявки (wasteLocation, speedCleanup, event)

**Возвращает:** ID созданного чата или null при ошибке

**Использование:** Вызывается автоматически при создании заявки через `POST /api/requests`

### `addParticipantToGroupChatByRequest(requestId, userId)`
Добавляет участника в групповой чат заявки. Если чат не существует, создает его.

**Параметры:**
- `requestId` - ID заявки
- `userId` - ID пользователя для добавления

**Возвращает:** true если успешно, false при ошибке

**Использование:** 
- Вызывается автоматически при донате через `POST /api/donations`
- Вызывается автоматически при присоединении к заявке через `POST /api/requests/:id/join`
- Вызывается автоматически при участии в событии через `POST /api/requests/:id/participate`

### `addParticipantToGroupChat(chatId, userId)`
Добавляет участника в существующий групповой чат.

**Параметры:**
- `chatId` - ID чата
- `userId` - ID пользователя для добавления

**Возвращает:** true если успешно, false при ошибке

### `updateGroupChatParticipants(requestId)`
Обновляет список участников группового чата на основе текущих данных заявки (создатель, присоединившиеся, донатеры).

**Параметры:**
- `requestId` - ID заявки

**Возвращает:** true если успешно

### `deleteGroupChatForRequest(requestId)`
Удаляет групповой чат заявки.

**Параметры:**
- `requestId` - ID заявки

**Возвращает:** true если успешно

**Использование:**
- Вызывается автоматически при удалении заявки через `DELETE /api/requests/:id`
- Вызывается автоматически при переводе в статус `completed` или `rejected`

---

## TODO

- [x] Реализовать таблицы в БД
- [x] Реализовать Socket.io сервер
- [x] Реализовать API endpoints
- [x] Реализовать push-уведомления для чатов
- [x] Реализовать автоматическое создание/удаление чатов
- [x] Реализовать обновление участников group чата
- [x] Реализовать админ-панель для просмотра чатов
- [ ] Добавить поддержку изображений (в будущем)
- [ ] Добавить модерацию сообщений (в будущем)

