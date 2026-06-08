# API Документация для Flutter приложения Joy Pick

## Базовый URL

**Production (основной домен):** `https://joypick.world`

| Назначение | Базовый URL |
|------------|-------------|
| REST API (все эндпоинты документа ниже с префиксом `/api/...`) | `https://joypick.world/api` |
| Публичный сайт (Flutter web, статика `publish/site/web/`) | `https://joypick.world/` |
| Админ-панель (Flutter web, статика `publish/admin/web/`) | `https://joypick.world/admin/` |
| Загруженные файлы (`/uploads/...`) | `https://joypick.world/uploads/...` |

```
https://joypick.world/api
```

**Или для локальной разработки:**
```
http://localhost:3000/api
```

### Страницы соглашений (HTML по запросу)

Отдаются статичным HTML для открытия в WebView или браузере из приложения. Рекомендуется использовать пути под `/api` (гарантированно обрабатываются сервером):

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/terms-of-service` | Terms of Service — полная страница HTML |
| GET | `/api/privacy-policy` | Privacy Policy — полная страница HTML |

**URL:** `https://joypick.world/api/terms-of-service`, `https://joypick.world/api/privacy-policy`. Ответ: `Content-Type: text/html`, тело — HTML. Ссылки внутри страниц ведут на `/api/terms-of-service` и `/api/privacy-policy`.

---

## Аутентификация

Все защищенные эндпоинты требуют заголовок `Authorization`:

```
Authorization: Bearer <jwt_token>
```

### Способы авторизации

API поддерживает два способа авторизации:

1. **Email/Password** - стандартная регистрация и вход через email и пароль
   - `POST /api/auth/register` - регистрация
   - `POST /api/auth/login` - вход

2. **Firebase (Google, Apple, GitHub, Phone)** - авторизация через Firebase
   - `POST /api/auth/firebase` - обмен Firebase токена на серверный JWT

**Важно:** После авторизации через Firebase на клиенте, необходимо отправить Firebase ID Token на сервер для получения серверного JWT токена, который используется для всех последующих API запросов.

### Настройка Email для верификации

Для работы верификации email при регистрации необходимо настроить отправку email. Подробные инструкции см. в разделе [Настройка Email](#настройка-email) ниже.

---

## ⏰ Формат дат и времени

**Важно:** Все даты и время в API возвращаются в формате **UTC (Coordinated Universal Time)** в стандарте **ISO 8601**.

### Формат дат

Все поля с датами и временем возвращаются в следующем формате:
```
YYYY-MM-DDTHH:mm:ss.sssZ
```

**Примеры:**
- `2025-12-01T15:54:00.000Z` - 1 декабря 2025 года, 15:54:00 UTC
- `2025-12-01T22:54:00.000Z` - 1 декабря 2025 года, 22:54:00 UTC

### Отправка дат на сервер

При отправке дат на сервер используйте тот же формат ISO 8601 в UTC:
```json
{
  "start_date": "2025-12-01T15:54:00.000Z",
  "end_date": "2025-12-01T17:54:00.000Z"
}
```

**Важно для клиента:**
- Все даты, полученные от сервера, уже в UTC - не нужно дополнительно преобразовывать
- При отправке дат на сервер конвертируйте локальное время в UTC перед отправкой
- Сервер автоматически нормализует все даты в UTC при возврате данных

### Поля с датами в моделях

Следующие поля во всех моделях содержат даты в формате UTC:
- `created_at` - дата создания
- `updated_at` - дата обновления
- `start_date` - дата начала (для заявок)
- `end_date` - дата окончания (для заявок)
- `join_date` - дата присоединения (для заявок)
- `created_time` - дата создания (для пользователей)
- `executed_at` - дата выполнения (для cron действий)
- `scheduled_at` - запланированная дата (для cron действий)

---

## 💰 Формат денежных сумм (КРИТИЧЕСКИ ВАЖНО!)

**ВАЖНО:** Все денежные суммы в API работают ОДИНАКОВО - всегда в долларах (decimal/float)!

### Правила работы с суммами:

1. **Все суммы приходят и возвращаются в долларах:**
   - `amount` (для донатов) - в долларах (decimal/float). Примеры: `2.50`, `10.00`, `1.25`
   - `total_contributed` - в долларах (decimal/float) - сумма всех донатов
   - `target_amount` - в долларах (decimal/float)
   
   **ВАЖНО:** Поле `cost` удалено. Теперь все платежи идут через донаты, включая платеж создателя.

2. **В БД сохраняется:**
   - Все суммы в долларах в формате `decimal(10,2)`
   - Поддерживает дробные значения (например, $2.50)

3. **Внутри бэкенда:**
   - Бэкенд автоматически конвертирует доллары в центы для Stripe API
   - Stripe работает с центами, но это скрыто от фронтенда

4. **Минимум:**
   - Минимум 0.50 доллара (50 центов) - требование Stripe

### Примеры использования:

**Создание доната (включая донат от создателя):**
```json
{
  "amount": 1.25
}
```
→ Бэкенд автоматически конвертирует в центы (125) для Stripe, в БД сохраняется `1.25`

**Получение заявки:**
```json
{
  "total_contributed": 5.75
}
```
→ Все суммы возвращаются в долларах

**ВАЖНО:** Поле `cost` удалено. Теперь все платежи идут через донаты. Создатель может сделать донат своей заявке через `POST /api/donations` сразу после создания заявки или позже.

---

## 📋 Модели данных

### ⚠️ Важно: ID пользователей

**Все ID пользователей в API должны быть UUID из базы данных** (поле `id` из таблицы `users`), а не Firebase UID.

- **Используйте:** UUID формата `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (36 символов с дефисами)
- **НЕ используйте:** Firebase UID (например, `M9HmfMMAMRejNc40GyMAoUT8Bk02`)
- **Где это важно:** `joined_user_id`, `created_by`, `taken_by`, элементы в `actual_participants`, элементы в `registered_participants`

Сервер автоматически валидирует формат UUID и вернет ошибку, если передан Firebase UID или другой невалидный формат.

---

### Модель User (Пользователь)

**Важно:** Все поля в API используют **snake_case** (как в базе данных). При отправке и получении данных используйте `snake_case` формат.

#### Поля модели:

| Поле (snake_case) | Тип | Обязательное | Описание |
|------------------|-----|--------------|----------|
| `id` | string (UUID) | Нет (автогенерация) | Уникальный идентификатор пользователя |
| `email` | string | Да (при регистрации) | Email адрес пользователя |
| `password` | string | Да (при регистрации) | Пароль (только при регистрации, не хранится) |
| `display_name` | string | Нет | Отображаемое имя пользователя |
| `first_name` | string | Нет | Имя |
| `second_name` | string | Нет | Фамилия |
| `phone_number` | string | Нет | Номер телефона |
| `city` | string | Нет | Город |
| `country` | string | Нет | Страна |
| `gender` | string | Нет | Пол (male/female/other) |
| `photo_url` | string | Нет | URL фотографии профиля |
| `latitude` | float | Нет | Широта местоположения |
| `longitude` | float | Нет | Долгота местоположения |
| `fcm_token` | string | Нет | FCM токен для push-уведомлений |
| `uid` | string | Нет | Firebase UID (для Firebase авторизации) |
| `auth_type` | string | Нет | Тип авторизации (email/google/apple/github/phone) |
| `email_verified` | boolean | Нет | Статус верификации email (только чтение) |
| `count_performed` | integer | Нет | Количество выполненных заявок (только чтение) |
| `count_orders` | integer | Нет | Количество созданных заявок (только чтение) |
| `jcoins` | integer | Нет | Текущий баланс Joycoins (только чтение, обновление через отдельный эндпоинт) |
| `jcoins_spent` | integer | Нет | Всего списано коинов у партнёров (сумма по погашениям, только чтение) |
| `coins_from_created` | integer | Нет | Монеты за созданные заявки (только чтение) |
| `coins_from_participation` | integer | Нет | Монеты за участие (только чтение) |
| `stripe_id` | string | Нет | Stripe ID (только чтение) |
| `stripe_account_status` | string | Нет | Кэш статуса Stripe: `none` \| `incomplete` \| `complete` (только чтение) |
| `stripe_status_label` | string | Нет | Текст для экрана статуса (EN) (только чтение) |
| `can_donate` | boolean | Нет | Можно принимать платежи (charges_enabled) (только чтение) |
| `can_receive_payouts` | boolean | Нет | Можно получать выплаты (payouts_enabled) (только чтение) |
| `stripe_status_updated_at` | datetime | Нет | Когда последний раз обновляли статус из Stripe (только чтение) |
| `score` | integer | Нет | Рейтинг пользователя (только чтение) |
| `admin` | boolean | Нет | Статус администратора (только чтение) |
| `created_time` | datetime | Нет | Дата создания (только чтение) |

#### Пример полной модели User (ответ от сервера):

```json
{
  "id": "353f958d-8796-44c7-a877-3e376eca6784",
  "email": "user@example.com",
  "display_name": "Иван Иванов",
  "first_name": "Иван",
  "second_name": "Иванов",
  "phone_number": "+1234567890",
  "city": "Москва",
  "country": "Россия",
  "gender": "male",
  "photo_url": "https://joypick.world/uploads/avatars/uuid.jpg",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "fcm_token": "cqMv5gx6SKWXpMxFdRX8_3:APA91b...",
  "uid": "firebase_uid_here",
  "auth_type": "google",
  "email_verified": true,
  "count_performed": 5,
  "count_orders": 10,
  "jcoins": 150,
  "jcoins_spent": 12,
  "coins_from_created": 50,
  "coins_from_participation": 100,
  "stripe_id": null,
  "stripe_account_status": "complete",
  "stripe_status_label": "Account ready",
  "can_donate": true,
  "can_receive_payouts": true,
  "stripe_status_updated_at": "2024-01-15T12:00:00.000Z",
  "score": 85,
  "admin": false,
  "created_time": "2024-01-01T00:00:00.000Z"
}
```

---

### Модель Request (Заявка)

**Важно:** Все поля в API используют **snake_case** (как в базе данных). При отправке и получении данных используйте `snake_case` формат.

#### Поля модели:

| Поле (snake_case) | Тип | Обязательное | Описание |
|------------------|-----|--------------|----------|
| `id` | string (UUID) | Нет (автогенерация) | Уникальный идентификатор заявки |
| `user_id` | string | Нет (из токена) | ID пользователя (автоматически из токена) |
| `category` | string | Да | Тип заявки: `wasteLocation`, `speedCleanup`, `event` |
| `name` | string | Да | Название заявки |
| `description` | string | Нет | Описание заявки |
| `latitude` | float | Нет | Широта местоположения |
| `longitude` | float | Нет | Долгота местоположения |
| `city` | string | Нет | Город |
| `photos` | array[string] | Нет | Агрегированный массив URL фото заявки для стабильного рендера на клиенте. В ответах **всегда присутствует** (может быть `[]`). Обычно это объединение `photos_before` + `photos_after`. |
| `photos_before` | array[string] | Нет | Массив URL фотографий "до" уборки (для всех типов заявок) |
| `photos_after` | array[string] | Нет | Массив URL фотографий "после" уборки (для всех типов заявок) |
| `garbage_size` | integer | Нет | Размер мусора: `1` (bag), `2` (cart), `3` (car) |
| `waste_types` | array[string] | Нет | Массив названий типов отходов (например: `["plastic", "glass"]`) |
| `only_foot` | boolean | Нет | Доступ только пешком (по умолчанию: `false`) |
| `possible_by_car` | boolean | Нет | Доступ на машине (по умолчанию: `false`) |
| ~~`cost`~~ | ~~integer~~ | ~~Нет~~ | ~~УДАЛЕНО: Теперь все платежи через донаты~~ |
| `reward_amount` | integer | Нет | Награда в Joycoin (для Speed Clean-up) |
| `start_date` | datetime | **Да (для speedCleanup)** | Дата начала работы. **Обязательно для `speedCleanup`**, опционально для `event` |
| `end_date` | datetime | **Да (для speedCleanup)** | Дата окончания работы. **Обязательно для `speedCleanup`**, опционально для `event` |
| `status` | string | Нет | Статус заявки. **Важно:** Статус по умолчанию зависит от типа заявки:<br>- `wasteLocation`: `new` (по умолчанию)<br>- `speedCleanup`: `new` (по умолчанию) или `inProgress` (если передано явно при создании)<br>- `event`: `inProgress` (автоматически при создании)<br><br>**Возможные статусы:**<br>- `new` - создана, ожидает присоединения<br>- `inProgress` - в процессе выполнения<br>- `pending` - ожидает рассмотрения модератором<br>- `approved` - одобрена модератором<br>- `rejected` - отклонена модератором<br>- `archived` - архивирована (после выплат и окончания срока)<br><br>**Логика статусов:**<br>- Для `wasteLocation`: при присоединении исполнителя статус меняется на `inProgress`<br>- Для `speedCleanup`: при одобрении (`approved`) проверяется разница между `start_date` и `end_date`. Если >= 20 минут, начисляется коин создателю. Автоархив по срокам и крону — см. [Автоматические сроки (SLA) и cron](#автоматические-сроки-sla-и-cron).<br>- Для `event`: при создании статус сразу `inProgress`, создатель автоматически добавляется в участники<br><br>**ВАЖНО:** Статус `pending_payment` удален. Теперь все платежи идут через донаты, заявка создается сразу со стандартным статусом |
| `priority` | string | Нет | Приоритет: `low`, `medium`, `high`, `urgent` (по умолчанию: `medium`) |
| `target_amount` | integer | Нет | Целевая сумма для выполнения заявки |
| `plant_tree` | boolean | Нет | Флаг "посадить дерево" (для Event, по умолчанию: `false`) |
| `trash_pickup_only` | boolean | Нет | Флаг "только вывоз мусора" (для Waste Location, по умолчанию: `false`) |
| `from_external_source` | boolean | Нет | **`true`** — заявка создана из внешнего источника (например, после импорта Earth Day cleanups). В API при создании: передать **`true`** может только **суперадмин** (`isSuperAdmin` в JWT); иначе **403**. Обычные пользователи всегда получают **`false`**. В ответах списка и деталей поле всегда присутствует. Для внешних заявок фото из source-полей (`image_url`, `image_urls`, `photo_url`, `photo_urls`, `photos`) нормализуются и сохраняются в `photos_before`; в ответе клиент получает их также в `photos`. |
| `earthday_cleanup_objectid` | integer или null | Нет | Связь с **`earthday_cleanups.objectid`** (только если заявка из парсинга Earth Day). Задаётся при создании вместе с **`from_external_source: true`** (суперадмин). В ответах API — только чтение. При удалении заявки флаг **`used_for_internal_request`** у строки импорта сбрасывается, если нет другой заявки с тем же id. |
| `work_duration_minutes` | integer или null | Нет | **Только `speedCleanup`:** длительность работы в целых минутах, задаётся клиентом (интервал таймера `start_date`–`end_date`). Принимается при **POST/PUT** заявки (см. ниже); в ответах списка и деталей заявки поле всегда нормализуется (`null`, если не задано). Для **event** и **wasteLocation** минуты хранятся в **`participant_completions[userId].work_duration_minutes`**, а не в этой колонке. |
| `rejection_reason` | string | Нет | Причина отклонения заявки (стандартное или кастомное сообщение, только чтение) |
| `rejection_message` | string | Нет | Кастомное сообщение от модератора при отклонении (только для модераторов) |
| `actual_participants` | array[string] | Нет | Массив ID реальных участников события (только для `event`, заполняется заказчиком при закрытии события). **Важно:** Все ID должны быть UUID из базы данных (поле `id` из таблицы `users`), не Firebase UID. |
| `registered_participants` | array[string] | Нет | Массив ID всех зарегистрированных участников события (только для `event`, заполняется автоматически при участии). **Важно:** Все ID должны быть UUID из базы данных (поле `id` из таблицы `users`), не Firebase UID. |
| `is_open` | boolean | Нет | Открыта ли заявка (только чтение, по умолчанию: `true`) |
| `created_by` | string | Нет | ID создателя (автоматически, только чтение). **Важно:** UUID из базы данных (поле `id` из таблицы `users`), не Firebase UID. |
| `taken_by` | string | Нет | ID исполнителя (только чтение). **Важно:** UUID из базы данных (поле `id` из таблицы `users`), не Firebase UID. |
| `total_contributed` | integer | Нет | Общая сумма собранных средств (только чтение, из таблицы donations) |
| `joined_user_id` | string | Нет | ID пользователя, присоединившегося к заявке (только чтение). **Важно:** UUID из базы данных (поле `id` из таблицы `users`), не Firebase UID. При обновлении заявки можно установить `null` для отсоединения. |
| `join_date` | datetime | Нет | Дата присоединения (только чтение) |
| `expires_at` | datetime | Нет | Дата истечения заявки (только для `wasteLocation`, автоматически устанавливается при создании: `created_at + 7 дней`, только чтение) |
| `extended_count` | integer | Нет | Количество продлений заявки (только для `wasteLocation`, максимум 1, только чтение) |
| `completion_comment` | string | Нет | Комментарий при завершении (только чтение) |
| `participant_completions` | object | Нет | JSON объект с данными закрытия работы участниками (только для `wasteLocation` и `event`, только чтение). Ключ - `userId` (UUID), значение - объект с полями:<br>- `status`: `"inProgress"` \| `"pending"` \| `"rejected"` \| `"approved"`<br>- `photos_after`: array[string] - массив URL фотографий "после" работы<br>- `completion_comment`: string - комментарий участника<br>- `completion_latitude`: number - широта координат при закрытии<br>- `completion_longitude`: number - долгота координат при закрытии<br>- `rejection_reason`: string - причина отказа (только для `rejected`)<br>- `completed_at`: datetime - дата и время закрытия работы<br>- `work_duration_minutes`: integer \| null — целые минуты с клиента при **POST** `/participant-completion` (**event**: от `start_date` до сдачи; **waste**: фикс с клиента, напр. 15) |
| `group_chat_id` | string (UUID) | Нет | ID группового чата заявки (автоматически создается при создании заявки, только чтение). Групповой чат создается сразу при создании заявки, в него автоматически добавляется создатель. |
| `private_chats` | array[object] | Нет | Массив приватных чатов для event заявок (только для `event`, только чтение). Каждый элемент содержит:<br>- `chat_id`: string (UUID) - ID приватного чата<br>- `user_id`: string (UUID) - ID участника, с которым создан приватный чат (между участником и создателем заявки)<br><br>**Важно:** Приватные чаты создаются автоматически при участии в event заявке (POST /api/requests/:id/participate) и удаляются при отмене участия (DELETE /api/requests/:id/participate). |
| `approved_at` | datetime или null | Нет | Время перевода в **`approved`** (сервер выставляет **`NOW()`** при одобрении модератором). Используется для выплат и пост-апрув логики. **Только чтение.** |
| `submitted_for_review_at` | datetime или null | Нет | Момент отправки на модерацию (**переход в `pending`**): **waste** — при `POST …/participant-completion`; **event** — при `POST …/close-by-creator`; **speedCleanup** — при **PUT**, если статус меняется на `pending`. Сбрасывается в **`null`** при **`approved`** / **`rejected`**. Для записей **pending**, созданных до появления колонки, при миграции может быть проставлено из **`updated_at`**. **Только чтение.** См. [Автоматические сроки (SLA) и cron](#автоматические-сроки-sla-и-cron). |
| `created_at` | datetime | Нет | Дата создания (только чтение) |
| `updated_at` | datetime | Нет | Дата обновления (только чтение) |

#### Пример полной модели Request (ответ от сервера):

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "353f958d-8796-44c7-a877-3e376eca6784",
  "category": "wasteLocation",
  "name": "Мусор в парке",
  "description": "Большая куча мусора возле входа в парк",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "photos_before": [
    "https://joypick.world/uploads/photos/uuid1.jpg",
    "https://joypick.world/uploads/photos/uuid2.jpg"
  ],
  "photos_after": [],
  "garbage_size": 2,
  "waste_types": ["plastic", "paper"],
  "only_foot": false,
  "possible_by_car": true,
  "cost": 500,
  "reward_amount": null,
  "start_date": null,
  "end_date": null,
  "status": "pending",
  "priority": "medium",
  "target_amount": null,
  "plant_tree": false,
  "trash_pickup_only": false,
  "from_external_source": false,
  "is_open": true,
  "created_by": "353f958d-8796-44c7-a877-3e376eca6784",
  "taken_by": null,
  "total_contributed": 0,
  "registered_participants": [],
  "actual_participants": [],
  "joined_user_id": null,
  "join_date": null,
  "completion_comment": null,
  "participant_completions": {},
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

---

### Модель Partner (Партнер)

**Важно:** Все поля в API используют **snake_case** (как в базе данных). При отправке и получении данных используйте `snake_case` формат.

#### Поля модели:

| Поле (snake_case) | Тип | Обязательное | Описание |
|------------------|-----|--------------|----------|
| `id` | string (UUID) | Нет (автогенерация) | Уникальный идентификатор партнера |
| `name` | string | Да | Название партнера |
| `photo_urls` | array[string] | Нет | Массив URL фотографий партнера (JSON) |
| `latitude` | float | Нет | Широта местоположения |
| `longitude` | float | Нет | Долгота местоположения |
| `address` | string | Нет | Адрес партнера |
| `activity` | string | Нет | Деятельность партнера |
| `website_url` | string (URL) | Нет | URL сайта партнера |
| `created_at` | datetime | Нет | Дата создания (только чтение) |
| `updated_at` | datetime | Нет | Дата обновления (только чтение) |

#### Пример полной модели Partner (ответ от сервера):

```json
{
  "id": "660e8400-e29b-41d4-a716-446655440000",
  "name": "Эко-Магазин",
  "photo_urls": ["https://joypick.world/uploads/photos/uuid1.jpg"],
  "latitude": 55.7558,
  "longitude": 37.6173,
  "address": "г. Москва, ул. Экологическая, д. 1",
  "activity": "Продажа экологически чистых товаров",
  "website_url": "https://ecoshop.ru",
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

---

## 🔐 Аутентификация

### Регистрация

**POST** `/auth/register`

**Описание:**  
Отправка кода верификации на email. Пользователь создается только после успешной верификации кода через `/auth/verify-email`.

**Тело запроса:**
- Обязательные: `email`, `password`.
- Опциональные: `display_name`, `first_name`, `second_name`, `phone_number`, `city`, `country`, `gender`.
- **Текст письма (по языку с фронта):** опционально передать `email_subject`, `email_html`, `email_text`. В строках можно использовать плейсхолдеры: `{{code}}` — код верификации, `{{logo_url}}` — URL логотипа приложения. Если не переданы — используется письмо по умолчанию (русский).

```json
{
  "email": "user@example.com",
  "password": "password123",
  "display_name": "Имя пользователя",
  "first_name": "Имя",
  "second_name": "Фамилия",
  "phone_number": "+1234567890",
  "city": "Москва",
  "country": "Россия",
  "email_subject": "Verification code for Joy Pick",
  "email_html": "<p>Your code: {{code}}</p><img src=\"{{logo_url}}\" alt=\"Logo\" />",
  "email_text": "Your code: {{code}}",
  "gender": "male"
}
```

**Ответ (200) - успешная отправка кода:**
```json
{
  "success": true,
  "message": "Код верификации отправлен на email",
  "data": {
    "message": "Код верификации отправлен на email",
    "email": "user@example.com",
    "verificationExpiresAt": "2024-01-01T00:10:00.000Z"
  }
}
```

**Ответ (500) - ошибка отправки email:**
```json
{
  "success": false,
  "message": "Не удалось отправить код верификации на email",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "errorDetails": {
    "emailError": {
      "message": "Неверный пароль приложения Gmail...",
      "code": "EAUTH_GMAIL_PASSWORD",
      "response": "...",
      "details": "..."
    }
  }
}
```

**Важно:**
- Пользователь НЕ создается на этом этапе
- Код верификации (6 цифр) отправляется на email
- Код действителен в течение 10 минут
- Данные регистрации сохраняются временно до верификации
- После успешной верификации кода через `/auth/verify-email` создается пользователь и возвращается токен
- Если код не пришел, используйте `POST /auth/resend-verification` для повторной отправки

**Пример для Flutter:**
```dart
// Шаг 1: Регистрация - отправка кода на email
final registerResponse = await http.post(
  Uri.parse('$baseUrl/auth/register'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'email': email,
    'password': password,
    'display_name': displayName,
    'first_name': firstName,
    'second_name': secondName,
  }),
);

if (registerResponse.statusCode == 200) {
  // Код отправлен, переходим к верификации
  // Пользователь вводит код из email
  final code = '123456'; // Код, введенный пользователем
  
  // Шаг 2: Верификация кода и создание пользователя
  final verifyResponse = await http.post(
    Uri.parse('$baseUrl/auth/verify-email'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'email': email,
      'code': code,
    }),
  );
  
  final verifyData = jsonDecode(verifyResponse.body);
  if (verifyResponse.statusCode == 200) {
    final token = verifyData['data']['token'];
    final user = verifyData['data']['user'];
    // Сохраните токен и данные пользователя
  }
}
```

---

### Вход

**POST** `/auth/login`

**Тело запроса:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Ответ (200):**
```json
{
  "success": true,
  "message": "Вход выполнен успешно",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      "photo_url": null,
      "uid": "uuid",
      "phone_number": "+1234567890",
      "city": "Москва",
      "first_name": "Имя",
      "second_name": "Фамилия",
      "country": "Россия",
      "gender": "male",
      "count_performed": 0,
      "count_orders": 0,
      "jcoins": 0,
      "jcoins_spent": 0,
      "coins_from_created": 0,
      "coins_from_participation": 0,
      "stripe_id": null,
      "score": 0,
      "admin": false,
      "fcm_token": null,
      "auth_type": "email",
      "latitude": null,
      "longitude": null,
      "created_time": "2024-01-01T00:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Ошибка (401):**
```json
{
  "success": false,
  "message": "Неверный email или пароль"
}
```

---

### Единый вход для приложения (волонтёр / продавец)

**POST** `/auth/app-login`

Один роут для входа в приложение по логину и паролю. Бэкенд по логину определяет: только волонтёр (users.email), только продавец (partner_sellers.login) или оба. При одной роли проверяется пароль и возвращаются данные этой роли и поле `role`. Если логин есть и у волонтёра и у продавца — проверяется пароль у обоих; если подошёл одному — возвращается он; если обоим — приоритет у продавца; если ни одному — ошибка «Неверный пароль». В ответе всегда есть `role: 'volunteer'` или `role: 'seller'` и соответствующие данные (user или seller) + token.

**Тело (JSON):**
```json
{
  "login": "логин_или_email",
  "password": "пароль"
}
```

Для волонтёра в качестве логина используется его **email** (как в users).

**Ответ (200) — волонтёр:**
```json
{
  "success": true,
  "message": "Вход выполнен успешно",
  "data": {
    "role": "volunteer",
    "token": "jwt_токен",
    "user": { "id": "uuid", "email": "...", "display_name": "...", ... }
  }
}
```

**Ответ (200) — продавец:**
```json
{
  "success": true,
  "message": "Вход выполнен",
  "data": {
    "role": "seller",
    "token": "jwt_токен",
    "seller": {
      "id": "uuid",
      "partnerId": "uuid",
      "partnerName": "Название партнёра",
      "fullName": "ФИО",
      "login": "логин",
      "jobTitle": "Должность"
    }
  }
}
```

**Ошибки:** `400` — валидация; `401` — неверный логин или пароль, или неверный пароль (в т.ч. когда логин найден у обеих ролей, но пароль ни к одной не подошёл); для OAuth-аккаунта — подсказка использовать вход через соцсети.

---

### Верификация email

**POST** `/auth/verify-email`

**Описание:**  
Проверка кода верификации и создание пользователя. После успешной верификации создается пользователь в базе данных и возвращается токен для авторизации.

**Тело запроса:**
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Ответ (200) - для новой регистрации:**
```json
{
  "success": true,
  "message": "Email успешно подтвержден. Пользователь создан.",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      "uid": "uuid",
      "email_verified": true,
      "created_time": "2024-01-01T00:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "verified": true
  }
}
```

**Ответ (200) - для существующего пользователя:**
```json
{
  "success": true,
  "message": "Email успешно подтвержден",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "email_verified": true
    },
    "verified": true
  }
}
```

**Ошибка (400):**
```json
{
  "success": false,
  "message": "Неверный код верификации"
}
```

**Ошибка (400):**
```json
{
  "success": false,
  "message": "Код верификации истек. Запросите новый код."
}
```

---

### Повторная отправка кода верификации

**POST** `/auth/resend-verification`

**Описание:**  
Повторная отправка кода верификации на email. Используйте, если код не пришел или истек. Работает как для новых регистраций (когда пользователь еще не создан), так и для существующих пользователей.

**Тело запроса:**
```json
{
  "email": "user@example.com"
}
```

**Ответ (200):**
```json
{
  "success": true,
  "message": "Код верификации отправлен",
  "data": {
    "message": "Код верификации отправлен на email",
    "verificationExpiresAt": "2024-01-01T00:10:00.000Z"
  }
}
```

**Ошибка (400):**
```json
{
  "success": false,
  "message": "Email уже подтвержден"
}
```

**Ошибка (404):**
```json
{
  "success": false,
  "message": "Пользователь с таким email не найден"
}
```

---

### Получение текущего пользователя

**GET** `/auth/me`

**Требует аутентификации**

Возвращает текущего пользователя со всеми полями модели User, включая `jcoins` (текущий баланс), `jcoins_spent` (всего списано коинов у партнёров), а также актуальный статус Stripe. При каждом запросе, если у пользователя есть Stripe-аккаунт, сервер запрашивает текущий статус в Stripe API и обновляет кэш в таблице `users`, поэтому поля `stripe_account_status`, `stripe_status_label`, `can_donate`, `can_receive_payouts`, `stripe_status_updated_at` в ответе всегда соответствуют данным Stripe. Отдельный вызов `GET /api/stripe/account-status` для отображения статуса не нужен.

**Ответ (200):**
```json
{
  "success": true,
  "message": "Успешно",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      "stripe_account_status": "complete",
      "stripe_status_label": "Account ready",
      "can_donate": true,
      "can_receive_payouts": true,
      "stripe_status_updated_at": "2024-01-15T12:00:00.000Z",
      // ... остальные поля пользователя
    }
  }
}
```

---

### Обновление токена

**POST** `/auth/refresh`

**Требует аутентификации**

**Ответ (200):**
```json
{
  "success": true,
  "message": "Токен обновлен",
  "data": {
    "token": "новый_jwt_token"
  }
}
```

---

### Авторизация через Firebase (Google Sign In, Apple Sign In и другие провайдеры)

**POST** `/auth/firebase`

**Описание:**  
Этот эндпоинт позволяет авторизоваться через Firebase с различными провайдерами:
- **Google Sign In** - авторизация через Google аккаунт
- **Apple Sign In** - авторизация через Apple ID
- **GitHub Sign In** - авторизация через GitHub
- **Phone Authentication** - авторизация по номеру телефона
- **Email/Password** - стандартная авторизация через email и пароль

После успешной авторизации в Firebase на клиенте, отправьте Firebase ID Token на сервер, и получите серверный JWT токен для дальнейшей работы с API.

**Поддерживаемые типы авторизации (`auth_type`):**
- `google` - Google Sign In
- `apple` - Apple Sign In
- `github` - GitHub Sign In
- `phone` - Phone Authentication
- `email` - Email/Password

**Настройка на сервере:**  
Перед использованием этого эндпоинта необходимо настроить Firebase Admin SDK на сервере.  
Подробные инструкции см. в файле [FIREBASE_SETUP.md](./FIREBASE_SETUP.md)

**Тело запроса:**
```json
{
  "idToken": "firebase_id_token_here",
  "first_name": "Иван",      // опционально, рекомендуется для Apple Sign In при первом входе
  "second_name": "Иванов"    // опционально, рекомендуется для Apple Sign In при первом входе
}
```

**Примечание:**  
Поля `first_name` и `second_name` особенно полезны для Apple Sign In, так как Apple предоставляет `givenName` и `familyName` только при первом входе и они не сохраняются в Firebase User. Рекомендуется передавать их с фронта при первой авторизации через Apple.

**Ответ (200):**
```json
{
  "success": true,
  "message": "Авторизация через Firebase выполнена успешно",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      "photo_url": "https://example.com/photo.jpg",
      "uid": "firebase_uid",
      "auth_type": "google",
      // ... все остальные поля пользователя
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Ошибка (401):**
```json
{
  "success": false,
  "message": "Недействительный Firebase токен"
}
```

**Ошибка (400):**
```json
{
  "success": false,
  "message": "Ошибка валидации",
  "errors": [
    {
      "msg": "Firebase ID Token обязателен",
      "param": "idToken"
    }
  ]
}
```

**Пример для Flutter:**

```dart
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String baseUrl = 'https://joypick.world/api';
  final FlutterSecureStorage _storage = FlutterSecureStorage();

  /// Авторизация через Firebase (Google Sign In, Apple Sign In и др.)
  /// Вызывайте этот метод после успешной авторизации в Firebase
  /// 
  /// [first_name] и [second_name] - опциональны, рекомендуется для Apple Sign In
  /// при первом входе, так как Apple предоставляет эти данные только один раз
  Future<Map<String, dynamic>?> signInWithFirebase({
    String? first_name,
    String? second_name,
  }) async {
    try {
      // Получаем Firebase ID Token
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) {
        throw Exception('Пользователь не авторизован в Firebase');
      }

      // Получаем свежий токен (forceRefresh: true для получения нового токена)
      final idToken = await user.getIdToken(true);
      
      // Формируем тело запроса
      final requestBody = {'idToken': idToken};
      if (first_name != null && first_name.isNotEmpty) {
        requestBody['first_name'] = first_name;
      }
      if (second_name != null && second_name.isNotEmpty) {
        requestBody['second_name'] = second_name;
      }
      
      // Отправляем токен на сервер
      final response = await http.post(
        Uri.parse('$baseUrl/auth/firebase'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(requestBody),
      );

      final data = jsonDecode(response.body);

      if (data['success'] == true) {
        // Сохраняем серверный JWT токен
        final serverToken = data['data']['token'];
        await _storage.write(key: 'auth_token', value: serverToken);
        
        return data['data'];
      } else {
        throw Exception(data['message'] ?? 'Ошибка авторизации');
      }
    } catch (e) {
      print('Ошибка авторизации через Firebase: $e');
      return null;
    }
  }

  /// Получение сохраненного токена
  Future<String?> getToken() async {
    return await _storage.read(key: 'auth_token');
  }

  /// Использование токена в API запросах
  Future<Map<String, dynamic>> makeAuthenticatedRequest(
    String method,
    String endpoint, {
    Map<String, dynamic>? body,
  }) async {
    final token = await getToken();
    if (token == null) {
      throw Exception('Токен не найден. Требуется авторизация.');
    }

    final headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };

    final uri = Uri.parse('$baseUrl$endpoint');
    http.Response response;

    switch (method.toUpperCase()) {
      case 'GET':
        response = await http.get(uri, headers: headers);
        break;
      case 'POST':
        response = await http.post(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      case 'PUT':
        response = await http.put(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      case 'DELETE':
        response = await http.delete(uri, headers: headers);
        break;
      default:
        throw Exception('Неподдерживаемый метод: $method');
    }

    return jsonDecode(response.body);
  }
}
```

**Интеграция с существующим кодом авторизации:**

**Для Google Sign In:**
```dart
// В вашем коде авторизации через Google (например, в authorization_widget.dart)
// После успешной авторизации в Firebase:

final user = await authManager.signInWithGoogle(context);
if (user != null) {
  // Ждем пока currentUserDocument будет создан
  int attempts = 0;
  while (currentUserDocument == null && attempts < 20) {
    await Future.delayed(const Duration(milliseconds: 100));
    attempts++;
  }

  // ВАЖНО: Теперь отправляем Firebase токен на сервер
  // Для Google first_name и second_name не обязательны - они будут распарсены из display_name
  final authService = AuthService();
  final serverAuthResult = await authService.signInWithFirebase();
  
  if (serverAuthResult != null) {
    // Авторизация успешна, серверный токен сохранен
    // auth_type будет автоматически установлен в 'google'
    // first_name и second_name будут распарсены из display_name
    print('✅ Авторизация через сервер выполнена успешно');
    print('📱 Auth type: ${serverAuthResult['user']['auth_type']}'); // 'google'
  } else {
    print('❌ Ошибка авторизации на сервере');
  }
}
```

**Для Apple Sign In:**
```dart
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

// В вашем коде авторизации через Apple (например, в authorization_widget.dart)
// После успешной авторизации в Firebase:

// ВАЖНО: Для Apple нужно сохранить givenName и familyName ДО авторизации в Firebase,
// так как они доступны только при первом входе
String? appleFirstName;
String? appleSecondName;

// Генерируем nonce для безопасности
final rawNonce = generateNonce();
final nonce = sha256ofString(rawNonce);

// Запрашиваем credential от Apple
final appleCredential = await SignInWithApple.getAppleIDCredential(
  scopes: [
    AppleIDAuthorizationScopes.email,
    AppleIDAuthorizationScopes.fullName, // ВАЖНО: запрашиваем fullName
  ],
  nonce: nonce,
);

// Сохраняем имя и фамилию ДО авторизации в Firebase
// (они доступны только при первом входе!)
appleFirstName = appleCredential.givenName;
appleSecondName = appleCredential.familyName;

// Создаем OAuth credential для Firebase
final oauthCredential = OAuthProvider("apple.com").credential(
  idToken: appleCredential.identityToken,
  rawNonce: rawNonce,
  accessToken: appleCredential.authorizationCode,
);

// Авторизуемся в Firebase
final userCredential = await FirebaseAuth.instance.signInWithCredential(oauthCredential);

// Обновляем displayName в Firebase (если есть)
if (appleFirstName != null || appleSecondName != null) {
  final displayName = [appleFirstName, appleSecondName]
      .where((name) => name != null && name.isNotEmpty)
      .join(' ');
  if (displayName.isNotEmpty) {
    await userCredential.user?.updateDisplayName(displayName);
  }
}

// Ждем пока currentUserDocument будет создан
int attempts = 0;
while (currentUserDocument == null && attempts < 20) {
  await Future.delayed(const Duration(milliseconds: 100));
  attempts++;
}

// ВАЖНО: Отправляем Firebase токен на сервер С именами из Apple
final authService = AuthService();
final serverAuthResult = await authService.signInWithFirebase(
  first_name: appleFirstName,  // Передаем имя из Apple
  second_name: appleSecondName, // Передаем фамилию из Apple
);

if (serverAuthResult != null) {
  // Авторизация успешна, серверный токен сохранен
  // auth_type будет автоматически установлен в 'apple'
  // first_name и second_name будут сохранены в базе данных
  print('✅ Авторизация через Apple выполнена успешно');
  print('📱 Auth type: ${serverAuthResult['user']['auth_type']}'); // 'apple'
  print('👤 Имя: ${serverAuthResult['user']['first_name']}');
  print('👤 Фамилия: ${serverAuthResult['user']['second_name']}');
} else {
  print('❌ Ошибка авторизации на сервере');
}
```

**Важно для Apple Sign In:**
- `givenName` и `familyName` доступны **только при первом входе** через Apple
- Их нужно сохранить **ДО** авторизации в Firebase
- Передайте их в `signInWithFirebase(first_name: ..., second_name: ...)`
- Если не передать, сервер попытается распарсить `display_name`, но это менее надежно

**Важно для Apple Sign In:**
- Apple может не предоставить email при первом входе (пользователь может скрыть email)
- В этом случае сервер создаст пользователя с `email = null` или использует скрытый email от Apple
- При последующих входах email может быть предоставлен
- Сервер автоматически обновит email, если он станет доступен
- **`givenName` и `familyName` доступны только при первом входе** - передайте их в `first_name` и `second_name` для сохранения в базе данных

**Какие данные получаются автоматически:**

При первой авторизации сервер автоматически получает и сохраняет следующие данные:

**Из Firebase ID Token:**
- ✅ `uid` - Firebase UID (сохраняется как `uid` в базе)
- ✅ `email` - Email пользователя (может быть null для Apple)
- ✅ `name` - Полное имя (сохраняется как `display_name`)
- ✅ `picture` - URL фото (сохраняется как `photo_url`)
- ✅ `email_verified` - Подтвержден ли email

**Через Firebase Admin SDK (дополнительно):**
- ✅ `phone_number` - Номер телефона (если есть, сохраняется как `phone_number`)

**Автоматический парсинг:**
- ✅ `first_name` - Первое слово из `display_name` (если не передано с фронта)
- ✅ `second_name` - Остальные слова из `display_name` (если не передано с фронта)

**Рекомендуется передавать с фронта (особенно для Apple):**
- ✅ `first_name` - Имя пользователя (для Apple - из `appleCredential.givenName`)
- ✅ `second_name` - Фамилия пользователя (для Apple - из `appleCredential.familyName`)

**Автоматически определяется:**
- ✅ `auth_type` - Тип авторизации (`google`, `apple`, `github`, `phone`, `email`)

**Важные замечания:**

1. **Firebase ID Token** получается через `FirebaseAuth.instance.currentUser?.getIdToken(true)`
   - Параметр `true` означает принудительное обновление токена
   - Firebase токены обновляются автоматически каждые час

2. **Серверный JWT токен** используется для всех последующих API запросов
   - Сохраняйте его в `flutter_secure_storage`
   - Добавляйте в заголовок `Authorization: Bearer <token>`

3. **Синхронизация пользователей:**
   - Если пользователь уже существует в базе (по `uid` или `email`), данные обновляются
   - Если пользователь новый, создается запись в базе данных
   - Поле `uid` в базе данных соответствует Firebase UID

4. **Типы авторизации (`auth_type`):**
   - `google` - Google Sign In
   - `apple` - Apple Sign In
   - `github` - GitHub Sign In
   - `phone` - Phone Authentication
   - `email` - Email/Password (стандартная регистрация)

5. **Обработка ошибок:**
   - Если Firebase токен недействителен, вернется 401
   - Если токен истек, получите новый через `getIdToken(true)`
   - При ошибках сети обрабатывайте исключения

---

## 👤 Пользователи

### Получение списка пользователей (только для админов)

**GET** `/users`

**Требует аутентификации и прав администратора**

Получение списка пользователей с пагинацией.

**Query параметры:**
- `page` (integer, опционально) - номер страницы (по умолчанию: 1)
- `limit` (integer, опционально) - количество записей на странице (по умолчанию: 20, максимум: 100)
- `search` (string, опционально) - поиск по email, display_name, first_name, second_name

---

### Получение всех пользователей списком

**GET** `/users/all`

**Требует аутентификации и прав администратора**

Получение всех пользователей сразу списком без пагинации.

**Query параметры:**
- `search` (string, опционально) - поиск по email, display_name, first_name, second_name

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "display_name": "Имя пользователя",
        "photo_url": "https://...",
        "uid": "firebase-uid",
        "phone_number": "+79001234567",
        "city": "Москва",
        "first_name": "Имя",
        "second_name": "Фамилия",
        "country": "Россия",
        "gender": "male",
        "count_performed": 5,
        "count_orders": 3,
        "jcoins": 1000,
        "coins_from_created": 500,
        "coins_from_participation": 500,
        "stripe_id": null,
        "score": 4.5,
        "admin": 0,
        "fcm_token": "token",
        "auth_type": "email",
        "latitude": 55.7558,
        "longitude": 37.6173,
        "created_time": "2025-01-01T00:00:00.000Z",
        "about": "О себе",
        "social_links": [
          "https://twitter.com/username",
          "https://instagram.com/username"
        ]
      }
    ],
    "total": 150
  }
}
```

**Ошибки:**
- `401` - Не авторизован
- `403` - Нет прав администратора
- `500` - Ошибка сервера (с детальной информацией об ошибке)

**Пример использования в Flutter:**
```dart
Future<Map<String, dynamic>> getAllUsers({
  required String token,
  String? search,
}) async {
  final queryParams = <String, String>{};
  
  if (search != null && search.isNotEmpty) {
    queryParams['search'] = search;
  }
  
  final uri = Uri.parse('https://joypick.world/api/users/all')
      .replace(queryParameters: queryParams);
  
  final response = await http.get(
    uri,
    headers: {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  );
  
  if (response.statusCode == 200) {
    return json.decode(response.body);
  } else {
    throw Exception('Ошибка получения всех пользователей: ${response.body}');
  }
}
```

---

**Ответ для GET /users (с пагинацией) (200):**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "display_name": "Имя пользователя",
        "photo_url": "https://...",
        "uid": "firebase-uid",
        "phone_number": "+79001234567",
        "city": "Москва",
        "first_name": "Имя",
        "second_name": "Фамилия",
        "country": "Россия",
        "gender": "male",
        "count_performed": 5,
        "count_orders": 3,
        "jcoins": 1000,
        "coins_from_created": 500,
        "coins_from_participation": 500,
        "stripe_id": null,
        "score": 4.5,
        "admin": 0,
        "fcm_token": "token",
        "auth_type": "email",
        "latitude": 55.7558,
        "longitude": 37.6173,
        "created_time": "2025-01-01T00:00:00.000Z",
        "about": "О себе",
        "social_links": [
          "https://twitter.com/username",
          "https://instagram.com/username"
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

**Ошибки:**
- `401` - Не авторизован
- `403` - Нет прав администратора
- `500` - Ошибка сервера (с детальной информацией об ошибке)

**Пример использования в Flutter (с пагинацией):**
```dart
Future<Map<String, dynamic>> getUsersList({
  required String token,
  int page = 1,
  int limit = 20,
  String? search,
}) async {
  final queryParams = <String, String>{
    'page': page.toString(),
    'limit': limit.toString(),
  };
  
  if (search != null && search.isNotEmpty) {
    queryParams['search'] = search;
  }
  
  final uri = Uri.parse('https://joypick.world/api/users')
      .replace(queryParameters: queryParams);
  
  final response = await http.get(
    uri,
    headers: {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  );
  
  if (response.statusCode == 200) {
    return json.decode(response.body);
  } else {
    throw Exception('Ошибка получения списка пользователей: ${response.body}');
  }
}
```

---

### Сводка засчитанного времени работы (текущий пользователь)

**GET** `/users/me/work-duration`

**Требует аутентификации**

Список заявок, по которым для **текущего** пользователя на бэкенде засчитаны минуты работы, плюс **общая сумма минут** по всем таким заявкам (сумма считается по полному набору, не только по текущей странице).

**Query-параметры:**
- `page` (integer, опционально) — страница, по умолчанию `1`
- `limit` (integer, опционально) — размер страницы, по умолчанию `20`, максимум `100`

**Правила «засчитано» (бэкенд):**
- **`speedCleanup`:** заявка в статусе `approved` или `archived`; пользователь — `created_by` или `joined_user_id`; в заявке задано **`work_duration_minutes`** (колонка в `requests`).
- **`wasteLocation`:** заявка `approved` или `archived`; пользователь — исполнитель (`joined_user_id`); минуты в **`participant_completions[userId].work_duration_minutes`**.
- **`event`:** заявка `approved` или `archived`; пользователь среди участников; в **`participant_completions[userId]`** статус **`approved`** и задано **`work_duration_minutes`**.

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "request_id": "550e8400-e29b-41d4-a716-446655440000",
        "category": "event",
        "status": "approved",
        "name": "Экологическое событие",
        "work_duration_minutes": 90,
        "start_date": "2025-12-01T10:00:00.000Z",
        "end_date": "2025-12-01T18:00:00.000Z",
        "updated_at": "2025-12-02T12:00:00.000Z",
        "source": "participant_completion"
      }
    ],
    "total_work_duration_minutes": 1234,
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "totalPages": 1
    }
  }
}
```

- **`source`:** `request` — значение с колонки заявки (**speed**); `participant_completion` — из JSON участника (**event** / **waste**).

**Ошибки:** `401` — не авторизован; `500` — ошибка сервера.

---

### Получение пользователя по ID

**GET** `/users/:id`

**Требует аутентификации** (можно получить только свои данные или админ)

При каждом запросе, если у запрашиваемого пользователя есть Stripe-аккаунт, сервер обновляет статус из Stripe API, поэтому поля `stripe_account_status`, `stripe_status_label`, `can_donate`, `can_receive_payouts`, `stripe_status_updated_at` в ответе актуальны. В объекте `user` возвращаются все поля модели User.

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      "stripe_account_status": "complete",
      "can_donate": true,
      "can_receive_payouts": true,
      "stripe_status_updated_at": "2024-01-15T12:00:00.000Z",
      "stripe_status_label": "Account ready",
      // ... остальные поля
    }
  }
}
```

---

### Обновление пользователя

**PUT** `/users/:id`

**Требует аутентификации**

После обновления сервер подтягивает статус Stripe из API (если у пользователя есть аккаунт) и возвращает объект `user` со всеми полями модели User, включая `stripe_account_status`, `stripe_status_label`, `can_donate`, `can_receive_payouts`, `stripe_status_updated_at`.

**Поддерживает два способа отправки:**

1. **JSON с URL фотографии** (для обратной совместимости)
2. **multipart/form-data с файлом** (рекомендуется)

**Способ 1: JSON с URL**

**Content-Type:** `application/json`

**Тело запроса:**
```json
{
  "display_name": "Новое имя",
  "first_name": "Имя",
  "second_name": "Фамилия",
  "phone_number": "+1234567890",
  "city": "Санкт-Петербург",
  "country": "Россия",
  "gender": "female",
  "photo_url": "https://example.com/photo.jpg",
  "latitude": 59.9343,
  "longitude": 30.3351,
  "fcm_token": "fcm_token_here",
  "about": "Информация о себе",
  "social_links": [
    "https://twitter.com/username",
    "https://instagram.com/username",
    "https://facebook.com/username"
  ]
}
```

**Способ 2: multipart/form-data с файлом**

**Content-Type:** `multipart/form-data`

**Поля формы:**
- `display_name` (string, опционально)
- `first_name` (string, опционально)
- `second_name` (string, опционально)
- `phone_number` (string, опционально)
- `city` (string, опционально)
- `country` (string, опционально)
- `gender` (string, опционально)
- `photo` (file, опционально) - файл аватара пользователя
- `latitude` (float, опционально)
- `longitude` (float, опционально)
- `fcm_token` (string, опционально)
- `about` (string, опционально) - информация о себе
- `social_links` (array[string], опционально) - массив ссылок на социальные сети

**Ограничения для файла:**
- Максимальный размер: 10MB
- Разрешенные форматы: JPEG, PNG, GIF, WebP

**Пример для Flutter:**

```dart
Future<void> updateUserAvatar({
  required String token,
  required String userId,
  required File avatarFile,
}) async {
  final uri = Uri.parse('https://joypick.world/api/users/$userId');
  final request = http.MultipartRequest('PUT', uri);
  
  request.headers['Authorization'] = 'Bearer $token';
  
  // Добавляем файл
  final fileStream = http.ByteStream(avatarFile.openRead());
  final length = await avatarFile.length();
  final multipartFile = http.MultipartFile(
    'photo',
    fileStream,
    length,
    filename: path.basename(avatarFile.path),
  );
  request.files.add(multipartFile);
  
  // Отправка
  final streamedResponse = await request.send();
  final response = await http.Response.fromStream(streamedResponse);
  
  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    print('Аватар обновлен: ${data['data']['user']['photo_url']}');
  }
}
```

**Ответ (200):**
```json
{
  "success": true,
  "message": "Данные пользователя обновлены",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя",
      "stripe_account_status": "complete",
      "stripe_status_label": "Account ready",
      "can_donate": true,
      "can_receive_payouts": true,
      "stripe_status_updated_at": "2024-01-15T12:00:00.000Z",
      "fcm_token": "...",
      "photo_url": "...",
      "city": "...",
      "first_name": "...",
      "second_name": "...",
      "country": "...",
      "gender": "...",
      "count_performed": 0,
      "count_orders": 0,
      "jcoins": 0,
      "jcoins_spent": 0,
      "coins_from_created": 0,
      "coins_from_participation": 0,
      "stripe_id": "acct_xxx",
      "score": 0,
      "admin": false,
      "super_admin": false,
      "auth_type": "email",
      "latitude": 0,
      "longitude": 0,
      "created_time": "...",
      "about": null,
      "social_links": []
    }
  }
}
```

---

### Обновление Joycoins (только админ)

**PUT** `/users/:id/jcoins`

**Требует аутентификации и прав администратора**

**Тело запроса:**
```json
{
  "jcoins": 100,
  "operation": "add"  // "set", "add", "subtract"
}
```

---

## 📋 Заявки (Requests)

### Получение списка заявок

**GET** `/requests`

**Query параметры:**
- `page` (int, default: 1) - номер страницы
- `limit` (int, default: 20) - количество на странице
- `category` (string) - фильтр: `wasteLocation`, `speedCleanup`, `event`
- `status` (string, опционально) - фильтр по статусу: `new`, `inProgress`, `pending`, `approved`, `rejected`, `archived`. Если не указан — возвращаются заявки с **любым** статусом (включая архивные и ожидающие оплаты).
- `city` (string) - фильтр по городу
- `latitude` (float) - широта для поиска по радиусу
- `longitude` (float) - долгота для поиска по радиусу
- `radius` (int, default: 10000) - радиус в метрах
- `is_open` (boolean) - фильтр по открытости
- `user_id` (string) - фильтр по пользователю
- `created_by` (string) - фильтр по создателю
- `taken_by` (string) - фильтр по исполнителю
- `search` (string, опционально) — подстрока **без учёта регистра** (регистронезависимое сравнение на стороне БД): совпадение **хотя бы** по полям **`name`**, **`description`**, **`city`** или по **`id`** (UUID в БД с дефисами; ввод **с дефисами или без** — ищется и в «разжатых» символах id). Условие **AND** с остальными фильтрами (`category`, `status`, `city`, гео и т.д.). Пустая строка или отсутствие параметра — как раньше. Максимум **50** символов; иначе **400**. Пагинация (`total`, `totalPages`) считается **после** применения `search`.

**Пример запроса:**
```
GET /api/requests?category=wasteLocation&city=Москва&page=1&limit=20
```

**С поиском:**
```
GET /api/requests?search=томск&page=1&limit=20
```

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "id": "uuid",
        "user_id": "uuid",
        "category": "wasteLocation",
        "name": "Название заявки",
        "description": "Описание",
        "latitude": 55.7558,
        "longitude": 37.6173,
        "city": "Москва",
        "garbage_size": 1,
        "only_foot": false,
        "possible_by_car": true,
        "cost": 1000,
        "reward_amount": null,
        "is_open": true,
        "start_date": null,
        "end_date": null,
        "status": "new",
        "priority": "medium",
        "assigned_to": null,
        "created_by": "uuid",
        "taken_by": null,
        "total_contributed": 0,
        "target_amount": null,
        "joined_user_id": null,
        "join_date": null,
        "payment_intent_id": null,
        "completion_comment": null,
        "plant_tree": false,
        "trash_pickup_only": false,
        "from_external_source": false,
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z",
        "photos_before": ["url1", "url2"],
        "photos_after": [],
        "waste_types": ["plastic", "glass"]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

---

### Получение моих заявок (создатель / исполнитель / донатер / участник)

**GET** `/requests/my`

**Требует аутентификации.**

Возвращает все заявки, где текущий пользователь является **создателем** (`created_by`), **исполнителем** (`taken_by`), **присоединившимся** (`joined_user_id` — для waste/speedCleanup), **донатером** (есть запись в `donations`) или **участником события** (в `actual_participants` / `registered_participants`). Любой тип заявки и любой статус (включая `archived`). Удобно для раздела «Мои заявки» в приложении.

**Query параметры:**
- `page` (int, default: 1) — номер страницы
- `limit` (int, default: 20, max: 100) — количество на странице
- `category` (string, опционально) — фильтр: `wasteLocation`, `speedCleanup`, `event`
- `status` (string, опционально) — фильтр: `new`, `inProgress`, `pending`, `approved`, `rejected`, `archived`

**Пример запроса:**
```
GET /api/requests/my?page=1&limit=20
Authorization: Bearer <jwt_token>
```

**Ответ (200):** такой же формат, как у `GET /requests` — `data.requests` (массив заявок) и `data.pagination`.

---

### Получение заявки по ID

**GET** `/requests/:id`

Для заявок **wasteLocation** / **speedCleanup** со статусом **pending** и с донатами в ответ добавляются поля ожидаемой выплаты исполнителю (после одобрения админом):
- `estimated_executor_payout_cents` (int или null) — сумма в центах;
- `estimated_executor_payout_dollars` (string или null) — сумма в долларах, например `"2.50"`.

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "request": {
      "id": "uuid",
      // ... все поля заявки
      "estimated_executor_payout_cents": 250,
      "estimated_executor_payout_dollars": "2.50",
      "registered_participants": ["user_id1", "user_id2"],
      "actual_participants": [],
      "donations": [
        {
          "id": "uuid",
          "request_id": "uuid",
          "user_id": "uuid",
          "amount": 1000,
          "payment_intent_id": "pi_xxx",
          "created_at": "2024-01-01T00:00:00.000Z"
        }
      ]
    }
  }
}
```

---

### Создание заявки

**POST** `/requests`

**Требует аутентификации**

**Важно:** Фотографии принимаются только в виде файлов через `multipart/form-data`. URL фотографий не принимаются.

**Content-Type:** `multipart/form-data`

**Поля формы:**
- Все поля заявки (как в JSON ниже) отправляются как поля формы
- `photos_before` (file[]) - массив файлов фотографий "до" уборки
- `photos_after` (file[]) - массив файлов фотографий "после" уборки

**Тело запроса (JSON поля):**
```json
{
  "category": "wasteLocation",
  "name": "Название заявки",
  "description": "Описание заявки",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "garbage_size": 1,
  "only_foot": false,
  "possible_by_car": true,
  "cost": 1000,
  "reward_amount": null,
  "start_date": null,
  "end_date": null,
  "status": "new",
  "priority": "medium",
  "waste_types": ["plastic", "glass"]
  "target_amount": null,
  "plant_tree": false,
  "trash_pickup_only": false,
  "from_external_source": false
}
```

**Импорт из Earth Day (суперадмин):** при создании заявки из данных `earthday_cleanups` передайте **`from_external_source`: `true`** (тот же запрос `POST /api/requests`, JWT суперадмина). Рекомендуется также передать **`earthday_cleanup_objectid`** (целое число = **`objectid`** строки в `earthday_cleanups`): тогда сервер сохранит связь, выставит **`used_for_internal_request = 1`** для этой строки (как при PATCH) и при **удалении** заявки снова сбросит флаг, чтобы парсинг снова попал в выборку. Поле допустимо **только** вместе с **`from_external_source: true`** и **только у суперадмина**. Отдельный **`PATCH .../earthday-cleanups-admin/:objectid`** при наличии **`earthday_cleanup_objectid`** в теле создания не обязателен (но повторный PATCH не мешает).

**Для Speed Cleanup:**
```json
{
  "category": "speedCleanup",
  "name": "Быстрая уборка",
  "description": "Описание",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "garbage_size": 2,
  "reward_amount": 50,
  "start_date": "2024-02-01T10:00:00.000Z",
  "end_date": "2024-02-01T10:25:00.000Z",
  "work_duration_minutes": 25,
  // photos_before и photos_after отправляются как файлы через multipart/form-data
  "waste_types": ["plastic"]
}
```

**Важно для Speed Cleanup:**
- Поля `start_date` и `end_date` **обязательны** для заявок типа `speedCleanup`
- Разница между `start_date` и `end_date` должна быть минимум 20 минут для начисления коина создателю при одобрении
- Формат дат: ISO 8601 (например: `"2024-02-01T10:00:00.000Z"`)
- **`work_duration_minutes`** (integer, опционально): целые минуты работы с клиента (длительность по таймеру между `start_date` и `end_date`). Допустимый диапазон на сервере: **0…10080** (7 суток). Для других категорий заявки не передавать (иначе **400**).

**Для Event:**
```json
{
  "category": "event",
  "name": "Экологическое событие",
  "description": "Описание",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "start_date": "2024-02-01T10:00:00.000Z",
  "end_date": "2024-02-01T18:00:00.000Z",
  "plant_tree": true
  // photos_before и photos_after отправляются как файлы через multipart/form-data
}
```

**Важно для Event:**
- При создании события статус автоматически устанавливается в `inProgress`
- Создатель события автоматически добавляется в `registered_participants`
- Другие пользователи могут присоединиться к событию через `POST /api/requests/:id/participate`
- При закрытии события заказчик указывает реальных участников в `actual_participants`

**Поля формы:**
- `category` (string, обязательное) - категория заявки
- `name` (string, обязательное) - название заявки
- `description` (string, обязательное если `integrity_enforce=true`, иначе опционально) - описание
- `integrity_enforce` (boolean/string, опционально) - `true`/`1`: проверка integrity на create, при провале 422; без поля — legacy (заявка создаётся)
- `locale` (string, опционально) — язык UI для текстов integrity (`en`, `ru`, `es`, …). **Рекомендуется** с `integrity_enforce=true` (тот же код, что в приложении). Без поля — `Accept-Language` или `en`. Legacy без `integrity_enforce` — поле не нужно.
- `latitude` (float, опционально) - широта
- `longitude` (float, опционально) - долгота
- `city` (string, опционально) - город
- `garbage_size` (integer, опционально) - размер мусора
- `only_foot` (boolean, опционально) - только пешком
- `possible_by_car` (boolean, опционально) - доступно на машине
- `cost` (integer, опционально) - стоимость
- `reward_amount` (integer, опционально) - размер награды
- `start_date` (string, **обязательно для speedCleanup**, опционально для event) - дата начала работы
- `end_date` (string, **обязательно для speedCleanup**, опционально для event) - дата окончания работы
- `status` (string, опционально) - статус. **Важно:** Статус по умолчанию зависит от типа заявки:<br>- `wasteLocation`: `new` (по умолчанию)<br>- `speedCleanup`: `new` (по умолчанию) или `inProgress` (если передано явно при создании)<br>- `event`: `inProgress` (автоматически при создании, создатель автоматически добавляется в участники)
- `priority` (string, опционально) - приоритет (по умолчанию: "medium")
- `waste_types` (array[string], опционально) - массив названий типов отходов (например: `["plastic", "glass"]`)
- `target_amount` (integer, опционально) - целевая сумма
- `plant_tree` (boolean, опционально) - посадить дерево
- `trash_pickup_only` (boolean, опционально) - только сбор мусора
- `from_external_source` (boolean, опционально) - пометка «из внешнего источника»; значение **`true`** / **`1`** допустимо **только у суперадмина**, иначе **403**
- `work_duration_minutes` (integer, опционально) — только для **`speedCleanup`**: см. блок «Важно для Speed Cleanup» выше
- `earthday_cleanup_objectid` (integer, опционально) - **`earthday_cleanups.objectid`** при создании из парсинга Earth Day; только с **`from_external_source: true`** и суперадмина; при удалении заявки соответствующая строка импорта снова становится доступной для создания заявок (если нет другой заявки с тем же id)
- `photos_before` (file[], опционально) - массив файлов для фото "до" уборки
- `photos_after` (file[], опционально) - массив файлов для фото "после" уборки
- Для `from_external_source=true` дополнительно можно передать URL-фото от источника в любом из полей: `image_url`, `image_urls`, `photo_url`, `photo_urls`, `photos` (строка, JSON-массив или array[string]). Бэкенд нормализует эти значения в массив URL и сохраняет в `photos_before` (и отдаёт в `photos`).

**Важно:**
- Фотографии принимаются **только в виде файлов** через `multipart/form-data`
- URL фотографий **не принимаются**

**Автоматические действия при создании заявки:**
- ✅ **Автоматически создается групповой чат** (`group`) для заявки любого типа (wasteLocation, speedCleanup, event)
- ✅ Создатель заявки автоматически добавляется в участники группового чата
- ✅ Групповой чат готов к использованию сразу после создания заявки
- ✅ Участники будут автоматически добавляться в групповой чат при:
  - Присоединении к заявке (waste) через `POST /api/requests/:id/join`
  - Участии в событии (event) через `POST /api/requests/:id/participate`
  - Донате через `POST /api/donations`
- Фотографии сохраняются на сервере, и в ответе возвращаются их URL

**Ограничения:**
- Максимальный размер файла: 10MB
- Разрешенные форматы: JPEG, PNG, GIF, WebP
- Максимум 10 файлов в каждом поле (photos_before, photos_after)

**Пример для Flutter (multipart/form-data):**

```dart
import 'package:http/http.dart' as http;
import 'dart:io';
import 'package:path/path.dart' as path;

Future<void> createRequestWithPhotos({
  required String token,
  required String name,
  required String category,
  List<File>? photos_before,
  List<File>? photos_after,
}) async {
  final uri = Uri.parse('https://joypick.world/api/requests');
  final request = http.MultipartRequest('POST', uri);
  
  // Заголовок авторизации
  request.headers['Authorization'] = 'Bearer $token';
  
  // Текстовые поля
  request.fields['name'] = name;
  request.fields['category'] = category;
  request.fields['description'] = 'Описание заявки';
  request.fields['city'] = 'Москва';
  request.fields['latitude'] = '55.7558';
  request.fields['longitude'] = '37.6173';
  
  // Файлы - фото "до"
  if (photos_before != null) {
    for (var photo in photos_before) {
      final fileStream = http.ByteStream(photo.openRead());
      final length = await photo.length();
      final multipartFile = http.MultipartFile(
        'photos_before',
        fileStream,
        length,
        filename: path.basename(photo.path),
      );
      request.files.add(multipartFile);
    }
  }
  
  // Файлы - фото "после"
  if (photos_after != null) {
    for (var photo in photos_after) {
      final fileStream = http.ByteStream(photo.openRead());
      final length = await photo.length();
      final multipartFile = http.MultipartFile(
        'photos_after',
        fileStream,
        length,
        filename: path.basename(photo.path),
      );
      request.files.add(multipartFile);
    }
  }
  
  // Отправка запроса
  final streamedResponse = await request.send();
  final response = await http.Response.fromStream(streamedResponse);
  
  if (response.statusCode == 201) {
    final data = jsonDecode(response.body);
    print('Заявка создана: ${data['data']['request']['id']}');
  } else if (jsonDecode(response.body)['errorCode'] == 'INTEGRITY_CHECK_FAILED') {
    // Заявка НЕ создана — показать data.integrity.issues
  }
}
```

#### Проверка integrity при создании

Перед записью в БД при `integrity_enforce` проверяются **название и описание** (правила + OpenRouter AI), **фото «до»** (для speed — обязательны; без AI). **Гео точки заявки на create не проверяется**. На **close** текст и фото **не** проверяются.

**Поле `integrity_enforce`** (multipart / JSON): единственный признак «проверять на create и не создавать при провале».

| Значение | Поведение |
|----------|-----------|
| не передано, пусто, `false`, `0` | Заявка **создаётся**; `description` может быть пустым (подставится из `name`); integrity на **`pending`** (модерация) |
| `true` / `1` | При провале integrity — **422**, заявка **не** создаётся; `description` обязателен |

**Ошибка (422)** — только если передано `integrity_enforce=true`:

```json
{
  "success": false,
  "errorCode": "INTEGRITY_CHECK_FAILED",
  "message": "Заявка не прошла проверку. Исправьте поля ниже.",
  "data": {
    "integrity": {
      "ok": false,
      "request_created": false,
      "locale": "ru",
      "summary": "… на языке пользователя …",
      "issues": [
        {
          "code": "GIBBERISH_NAME",
          "field": "name",
          "severity": "block",
          "message_key": "integrity_gibberish_name",
          "message": "… переведённый текст …",
          "source": "rules"
        }
      ]
    }
  }
}
```

Клиент: при `errorCode === 'INTEGRITY_CHECK_FAILED'` не считать заявку созданной; показать `issues[].message` у полей (`field`: `name`, `description`, `photos_before`, `location`).

**Язык:** передавайте **`locale`** с мобилки (код UI: `en`, `ru`, `zh`, …). Тексты ошибок — **`message_key`** / **`summary_key`** (ARB в приложении), сервер **не** переводит через Google. OpenRouter для текста: **title/description как есть** + `User app locale: …` в промпте (любой язык, в т.ч. китайский).

**Текст:** только при **create** с `integrity_enforce`: быстрые правила + **OpenRouter** (текст as-is, `User app locale: …` — en, ru, zh, …). На **close** и **pending** текст **не** проверяется. Ошибки — `message_key` / `summary_key` (ARB).

**Фото (AI indoor):** Vision OpenRouter — только на **`pending`** (автомодерация). На **create** — только правило «есть фото до» (speed). На **close** фото **не** проверяются (ни AI, ни дубликаты).

#### Проверка integrity при закрытии (сдача на модерацию)

Тот же **`integrity_enforce`** (`true` / `1`). Без поля — legacy: закрытие как раньше, проверка только в фоне на `pending`.

| Тип | Endpoint | Что проверяется при `integrity_enforce` |
|-----|----------|----------------------------------------|
| waste | `POST …/participant-completion` | гео в **200 м**, мин. 15 мин (фото **не** проверяются) |
| speed | `PUT …/requests/:id` → `status=pending` | **время:** от `start_date` в БД до `end_date`/момента сдачи, мин. **20** мин (`WORK_TOO_SHORT_SPEED`, `message_key`: `integrity_work_too_short_speed`). `work_duration_minutes` с клиента **не** используется, если в БД есть `start_date`. **Гео completion** для speed **не** проверяется (фото **не** проверяются). |
| event (участник) | `POST …/participant-completion` | гео в 200 м |
| event (заказчик) | `POST …/close-by-creator` | гео **всех** участников из `registered_participants` + создателя; опционально гео заказчика в том же запросе (фото **не** проверяются) |

При провале — **422** `INTEGRITY_CHECK_FAILED`, статус заявки **не** меняется на `pending` (остаётся `inProgress`). Сервер сохраняет причину в БД (`completion_integrity_*`).

**Поле в ответах заявки** (`GET /api/requests`, `GET /api/requests/:id`, деталка в админке модерации): объект `completion_integrity` или `null`:

```json
"completion_integrity": {
  "rejected": true,
  "rejected_at": "2026-05-25T12:00:00.000Z",
  "summary": "Краткий текст для UI",
  "issues": [{ "code": "WORK_TOO_SHORT_SPEED", "field": "work_duration_minutes", "message": "…" }],
  "primary_code": "WORK_TOO_SHORT_SPEED",
  "locale": "ru"
}
```

**`start_date` (speedCleanup):** после первой установки сервер **не сбрасывает** поле при resume/continue/`inProgress` без явного `start_date` в теле. Пустое значение в PATCH не затирает уже сохранённый `start_date`.

После **успешной** сдачи с `integrity_enforce` поля очищаются, `completion_integrity` → `null`, статус → `pending`. Это **не** модераторский `rejection_reason` (`status=rejected`).

**Push при `status=rejected`:** `data.type` = `request_rejected`, `requestId`, `primary_code`, `message_key` (напр. `integrity_work_too_short_speed`), `title_key`; в `body` — человекочитаемый текст, **не** сырой код `WORK_TOO_SHORT_SPEED`.

**GET `/api/requests/my`:** заявки со статусом `rejected` **включены** (в отличие от публичного `GET /requests` без `status`). `completion_integrity` видит только **создатель** заявки.

Показ баннера только создателю — на стороне мобильного клиента; API отдаёт поле всем, у кого есть доступ к заявке.

Поля (multipart): `integrity_enforce`, `locale`, `photos_after`, `completion_latitude`, `completion_longitude`, `work_duration_minutes` (где применимо).

**Ответ (201):**
```json
{
  "success": true,
  "message": "Заявка создана",
  "data": {
    "request": {
      "id": "uuid",
      "name": "Название заявки",
      "photos": ["https://joypick.world/uploads/photos/uuid1.jpg", "https://joypick.world/uploads/photos/uuid2.jpg"],
      "photos_before": ["https://joypick.world/uploads/photos/uuid3.jpg"],
      "photos_after": ["https://joypick.world/uploads/photos/uuid4.jpg"],
      // ... остальные поля
    },
    "group_chat": {
      "id": "uuid",
      "type": "group",
      "request_id": "uuid",
      "created_by": "uuid",
      "created_at": "2025-12-16T10:12:58.000Z",
      "participants": ["353f958d-8796-44c7-a877-3e376eca6784"],
      "participants_count": 1
    }
  }
}
```

**Поля ответа:**
- `request` - объект созданной заявки
- `group_chat` - информация о созданном групповом чате:
  - `id` - ID группового чата
  - `type` - тип чата (всегда `"group"`)
  - `request_id` - ID заявки, для которой создан чат
  - `created_by` - ID создателя чата (совпадает с создателем заявки)
  - `created_at` - дата создания чата
  - `participants` - массив ID участников чата (включая создателя)
  - `participants_count` - количество участников в чате

**Важно:**
- Файлы автоматически сохраняются на сервере в папке `uploads/photos/`
- Сервер генерирует уникальные имена файлов
- URL файлов автоматически подставляются в соответствующие поля заявки
- Файлы доступны по URL: `https://joypick.world/uploads/photos/{filename}`

---

### Создание доната от создателя

**ВАЖНО:** Endpoint `POST /api/requests/create-with-payment` удален. Теперь все платежи идут через донаты.

**Новый подход:**
1. Создайте заявку через `POST /api/requests` (без платежа)
2. Сразу после создания (или позже) создайте донат от создателя через `POST /api/donations`

**Пример:**
```dart
// 1. Создать заявку
final request = await createRequest(...);

// 2. Создать донат от создателя (можно сразу или позже)
final donation = await createDonation(
  requestId: request.id,
  amount: 10.00, // в долларах
  paymentIntentId: paymentIntent.id
);
```

**Логика завершения event заявок (субботник):**

До `start_date` заявка может жить в `inProgress` сколько угодно — **`created_at` не влияет** (в т.ч. импорт из Earth Day за недели до субботника).

После `start_date` для заявок в статусе `new` / `inProgress`:

1. **Сразу после `start_date` (окно до 24 ч):** push создателю — отправьте на модерацию (`pendingApproval`) или перенесите `start_date`.
2. **`start_date` + 24 часа:** если не закрыто и дата не перенесена → статус **`archived`** (строка в БД сохраняется, **не** hard delete).

**Крон не трогает event**, если уже: `pendingApproval`, `approved`, `rejected`, `archived`.

**Перенос:** обновление `start_date` на будущее сбрасывает таймер (логи `checkEventAfterStartDate` для заявки очищаются).

**Возможные ошибки при создании PaymentIntent:**

1. **Ошибка 500: "Stripe не настроен на сервере"**
   ```json
   {
     "success": false,
     "message": "Stripe не настроен на сервере",
     "errorDetails": {
       "requestId": "uuid-заявки",
       "userId": "uuid-пользователя",
       "amountCents": 100,
       "note": "STRIPE_SECRET_KEY не найден в переменных окружения"
     }
   }
   ```
   **Причина:** API ключ Stripe не настроен на сервере. Обратитесь в поддержку.

2. **Ошибка 500: "Ошибка при создании PaymentIntent в Stripe"**
   ```json
   {
     "success": false,
     "message": "Ошибка при создании PaymentIntent в Stripe",
     "errorDetails": {
       "errorMessage": "Your card was declined",
       "errorType": "card_error",
       "errorCode": "card_declined",
       "statusCode": 402,
       "requestId": "uuid-заявки",
       "userId": "uuid-пользователя",
       "amountCents": 100,
       "amountDollars": 1.0,
       "category": "event",
       "requestCategory": "event",
       "stripeDeclineCode": "insufficient_funds"
     }
   }
   ```
   **Причины:**
   - Проблемы с Stripe аккаунтом (не активирован, ограничения)
   - Проблемы с API ключом (test/live режим)
   - Сетевые проблемы с Stripe API
   - Неверная сумма (меньше минимума Stripe - 50 центов)
   
   **Что делать:**
   - Проверьте, что сумма >= 50 центов
   - Если проблема повторяется для всех пользователей - обратитесь в поддержку
   - Если проблема только для некоторых пользователей - возможно проблемы со стороны Stripe (rate limits, блокировки)

3. **Ошибка 500: "Stripe вернул некорректный ответ"**
   ```json
   {
     "success": false,
     "message": "Ошибка при создании PaymentIntent в Stripe",
     "errorDetails": {
       "errorMessage": "Stripe не вернул client_secret в ответе. PaymentIntent ID: pi_xxxxx",
       "errorType": "StripeError",
       "errorCode": "STRIPE_ERROR",
       "requestId": "uuid-заявки",
       "userId": "uuid-пользователя",
       "amountCents": 100
     }
   }
   ```
   **Причина:** Stripe API вернул PaymentIntent без обязательного поля `client_secret`. Это означает проблемы с Stripe API или неправильной конфигурацией. Обратитесь в поддержку.

4. **Ошибка 500: Таймаут Stripe API (> 15 секунд)**
   ```json
   {
     "success": false,
     "message": "Ошибка при создании PaymentIntent в Stripe",
     "errorDetails": {
       "errorMessage": "Stripe API timeout: создание PaymentIntent заняло больше 15 секунд",
       "errorType": "StripeError",
       "errorCode": "STRIPE_ERROR",
       "requestId": "uuid-заявки",
       "userId": "uuid-пользователя",
       "amountCents": 100
     }
   }
   ```
   **Причина:** Stripe API не ответил в течение 15 секунд. Возможны проблемы с сетью или со стороны Stripe. Попробуйте повторить запрос позже.

5. **Ошибка 500: "Критическая ошибка: заявка создана, но client_secret отсутствует"**
   ```json
   {
     "success": false,
     "message": "Критическая ошибка: заявка создана, но client_secret отсутствует",
     "errorDetails": {
       "requestId": "uuid-заявки",
       "userId": "uuid-пользователя",
       "paymentIntentId": "pi_xxxxx",
       "amountCents": 100,
       "paymentIntentObject": {...},
       "note": "Stripe вернул PaymentIntent, но без client_secret. Возможно проблема с аккаунтом Stripe или API ключом."
     }
   }
   ```
   **Причина:** Заявка создана в БД, но Stripe не вернул `client_secret`. Пользователю нужно удалить заявку через `DELETE /api/requests/:id` и попробовать снова, либо обратиться в поддержку.

**Рекомендации для клиента:**
- Обрабатывайте все ошибки с кодом 500 при создании платных заявок
- Показывайте детальную информацию об ошибке пользователю (из `errorDetails.errorMessage`)
- Если ошибка связана с отсутствием `client_secret` после создания заявки - предложите удалить заявку и попробовать снова
- Для таймаутов - предложите повторить попытку через несколько секунд

**Пример для Flutter (с оплатой):**
```dart
import 'package:http/http.dart' as http;
import 'dart:io';

Future<void> createRequestWithPayment({
  required String token,
  required String name,
  required String category,
  required int amountCents,
  List<File>? photos_before,
}) async {
  // ВАЖНО: Endpoint /requests/create-with-payment удален
  // Используйте POST /api/requests для создания заявки, затем POST /api/donations для доната
  final uri = Uri.parse('https://joypick.world/api/requests');
  final request = http.MultipartRequest('POST', uri);
  
  request.headers['Authorization'] = 'Bearer $token';
  
  // Текстовые поля
  request.fields['name'] = name;
  request.fields['category'] = category;
  request.fields['description'] = 'Описание заявки';
  request.fields['city'] = 'Москва';
  request.fields['latitude'] = '55.7558';
  request.fields['longitude'] = '37.6173';
  // require_payment удален - создайте заявку, затем донат через POST /api/donations
  request.fields['amount_cents'] = amountCents.toString();
  request.fields['request_category'] = 'waste_location';
  
  // Файлы
  if (photos_before != null) {
    for (var photo in photos_before) {
      final fileStream = http.ByteStream(photo.openRead());
      final length = await photo.length();
      final multipartFile = http.MultipartFile(
        'photos_before',
        fileStream,
        length,
        filename: photo.path.split('/').last,
      );
      request.files.add(multipartFile);
    }
  }
  
  final streamedResponse = await request.send();
  final response = await http.Response.fromStream(streamedResponse);
  
  if (response.statusCode == 201) {
    final data = jsonDecode(response.body);
    final paymentIntentId = data['data']['payment']['payment_intent_id'];
    final clientSecret = data['data']['payment']['client_secret'];
    // Используйте client_secret для подтверждения оплаты через Stripe SDK
  }
}
```

---

### Обновление заявки

**PUT** `/requests/:id`

**Требует аутентификации** (создатель заявки, исполнитель `joined_user_id` или админ)

**Описание:**
Обновление заявки. При изменении статуса автоматически выполняются соответствующие действия (начисление коинов, перевод денег, отправка push-уведомлений).

**При одобрении wasteLocation** в ответ добавляется `transfer_result`: `{ transferCreated: boolean, transferError?: string }`. Если Transfer не создан, по `transferError` можно понять причину: `executor_missing` — нет исполнителя (joined_user_id), `executor_has_no_stripe_account` — исполнитель не подключил Stripe, `no_succeeded_payment_in_stripe` — нет успешной оплаты по донатам, `no_donations_or_zero_amount` — нет донатов, `stripe_transfer_failed` — ошибка Stripe при создании Transfer.

**Тело запроса:** (все поля опциональны)
```json
{
  "name": "Обновленное название",
  "description": "Обновленное описание",
  "status": "pending",
  "completion_comment": "Заявка выполнена",
  "rejection_reason": "Причина отклонения",
  "rejection_message": "Кастомное сообщение от модератора",
  "actual_participants": ["550e8400-e29b-41d4-a716-446655440000", "660e8400-e29b-41d4-a716-446655440001"],
  "joined_user_id": "550e8400-e29b-41d4-a716-446655440000",
  "join_date": "2024-01-01T10:00:00.000Z",
  "waste_types": ["plastic", "glass"],
  "work_duration_minutes": 30
}
```

**`work_duration_minutes` (integer \| null):** только для заявок категории **`speedCleanup`**. Обновить могут создатель, исполнитель (`joined_user_id`) или админ (как и остальное тело **PUT**). Целое **0…10080**; `null` или пустое значение — сброс поля в БД. Для других категорий передача поля → **400**.

**Важно - ID пользователей:**
- Все ID пользователей (`joined_user_id`, элементы в `actual_participants`) должны быть **UUID из базы данных** (поле `id` из таблицы `users`)
- **НЕ используйте Firebase UID** - сервер не принимает Firebase UID, только UUID из БД
- Для отсоединения от заявки установите `joined_user_id: null` и `join_date: null`
- Формат UUID: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (36 символов с дефисами)

**Поля для модерации:**
- `rejection_reason` (string) - стандартная причина отклонения
- `rejection_message` (string) - кастомное сообщение от модератора (используется вместо стандартного, если указано)
- `status` (string) - изменение статуса (`pending`, `approved`, `rejected`)

**Важно:**
- **Для заявок типа `event` и `wasteLocation`:** изменение статуса на `pending` через этот эндпоинт **ЗАПРЕЩЕНО**. Используйте `POST /api/requests/:requestId/close-by-creator` для закрытия заявки создателем
- **Перенос времени события (event):** для заявок типа `event` изменить `start_date` и/или `end_date` (переназначить время встречи) могут **только создатель события или админ**. Исполнитель и другие участники не могут переносить время. Передайте в теле запроса новые значения `start_date` и/или `end_date` в формате ISO 8601 (например `"2025-12-15T14:00:00.000Z"`).
- При изменении статуса на `pending` (для других типов заявок) отправляется push-уведомление создателю
- **`approved` / `rejected` через этот PUT — только админ** (исполнитель/создатель не могут финально модерировать). Логика финализации — `requestModerationService.finalizeModeration` (то же, что admin POST ниже).
- При изменении статуса на `approved` (одобрение) автоматически выполняются действия согласно типу заявки (см. раздел "Важно о начислении коинов")
- При изменении статуса на `rejected` (отклонение) возвращаются деньги и отправляются push-уведомления

**Важно о начислении коинов и логике статусов:**

### Логика статусов заявок

**Статусы:**
- `new` - создана, ожидает присоединения
- ~~`pending_payment`~~ - **УДАЛЕН:** Теперь все платежи через донаты
- `inProgress` - в процессе выполнения
- `pending` - ожидает рассмотрения модератором
- `approved` - одобрена модератором
- `rejected` - отклонена модератором
- `completed` - завершена
- `archived` - архивирована (автоматически или вручную)

**Логика по типам заявок:**

1. **Для заявок типа `wasteLocation`:**
   - При создании: статус `new`
   - При присоединении исполнителя (`POST /api/requests/:id/join`): 
     - Статус меняется на `inProgress`
     - В `participant_completions` создается запись для исполнителя со статусом `"inProgress"`
   - Исполнитель закрывает свою работу через `POST /api/requests/:requestId/participant-completion`:
     - Статус участника в `participant_completions` меняется на `"pending"`
     - Опционально сохраняются **`work_duration_minutes`** (целые минуты с клиента)
     - **Статус заявки сразу меняется на `pending`** (отправка на модерацию)
     - **НЕ отправляется push-уведомление создателю** (создатель не должен ничего делать)
     - Отправляется push-уведомление админам о новой заявке на модерации
   - **Создатель НЕ может одобрять/отклонять закрытие** - эндпоинт `PATCH /api/requests/:requestId/participant-completion/:userId` недоступен для `wasteLocation`
   - **Создатель НЕ может закрывать заявку** - эндпоинт `POST /api/requests/:requestId/close-by-creator` недоступен для `wasteLocation`
   - При одобрении модератором (`PUT /api/requests/:id` со статусом `approved`):
     - **Начисляется по 1 коину:** создателю, **исполнителю (joined_user_id)**, всем донатерам
     - Деньги (только donations - комиссия) переводятся исполнителю
     - Статус автоматически меняется на `archived`
     - Отправляются push-уведомления всем участникам
   - При отклонении (`rejected`):
     - Возвращаются деньги создателю и донатерам
     - Отправляются push-уведомления с причиной отклонения

2. **Для заявок типа `speedCleanup`:**
   - При создании: статус `new` или `inProgress` (если передано явно)
   - Длительность работы в минутах для статистики: колонка **`work_duration_minutes`** (передаётся при **POST/PUT** заявки с клиента; закрытие через `/participant-completion` для speed не используется)
   - При отправке на рассмотрение: статус меняется на `pending`
   - При одобрении (`approved`):
     - Проверяется разница между `start_date` и `end_date`
     - Если разница >= 20 минут:
       - Начисляется 1 коин **только создателю** заявки
       - Отправляется push-уведомление создателю: "Thank you! You've earned a coin for your cleanup work!"
     - Если разница < 20 минут:
       - Коин не начисляется
       - Отправляется push-уведомление создателю: "Thank you! Try to work a bit longer next time to earn a coin."
     - Заявка **НЕ переводится** в статус `completed` автоматически, остается в `approved`
   - **Крон `autoCompleteSpeedCleanup`:** для **`speedCleanup`** в **`approved`**, если с **`created_at`** прошло **≥ 7 суток**, перед переводом в **`archived`** выполняется дополнительная выплата по донатам после одобрения (`payoutSpeedCleanupNewDonationsBeforeArchive`), затем статус **`archived`** и пуш создателю. Основная выплата при **`approved`** делается в **PUT** заявки.
   - При отклонении (`rejected`):
     - Возвращаются деньги донатерам (если были)
     - Отправляются push-уведомления с причиной отклонения

3. **Для заявок типа `event`:**
   - При создании: 
     - Статус автоматически `inProgress`
     - Создатель автоматически добавляется в `registered_participants`
     - В `participant_completions` создается запись для создателя со статусом `"inProgress"`
   - Другие пользователи могут присоединиться через `POST /api/requests/:id/participate`:
     - Добавляются в `registered_participants`
     - В `participant_completions` создается запись для участника со статусом `"inProgress"`
   - Автоматические push-уведомления отправляются всем из `registered_participants` (24ч, 2ч до события, начало события)
   - Каждый участник может закрыть свою работу через `POST /api/requests/:requestId/participant-completion` (после начала события), передав при необходимости **`work_duration_minutes`** (целые минуты с клиента):
     - Статус участника в `participant_completions` меняется на `"pending"`
     - Отправляется push-уведомление создателю
   - Создатель одобряет/отклоняет закрытие каждого участника через `PATCH /api/requests/:requestId/participant-completion/:userId`:
     - Статус участника меняется на `"approved"` или `"rejected"`
   - Создатель закрывает заявку через `POST /api/requests/:requestId/close-by-creator`:
     - Статус заявки меняется на `pending` (отправка на рассмотрение)
     - **Коины НЕ начисляются**
   - При одобрении модератором (`PUT /api/requests/:id` со статусом `approved`):
     - **Начисляется по 1 коину:** заказчику, **только approved участникам** (из `participant_completions`), всем донатерам
     - Деньги (cost + donations - комиссия) переводятся заказчику
     - Статус автоматически меняется на `completed`
     - Отправляются push-уведомления всем участникам
   - При отклонении (`rejected`):
     - Возвращаются деньги заказчику и донатерам
     - Отправляются push-уведомления с причиной отклонения

### Автоматические сроки (SLA) и cron

Задачи выполняются при **POST `/api/cron/run`** (админ), по расписанию на сервере и при части вызовов списка заявок (без тяжёлых веток). Ниже — бизнес-правила, реализованные в **`scripts/cronTasks.js`**.

#### 1. Исполнитель не сдал работу: **7 суток предупреждение → +1 сутки архив**

| Категория | От чего считаем | Условие |
|-----------|------------------|--------|
| **wasteLocation** | **`created_at`** | Статус **`inProgress`**, есть **`joined_user_id`**. |
| **speedCleanup** | **`created_at`** | Статус **`inProgress`** (в т.ч. только создатель). |
| **event** | **`start_date`** | Статус **`inProgress`**, событие уже началось (`start_date <= сейчас`). **Перенос даты** = новое **`start_date`** в БД — отсчёт от актуальной даты. |

- **На отметке 7 суток:** один раз пуш **создателю** (лог `cron_actions`: `executorStaleWarnCreator`).
- **На отметке 8 суток:** статус **`archived`**, пуши создателю / исполнителю (если есть) / донатерам; **автоматический рефанд донатов не выполняется** в этой ветке (как у мягкого архива «истёк срок» для waste).

#### 2. На модерации (`pending`): автомодерация (grace) + fallback **7 суток** → архив

**Предварительное авторешение** (поля `moderation_proposed_*` в `requests`):

- Пока действует предложение, клиентский **`status` остаётся `pending`**.
- После **`moderation_finalize_at`** (по умолчанию **24 ч** с `moderation_proposed_at`, `AUTO_MODERATION_GRACE_HOURS`) крон **`finalizePendingModerationProposals`** применяет решение как финальный **`approved`** / **`rejected`**.
- При proposed **`reject`** — пуш модераторам `moderation_auto_reject_pending` (в тексте — число/сумма донатов). При proposed **`approve`** — пуш модераторам **не** отправляется.
- Модератор: **`POST /api/admin/requests/:id/moderation/confirm-proposed`**, **`cancel-proposed`**, **`approve`**, **`reject`** (JWT + admin). См. раздел **Admin: модерация заявок** ниже.
- **`PUT /api/requests/:id`** со статусом `approved`/`rejected` — **только админ**; внутри вызывается тот же финализатор.

**Fallback без решения (как раньше):** опорное время **`submitted_for_review_at`** (или `updated_at`).

- **7 суток** в `pending` **без** активного предложения (`moderation_finalize_at` в будущем не блокирует): пуш админам `moderationStaleWarnAdmins`.
- **≥ 7 суток** без активного grace-предложения: **`archived`** + рефанд донатов (`archivePendingModerationTimeout`).

#### 3. Прочее (кратко)

- **wasteLocation `new`**, никто не присоединился: сутки после **`expires_at`** → **`archived`**.
- **speedCleanup / event**, статусы **`new` / `inProgress`**, **8 суток** с **`created_at`** без ухода в **`pending`**: автоотклонение через **`handleRequestRejection`** (рефанды по донатам, как при отклонении).
- Напоминания waste (2 ч / 24 ч), **checkEventAfterStartDate** (event после `start_date`), выплаты, **cleanupUnpaidRequests** (legacy `pending_payment`) и др. — по-прежнему в том же cron-скрипте.

**Ответ POST `/api/cron/run`** может содержать блоки результатов, например **`finalizePendingModerationProposals`**, **`checkExecutorStaleness`**, **`checkModerationReviewStale`**, **`deleteInactiveRequests`** (архив без исполнителя / автоотклонение speed-event и т.д.).

---

### Admin: модерация заявок (автомодерация + ручное вмешательство)

**Префикс:** `/api/admin/requests` · **JWT + `requireAdmin`**

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/moderation-queue` | Список `pending`. Query: `has_proposed`, `proposed_action`, `sort` (`finalize_at` \| `submitted`), `limit`, `offset` |
| GET | `/:id/moderation` | Карточка заявки + блок `moderation` + `donations_summary` |
| POST | `/:id/moderation/confirm-proposed` | Подтвердить текущее предложенное решение |
| POST | `/:id/moderation/cancel-proposed` | Отменить предложение, остаться в `pending` |
| POST | `/:id/moderation/approve` | Ручной финальный approve |
| POST | `/:id/moderation/reject` | Ручной финальный reject; body: `rejection_reason`, `rejection_message` |

**Поля `moderation` в ответе:**

| Поле | Назначение |
|------|------------|
| `has_active_proposal` | `true` — есть авто-решение, ждём grace или вмешательства |
| `auto_decision_status` | `off` · `manual_queue` · **`approve_grace`** · **`reject_grace`** · `cancelled` |
| `proposed_action` | `approve` \| `reject` \| `null` |
| `proposed_at`, `finalize_at`, `seconds_until_finalize` | Старт grace и дедлайн авто-финализации (крон) |
| `reason_code`, `meta` | Код и снимок (integrity issues / INTEGRITY_PASSED) |
| `can_confirm`, `can_cancel` | Подтвердить или отменить предложение до `finalize_at` |
| `auto_moderation_enabled` | Фича на сервере (не путать с `has_active_proposal`) |
| `integrity_check`, `integrity_summary_for_moderator` | Последний прогон integrity |

После сдачи в `pending` бэкенд вызывает `runIntegrityOnPending`: при успехе — **`proposed_action: approve`** + 24 ч, при провале — **`reject`** + пуш модераторам.

При **авто-reject** в `moderation.meta` / `integrity_check.issues` — список кодов и сообщений (почему предложено отклонение). Event без участников — **не** ошибка.

**ENV:** `AUTO_MODERATION_ENABLED` (`1`), `AUTO_MODERATION_GRACE_HOURS` (`24`), `INTEGRITY_MIN_WASTE_MINUTES` (`15`), `INTEGRITY_MIN_SPEED_MINUTES` (`15`), `INTEGRITY_AI_ENABLED`, `INTEGRITY_TEXT_AI_ENABLED` (по умолчанию вкл. при наличии ключа), `OPENROUTER_API_KEY`, `INTEGRITY_TEXT_AI_TIMEOUT_MS` (по умолчанию `15000`), `INTEGRITY_OPENROUTER_MODEL`.

**Миграции:** `042_requests_auto_moderation.sql`, `043_requests_integrity_check.sql`.

---

**Устаревший краткий список (для ориентира по частоте):**
- Напоминания waste, истечение join 24 ч, уведомления о неактивных waste, проверка времени event, прочие задачи — как настроен интервал крона на хостинге (часто 5–15 минут или по ручному запуску).

---

### Удаление заявки

**DELETE** `/requests/:id`

**Требует аутентификации** (только создатель или админ)

**Ответ (200):**
```json
{
  "success": true,
  "message": "Заявка удалена"
}
```

---

### Присоединение к заявке (wasteLocation)

**POST** `/requests/:id/join`

**Требует аутентификации**

**Описание:**
Присоединение к заявке типа `wasteLocation`. При присоединении:
- Статус заявки автоматически меняется на `inProgress`
- Сохраняется `joined_user_id` и `join_date`
- Отправляется push-уведомление создателю заявки

**Важно:**
- К заявке можно присоединиться только если статус `new`
- К заявке может присоединиться только один человек
- Если исполнитель не завершил заявку в течение 24 часов, заявка возвращается в статус `new` и становится доступной для присоединения снова

**Для платных заявок:**
**ВАЖНО:** Статус `pending_payment` удален. Теперь все платежи идут через донаты, заявка создается сразу со стандартным статусом.
- Если оплата прошла (`succeeded`), статус заявки меняется на `new` и присоединение разрешается
- Если оплата не прошла, возвращается ошибка 400 с деталями
- Это позволяет пользователю присоединиться сразу после оплаты, не дожидаясь обработки webhook

**Ответ (200):**
```json
{
  "success": true,
  "message": "Вы присоединились к заявке"
}
```

**Ошибка (400) - Неверный статус заявки:**
```json
{
  "success": false,
  "message": "К этой заявке нельзя присоединиться"
}
```

**Ошибка (400) - Заявка ожидает оплаты:**
```json
{
  "success": false,
  "message": "Заявка ожидает оплаты. Пожалуйста, завершите оплату.",
  "timestamp": "2026-01-13T10:00:00.000Z",
  "errorDetails": {
    "paymentStatus": "requires_payment_method",
    "paymentIntentId": "pi_xxx",
    "note": "Оплата еще не завершена в Stripe"
  }
}
```

**Ошибка (409):**
```json
{
  "success": false,
  "message": "К заявке уже присоединился другой пользователь"
}
```

**Ошибка (500) - Ошибка проверки оплаты:**
```json
{
  "success": false,
  "message": "Ошибка проверки оплаты",
  "timestamp": "2026-01-13T10:00:00.000Z",
  "errorDetails": {
    "errorMessage": "No such payment_intent: 'pi_xxx'",
    "paymentIntentId": "pi_xxx",
    "note": "Не удалось проверить статус оплаты в Stripe"
  }
}
```

---

### Участие в событии (event)

**POST** `/requests/:id/participate`

**Требует аутентификации**

**Описание:**
Присоединение к событию типа `event`. Пользователь автоматически добавляется в список зарегистрированных участников (`registered_participants`). Создатель события автоматически добавляется в участники при создании события.

**Автоматические действия при участии:**
- ✅ Пользователь добавляется в `registered_participants`
- ✅ В `participant_completions` создается запись для участника со статусом `"inProgress"`
- ✅ Пользователь автоматически добавляется в групповой чат заявки (`group_chat_id`)
- ✅ **Автоматически создается приватный чат** между участником и создателем заявки
- ✅ Приватный чат добавляется в массив `private_chats` заявки
- ✅ Приватный чат готов к использованию сразу после участия

**Ответ (200):**
```json
{
  "success": true,
  "message": "Вы присоединились к событию"
}
```

**Отмена участия:**

**DELETE** `/requests/:id/participate`

**Требует аутентификации**

**Описание:**
Отмена участия в событии типа `event`. Пользователь удаляется из списка зарегистрированных участников (`registered_participants`). Создатель события не может отменить участие.

**Автоматические действия при отмене участия:**
- ✅ Пользователь удаляется из `registered_participants`
- ✅ Пользователь удаляется из группового чата заявки
- ✅ **Приватный чат удаляется из массива `private_chats` заявки**
- ✅ Запись в `participant_completions` для этого участника остается (для истории)

**Ответ (200):**
```json
{
  "success": true,
  "message": "Участие отменено"
}
```

---

### Продление заявки waste

**POST** `/requests/:id/extend`

**Требует аутентификации** (только создатель заявки)

**Описание:**
Продление заявки типа `wasteLocation` еще на неделю. Доступно только для заявок со статусом `new`, которые еще не истекли и не были продлены ранее (максимум одно продление).

**Логика:**
- Через 7 дней после создания заявки создателю отправляется push-уведомление о том, что заявка будет удалена через 24 часа, и он может продлить ее
- Создатель может продлить заявку еще на неделю, вызвав этот endpoint
- Если заявка не была продлена, через 8 дней (7 дней + 1 день ожидания) она автоматически удаляется

**Ограничения:**
- Только для заявок типа `wasteLocation`
- Только для заявок со статусом `new`
- Только создатель заявки может продлить ее
- Максимум одно продление (`extended_count` не должен быть >= 1)
- Заявка не должна быть истекшей (`expires_at` > текущее время)

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Уборка парка",
    "category": "wasteLocation",
    "status": "new",
    "expires_at": "2025-12-10T12:00:00.000Z",
    "extended_count": 1,
    ...
  }
}
```

**Ошибки:**
- `404` - Заявка не найдена
- `400` - Продление доступно только для заявок типа wasteLocation
- `400` - Продление доступно только для заявок со статусом new
- `400` - Заявка уже была продлена. Максимум одно продление.
- `400` - Заявка уже истекла и не может быть продлена
- `403` - Только создатель заявки может продлить ее

---

### Закрытие события (event)

**⚠️ DEPRECATED:** Этот эндпоинт отключен.

**PUT** `/requests/:id/close-event` - **НЕ ИСПОЛЬЗУЕТСЯ**

**Используйте вместо этого:** `POST /api/requests/:requestId/close-by-creator`

Для закрытия заявок типа `event` и `wasteLocation` используйте новый эндпоинт `POST /api/requests/:requestId/close-by-creator`, который работает с системой `participant_completions`.

---

### Закрытие работы участником

**POST** `/requests/:requestId/participant-completion`

**Требует аутентификации**

**Описание:**
Участник закрывает свою часть работы. Доступно только для заявок типа `wasteLocation` и `event`. 

**⚠️ РАЗЛИЧИЯ ПО ТИПАМ ЗАЯВОК:**

**Для `wasteLocation`:**
- Загружаются фото после работы (`photos_after`)
- Указываются координаты места закрытия
- Опционально указывается комментарий
- Обновляется `participant_completions[userId].status` на `"pending"`
- **Статус заявки (`request.status`) сразу меняется на `"pending"`** - заявка отправляется на модерацию
- **НЕ отправляется push-уведомление создателю** (создатель не должен ничего делать)
- Отправляется push-уведомление админам о новой заявке на модерации

**Для `event`:**
- Загружаются фото после работы (`photos_after`)
- Указываются координаты места закрытия
- Опционально указывается комментарий
- Обновляется ТОЛЬКО `participant_completions[userId].status` на `"pending"`
- **Статус заявки (`request.status`) НЕ меняется** - остается `"inProgress"`
- Отправляется push-уведомление создателю заявки

**Требования:**
- Пользователь должен быть участником заявки:
  - Для `event`: в `registered_participants`
  - Для `wasteLocation`: в `joined_user_id`
- Для `event`: событие должно начаться (`start_date <= now()`)
- Статус заявки должен быть `"inProgress"`

**Важно:** Фотографии принимаются только в виде файлов через `multipart/form-data`. URL фотографий не принимаются.

**Content-Type:** `multipart/form-data`

**Поля формы:**
- `photos_after` (file[], обязательно) - массив файлов фотографий после работы (минимум 1 фото)
- `completion_comment` (string, опционально) - комментарий участника при закрытии работы
- `completion_latitude` (number, обязательно) - широта координат пользователя в момент закрытия
- `completion_longitude` (number, обязательно) - долгота координат пользователя в момент закрытия
- `work_duration_minutes` (integer, опционально) - целые минуты работы с клиента (**waste**: фикс, напр. 15; **event**: от `start_date` события до сдачи на ревью). Диапазон на сервере: **0…10080**. Если не передать, поле в JSON участника можно не менять (остаётся как было / `null` у новой записи).

**Ответ (200):**
```json
{
  "success": true,
  "message": "Заявка закрыта и отправлена на модерацию", // Для wasteLocation
  // или "Работа закрыта, ожидает одобрения" // Для event
  "data": {
    "request": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "pending", // Для wasteLocation статус меняется на pending
      // или "inProgress" // Для event статус остается inProgress
      "participant_completions": {
        "user_id_1": {
          "status": "pending",
          "photos_after": ["https://joypick.world/uploads/photos/uuid1.jpg"],
          "completion_comment": "Убрал весь мусор",
          "completion_latitude": 56.4962847,
          "completion_longitude": 84.9802779,
          "rejection_reason": null,
          "completed_at": "2025-12-21T13:35:00.000Z",
          "work_duration_minutes": 15
        }
      },
      ...
    }
  }
}
```

**Ошибки:**
- `404` - Заявка не найдена
- `400` - Этот тип заявки не поддерживает закрытие работы участником
- `400` - Заявка должна быть в статусе inProgress
- `403` - Вы не являетесь участником этой заявки
- `400` - Событие еще не началось (только для event)
- `400` - Необходимо загрузить минимум одно фото
- `400` - Необходимо указать координаты
- `400` - Некорректное `work_duration_minutes` (ожидается целое 0…10080)

---

### Одобрение/отклонение закрытия работы создателем

**PATCH** `/requests/:requestId/participant-completion/:userId`

**Требует аутентификации** (только создатель заявки или админ)

**Описание:**
Создатель заявки одобряет или отклоняет закрытие работы участником. При одобрении статус участника меняется на `"approved"`, при отклонении - на `"rejected"` с указанием причины.

**⚠️ ВАЖНО:** Этот эндпоинт **НЕДОСТУПЕН для заявок типа `wasteLocation`**. Для `wasteLocation` создатель не может одобрять/отклонять работу участника - заявка сразу отправляется на модерацию админам.

**Требования:**
- Тип заявки должен быть `event` (для `wasteLocation` возвращается ошибка 403)
- Пользователь должен быть создателем заявки (`created_by`) или админом
- Участник должен иметь статус `"pending"` в `participant_completions`

**Content-Type:** `application/json`

**Body:**
```json
{
  "action": "approve" | "reject",
  "rejection_reason": "string" // Обязательно при action="reject"
}
```

**Ответ (200):**
```json
{
  "success": true,
  "message": "Закрытие работы одобрено",
  "data": {
    "request": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "participant_completions": {
        "user_id_1": {
          "status": "approved",
          "photos_after": ["https://joypick.world/uploads/photos/uuid1.jpg"],
          "completion_comment": "Убрал весь мусор",
          "completion_latitude": 56.4962847,
          "completion_longitude": 84.9802779,
          "rejection_reason": null,
          "completed_at": "2025-12-21T13:35:00.000Z"
        }
      },
      ...
    }
  }
}
```

**Ошибки:**
- `404` - Заявка не найдена
- `404` - Участник не найден в participant_completions
- `400` - Необходимо указать action: approve или reject
- `400` - При отклонении необходимо указать rejection_reason
- `400` - Статус участника должен быть pending
- `403` - Для заявок типа wasteLocation одобрение/отклонение недоступно
- `403` - Доступ запрещен. Только создатель заявки может одобрять/отклонять закрытие работы

---

### Закрытие заявки создателем

**POST** `/requests/:requestId/close-by-creator`

**Требует аутентификации** (только создатель заявки)

**Описание:**
Создатель заявки закрывает заявку и отправляет её на рассмотрение. При закрытии:
- Статус заявки меняется на `"pending"` (для рассмотрения в админке)
- Опционально указывается комментарий
- **Коины НЕ начисляются** - они начисляются только при одобрении модератором

**⚠️ ВАЖНО:** Этот эндпоинт **НЕДОСТУПЕН для заявок типа `wasteLocation`**. Для `wasteLocation` создатель не может закрывать заявку - только просматривать и продлевать. Заявка закрывается автоматически исполнителем через `/participant-completion`.

**Требования:**
- Тип заявки должен быть `event` (для `wasteLocation` возвращается ошибка 403)
- Пользователь **ОБЯЗАТЕЛЬНО** должен быть создателем заявки (`created_by`)
- **Присоединившийся пользователь НЕ МОЖЕТ закрыть заявку** - только завершить свою часть работы через `/participant-completion`
- Заявка должна быть в статусе `"inProgress"`

**Content-Type:** `application/json`

**Body:**
```json
{
  "completion_comment": "string" // Опционально
}
```

**Ответ (200):**
```json
{
  "success": true,
  "message": "Заявка закрыта и отправлена на рассмотрение",
  "data": {
    "request": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "pending",
      "completion_comment": "Все участники выполнили работу",
      "participant_completions": {
        "user_id_1": {
          "status": "approved",
          ...
        },
        "user_id_2": {
          "status": "pending",
          ...
        }
      },
      ...
    }
  }
}
```

**Ошибки:**
- `404` - Заявка не найдена
- `400` - Этот тип заявки не поддерживает закрытие создателем
- `400` - Заявка должна быть в статусе inProgress
- `403` - Для заявок типа wasteLocation создатель не может закрывать заявку
- `403` - Только создатель заявки может закрыть заявку

**Важно о начислении коинов:**
- Коины начисляются **только при одобрении модератором** (`PUT /api/requests/:id` со статусом `approved`)
- Получают коины:
  - Создателю заявки: 1 коин
  - Для `wasteLocation`: исполнителю (`joined_user_id`) - 1 коин
  - Для `event`: только участникам со статусом `"approved"` в `participant_completions` - по 1 коину
  - Всем донатерам: по 1 коину
- Если участник закрыл работу после закрытия заявки создателем (для `event`), он не получит коины при одобрении модератором

---

**Ошибка (400):**
```json
{
  "success": false,
  "message": "Событие еще не началось"
}
```

---

## 💰 Донаты

### Получение списка донатов

**GET** `/donations`

**Требует аутентификации**

**Query параметры:**
- `page`, `limit` - пагинация
- `requestId` - фильтр по заявке
- `user_id` - фильтр по пользователю

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "donations": [
      {
        "id": "uuid",
        "request_id": "uuid",
        "user_id": "uuid",
        "amount": 1000,
        "payment_intent_id": "pi_xxx",
        "created_at": "2024-01-01T00:00:00.000Z",
        "user_name": "Имя пользователя",
        "user_email": "user@example.com",
        "request_name": "Название заявки"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

---

### Создание доната

**POST** `/donations`

**Требует аутентификации**

**Тело запроса:**
```json
{
  "requestId": "uuid",
  "amount": 1000,
  "paymentIntentId": "pi_xxx"
}
```

**Ответ (201):**
```json
{
  "success": true,
  "message": "Донат создан",
  "data": {
    "donation": {
      "id": "uuid",
      "request_id": "uuid",
      "user_id": "uuid",
      "amount": 1000,
      "payment_intent_id": "pi_xxx",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

## 👥 Участники

### Получение участников заявки

**GET** `/participants?requestId=uuid`

**Описание:**
Получение списка участников события (только для `event`). Возвращает реальных участников из `actual_participants` (если событие уже закрыто) или зарегистрированных участников из `registered_participants`.

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "participants": [
      {
        "id": "uuid",
        "display_name": "Имя пользователя",
        "photo_url": "url",
        "email": "user@example.com"
      }
    ]
  }
}
```

---

### Получение вкладчиков заявки

**GET** `/participants/contributors?requestId=uuid`

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "contributors": [
      {
        "user_id": "uuid",
        "amount": 1000,
        "display_name": "Имя пользователя",
        "photo_url": "url",
        "email": "user@example.com"
      }
    ]
  }
}
```

---

## 💬 Чаты

### Получение списка чатов

**GET** `/chats`

**Описание:**
Получить список всех чатов текущего пользователя. Все чаты автоматически валидируются на соответствие типа чата его полям. При обнаружении несоответствий тип чата автоматически исправляется.

**Важно:**
- **Возвращаются только чаты, где есть хотя бы одно сообщение.** Пустые чаты (без сообщений) не возвращаются.
- Это сделано для оптимизации и удобства пользователя - показываются только активные чаты.

**Query параметры:**
- `type` - фильтр по типу (`support`, `private`, `group`)
- `limit` - количество (по умолчанию 20, максимум 100)
- `offset` - смещение для пагинации

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "chats": [
      {
        "id": "uuid",
        "type": "support",
        "user_id": "uuid",
        "request_id": null,
        "created_at": "2024-01-01T00:00:00.000Z",
        "last_message_at": "2024-01-01T00:00:00.000Z",
        "unread_count": 5,
        "participants_count": 3,
        "last_message": {
          "id": "uuid",
          "message": "Последнее сообщение",
          "sender_id": "uuid",
          "created_at": "2024-01-01T00:00:00.000Z"
        }
      }
    ],
    "total": 10
  }
}
```

**Важно:**
- Поле `type` всегда явно указывается в ответе
- Поле `participants_count` всегда возвращается для всех типов чатов
- Типы чатов автоматически валидируются и исправляются при необходимости

---

### Чат техподдержки

#### Получить чат техподдержки

**GET** `/chats/support`

**Описание:**
Получить чат техподдержки текущего пользователя.

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "support",
    "user_id": "uuid",
    "request_id": null,
    "created_at": "2024-01-01T00:00:00.000Z",
    "last_message_at": "2024-01-01T00:00:00.000Z",
    "unread_count": 5,
    "participants_count": 3
  }
}
```

**Валидация:**
- Для `support` чата: `request_id` должен быть `null`, `user_id` должен быть указан
- Для одного пользователя может быть только один `support` чат
- Если чат уже существует, возвращается существующий (статус 200, не 201)

#### Создать чат техподдержки

**POST** `/chats/support`

**Описание:**
Создать чат техподдержки (если не существует). Если чат уже существует, возвращает существующий чат со статусом 200 (не 201).

**Валидация:**
- `request_id` должен быть `null` (не передается)
- `user_id` автоматически устанавливается в ID текущего пользователя
- Для одного пользователя может быть только один `support` чат
- При создании автоматически добавляются все админы в участники

**Ответ (200):** Если чат уже существует
**Ответ (201):** Если чат создан
Аналогично GET `/chats/support`

---

### Приватный чат

#### Получить приватный чат

**GET** `/chats/private/:requestId`

**Описание:**
Получить приватный чат с создателем заявки.

**Параметры:**
- `requestId` - ID заявки

**Ответ (200):**
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
    "unread_count": 2,
    "participants_count": 2
  }
}
```

**Валидация:**
- Для `private` чата: `request_id` должен быть указан, `user_id` должен быть указан
- Участников должно быть ровно 2
- **Для каждой заявки может быть только один приватный чат** (один на заявку)
- Поиск чата идет по `request_id` и типу `private`, без проверки участников

#### Создать приватный чат

**POST** `/chats/private`

**Описание:**
Создать приватный чат между двумя пользователями. **Для каждой заявки может быть только один приватный чат.** Если чат уже существует для данной заявки, возвращается существующий чат со статусом 200 (не 201).

**Валидация:**
- `request_id` обязателен (не может быть `null`)
- `user_id_1` и `user_id_2` обязательны
- Участников должно быть ровно 2
- **Для каждой заявки может быть только один приватный чат** (один на заявку)
- Поиск существующего чата идет по `request_id` и типу `private`

**Тело запроса:**
```json
{
  "user_id_1": "uuid",
  "user_id_2": "uuid",
  "request_id": "uuid" // обязательно
}
```

**Параметры:**
- `user_id_1` (обязательно) - ID первого пользователя
- `user_id_2` (обязательно) - ID второго пользователя
- `request_id` (обязательно) - ID заявки, с которой связан чат

**Альтернативный формат (для обратной совместимости):**
```json
{
  "request_id": "uuid"
}
```
В этом случае создается чат между текущим пользователем (кто делает запрос) и создателем заявки.

**Ответ (200):** Если чат уже существует
**Ответ (201):** Если чат создан
Аналогично GET `/chats/private/:requestId`

---

### Групповой чат

**Важно:** 
- Групповой чат создается автоматически при создании заявки любого типа (wasteLocation, speedCleanup, event)
- **Для каждой заявки может быть только один групповой чат** (один на заявку)
- **Создатель заявки автоматически добавляется в участники при создании заявки**
- **Любой пользователь может присоединиться к групповому чату, просто отправив в него сообщение** - пользователь автоматически добавляется в участники при первой отправке сообщения
- Не требуется явного присоединения к чату - достаточно написать сообщение

#### Получить групповой чат

**GET** `/chats/group/:requestId`

**Описание:**
Получить групповой чат заявки. Если чат не существует, вернется ошибка 404.

**Параметры:**
- `requestId` - ID заявки

**Ответ (200):**
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

#### Создать групповой чат

**POST** `/chats/group`

**Описание:**
Создать групповой чат для заявки (если он не был создан автоматически при создании заявки). Если чат уже существует, возвращает существующий чат со статусом 200 (не 201). Автоматически добавляет всех участников:

**Валидация:**
- `request_id` обязателен (не может быть `null`)
- `user_id` должен быть `null` для group чатов
- Участников должно быть минимум 2
- Для одной заявки может быть только один `group` чат
- Создателя заявки (`created_by`)
- Текущего пользователя (который создает чат)
- Для waste: присоединившегося пользователя (`joined_user_id`, если есть)
- Для event: зарегистрированных участников (`registered_participants`)
- Всех донатеров из таблицы `donations`

**Примечание:** Обычно этот endpoint не нужно вызывать вручную, так как групповой чат создается автоматически при создании заявки. Используйте его только если чат по какой-то причине не был создан автоматически.

**Тело запроса:**
```json
{
  "request_id": "uuid"
}
```

**Ответ (201):**
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

**Ошибки:**
- `400` - `request_id обязателен` - не передан request_id
- `404` - `Заявка не найдена` - заявка с указанным ID не существует
- `500` - `Ошибка при создании группового чата` - внутренняя ошибка сервера

**Примечание:**
Если групповой чат для указанной заявки уже существует, возвращается существующий чат (статус 200) вместо создания нового.

---

### Сообщения

#### Получить историю сообщений

**GET** `/chats/:chatId/messages`

**Описание:**
Получить историю сообщений чата. **Возвращаются только сообщения чата с указанным `chatId` из URL.** Все операции идут по `chatId` из URL, без поиска по пользователям или заявкам. Используется при открытии чата для загрузки истории.

**Параметры:**
- `chatId` (в URL) - ID чата, из которого получаются сообщения

**Валидация:**
- Проверяется, что чат с указанным `chatId` существует
- Для **групповых чатов**: если пользователь не является участником, он **автоматически добавляется в участники** при получении сообщений
- Для **приватных чатов**: проверяется, что текущий пользователь является участником этого чата
- Для **чатов поддержки**: проверяется, что текущий пользователь является участником этого чата
- Возвращаются только сообщения с `chat_id = chatId` из URL

**⚠️ ВАЖНО для фронтенда:**
- Для групповых чатов **не требуется явное присоединение** - пользователь автоматически становится участником при первом обращении к чату (получение сообщений или отправка)
- Фронтенд может сразу получать сообщения из группового чата, не проверяя, является ли пользователь участником

**Query параметры:**
- `limit` - количество сообщений (по умолчанию 50, максимум 100)
- `offset` - смещение для пагинации
- `before` - получить сообщения до указанной даты (ISO 8601)

**Ответ (200):**
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
        "read_by": ["uuid", "uuid"],
        "unread_by": ["uuid"]
      }
    ],
    "total": 100,
    "has_more": true
  }
}
```

#### Отправить сообщение (HTTP API)

**POST** `/chats/:chatId/messages`

**Описание:**
Отправить сообщение через HTTP API (альтернатива WebSocket). **Сообщение сохраняется в чат с указанным `chatId` из URL.** Все операции идут по `chatId` из URL, без поиска по пользователям или заявкам.

**Параметры:**
- `chatId` (в URL) - ID чата, в который отправляется сообщение

**Тело запроса:**
```json
{
  "message": "Текст сообщения",
  "message_type": "text"
}
```

**Валидация:**
- Проверяется, что чат с указанным `chatId` существует
- Для **групповых чатов**: если пользователь не является участником, он **автоматически добавляется в участники** при отправке сообщения
- Для **приватных чатов**: проверяется, что текущий пользователь является участником этого чата
- Для **чатов поддержки**: проверяется, что текущий пользователь является участником этого чата
- Сообщение сохраняется с `chat_id = chatId` из URL

**⚠️ ВАЖНО для фронтенда:**
- Для групповых чатов **не требуется явное присоединение** - пользователь автоматически становится участником при первой отправке сообщения
- Фронтенд может сразу отправлять сообщения в групповой чат, не проверяя, является ли пользователь участником
- Для приватных чатов и чатов поддержки пользователь должен быть участником заранее

**Ответ (201):**
```json
{
  "success": true,
  "message": "Сообщение отправлено",
  "data": {
    "id": "uuid",
    "chat_id": "uuid",
    "sender_id": "uuid",
    "message": "Текст сообщения",
    "message_type": "text",
    "created_at": "2024-01-01T00:00:00.000Z",
    "read_by": ["uuid"],
    "unread_by": ["uuid", "uuid"]
  }
}
```

**Логика прочтения:**
- При отправке сообщения отправитель автоматически добавляется в `read_by`
- Все остальные участники чата автоматически добавляются в `unread_by`
- При открытии чата вызывается `POST /chats/:chatId/read` для автоматической отметки всех сообщений как прочитанных

**Примечание:** 
- Сообщение также отправляется через Socket.io и SSE всем участникам чата
- **КРИТИЧЕСКИ ВАЖНО:** Сообщение сохраняется в чат с `chat_id = chatId` из URL. Не используется поиск по пользователям или заявкам.

#### Отметить все сообщения как прочитанные

**POST** `/chats/:chatId/read`

**Описание:**
Отметить все непрочитанные сообщения в чате как прочитанные. Вызывается автоматически при открытии чата.

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "chat_id": "uuid",
    "messages_marked_read": 5,
    "read_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**Логика:**
- Перемещает текущего пользователя из `unread_by` в `read_by` для всех непрочитанных сообщений
- Отправляет событие `all_messages_read` через SSE и Socket.io

#### Отметить одно сообщение как прочитанное

**POST** `/chats/:chatId/messages/:messageId/read`

**Описание:**
Отметить одно конкретное сообщение как прочитанное (для обратной совместимости).

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "message_id": "uuid",
    "read_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**Примечание:** Событие также отправляется через Socket.io и SSE всем участникам чата.

---

### Логика прочтения сообщений

**Как это работает:**

1. **При отправке сообщения:**
   - Отправитель автоматически добавляется в `read_by` (свои сообщения всегда прочитаны)
   - Все остальные участники чата автоматически добавляются в `unread_by`
   - Пример: Пользователь A отправил сообщение в чат с участниками [A, B, C]
     - `read_by: ["A"]`
     - `unread_by: ["B", "C"]`

2. **При открытии чата:**
   - Вызывается `POST /chats/:chatId/read`
   - Все сообщения, где текущий пользователь в `unread_by`, автоматически отмечаются как прочитанные
   - Пользователь перемещается из `unread_by` в `read_by` для всех непрочитанных сообщений

3. **Подсчет непрочитанных:**
   - `unread_count` считается как количество сообщений, где текущий пользователь находится в `unread_by`
   - Собственные сообщения не учитываются (отправитель всегда в `read_by`)

4. **Для админов в support чатах:**
   - Админы автоматически добавляются в `chat_participants` при создании support чата
   - Админы видят все support чаты через `GET /chats/admin/chats?type=support`
   - `unread_count` для админа показывает количество непрочитанных сообщений от пользователей

**Формат полей:**
- `read_by` - массив ID пользователей, которые прочитали сообщение: `["uuid1", "uuid2"]`
- `unread_by` - массив ID пользователей, которые не прочитали сообщение: `["uuid3", "uuid4"]`
- Оба поля могут быть `null` или пустыми массивами `[]`

---

### Админ-панель (только для админов)

#### Получить все чаты

**GET** `/chats/admin/chats`

**Описание:**
Получить все чаты в системе (только для админов). Админы автоматически добавляются в support чаты при их создании.

**Query параметры:**
- `type` - фильтр по типу (`support`, `private`, `group`)
- `request_id` - фильтр по заявке
- `user_id` - фильтр по пользователю
- `limit` - количество (по умолчанию 20, максимум 100)
- `offset` - смещение для пагинации

**Примеры:**
- Получить все support чаты: `GET /chats/admin/chats?type=support`
- Получить все чаты с пагинацией: `GET /chats/admin/chats?limit=50&offset=0`

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "chats": [
      {
        "id": "uuid",
        "type": "support",
        "user_id": "uuid",
        "request_id": null,
        "created_at": "2024-01-01T00:00:00.000Z",
        "last_message_at": "2024-01-01T00:00:00.000Z",
        "participants_count": 3,
        "unread_count": 5
      }
    ],
    "total": 10
  }
}
```

**Поля:**
- `participants_count` - количество участников чата
- `unread_count` - количество непрочитанных сообщений для текущего админа

#### Получить сообщения чата (для админов)

**GET** `/chats/admin/chats/:chatId/messages`

**Описание:**
Получить все сообщения чата (только просмотр, без возможности отправки).

**Ответ (200):**
Аналогично GET `/chats/:chatId/messages`

---

## 🏢 Партнеры

API для управления партнерами. Партнеры - это организации, которые сотрудничают с платформой.

### Модель Partner

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `id` | string (UUID) | Нет (автогенерация) | Уникальный идентификатор партнера |
| `name` | string | Да | Название партнера |
| `logo_url` | string (URL) | Нет | URL логотипа партнёра |
| `photo_urls` | array[string] | Нет | Массив URL фотографий партнера (JSON) |
| `activity` | string | Нет | Деятельность партнера |
| `website_url` | string (URL) | Нет | URL сайта партнера |
| `admin_email` | string | Нет | Логин админа партнёра (email) для входа в кабинет |
| `currency` | string | Да при создании | Валюта скидки за коины (USD, RUB и т.д.). Справочник: GET /api/references/currencies |
| `exchange_rate_cents_per_coin` | int | Да при создании | Скидка в центах (или младших единицах валюты) за 1 коин (например 50 = 0.50 USD). Целое, ≥ 1 |
| `created_at` | datetime | Нет (автогенерация) | Дата создания |
| `updated_at` | datetime | Нет (автогенерация) | Дата обновления |

**Примечание:** Адрес и координаты у партнёра отсутствуют — они задаются только у филиалов (таблица `partner_branches`, эндпоинты `/api/partner-admin/branches`).

В ответах GET (список, по ID), POST (создание) и PUT (обновление) у каждого партнёра есть поле **`branches`** — массив филиалов. Элемент филиала: `id`, `partner_id`, `name`, `address`, `latitude`, `longitude`, `created_at`, `updated_at`.

### Получение списка партнеров

**GET** `/partners`

**Авторизация:** Не требуется (публичный эндпоинт)

**Query параметры:**
- `page` (int, опционально) - номер страницы (по умолчанию 1)
- `limit` (int, опционально) - количество на странице (по умолчанию 20, максимум 100)
- `latitude`, `longitude` (float, опционально) - при указании возвращаются партнёры, у которых есть хотя бы один филиал в заданном радиусе (координаты берутся из филиалов)
- `radius` (int, опционально) - радиус поиска в метрах (по умолчанию 10000)

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "partners": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "ЭкоПартнер",
        "logo_url": "https://joypick.world/uploads/logos/uuid.png",
        "photo_urls": ["https://joypick.world/uploads/photos/uuid1.jpg"],
        "activity": "Переработка пластика",
        "website_url": "https://ecopartner.ru",
        "currency": "USD",
        "exchange_rate_cents_per_coin": 50,
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z",
        "branches": [
          {
            "id": "uuid",
            "partner_id": "550e8400-e29b-41d4-a716-446655440000",
            "name": "Кафе Луна",
            "address": "ул. Ленина, 1",
            "latitude": 56.49,
            "longitude": 84.98,
            "created_at": "2024-01-01T00:00:00.000Z",
            "updated_at": "2024-01-01T00:00:00.000Z"
          }
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

### Получение партнера по ID

**GET** `/partners/:id`

**Авторизация:** Не требуется (публичный эндпоинт)

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "partner": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "ЭкоПартнер",
      "logo_url": "https://joypick.world/uploads/logos/uuid.png",
      "photo_urls": ["https://joypick.world/uploads/photos/uuid1.jpg"],
      "activity": "Переработка пластика",
      "website_url": "https://ecopartner.ru",
      "currency": "USD",
      "exchange_rate_cents_per_coin": 50,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z",
      "branches": [
        {
          "id": "uuid",
          "partner_id": "550e8400-e29b-41d4-a716-446655440000",
          "name": "Кафе Луна",
          "address": "ул. Ленина, 1",
          "latitude": 56.49,
          "longitude": 84.98,
          "created_at": "2024-01-01T00:00:00.000Z",
          "updated_at": "2024-01-01T00:00:00.000Z"
        }
      ]
    }
  }
}
```

**Ошибки:**
- `404` - Партнер не найден

### Создание партнера

**POST** `/partners`

**Требует аутентификации и прав администратора**

**Поддерживает два способа отправки:**

1. **JSON с URL фотографий и лого**
2. **multipart/form-data с файлами** (рекомендуется)

**Поля при создании (обязательные):**
- `name` (string) - название партнера
- `admin_email` (string) - логин админа партнёра (email)
- `admin_password` (string) - пароль (можно генерировать на фронте)
- `currency` (string) - валюта скидки (код из справочника GET /api/references/currencies, например USD, RUB)
- `exchange_rate_cents_per_coin` (int) - сколько центов (или младших единиц валюты) даёт 1 коин (целое ≥ 1, например 50)

**Поля опционально:**
- `logo_url` (string) или файл `logo` в multipart - логотип партнёра
- `activity`, `website_url` - деятельность и URL сайта
- `photo_urls` (array[string]) или файлы `photos` (максимум 10) - фотографии
- `branches` (array) - филиалы при создании (адрес и координаты только у филиалов): `[{ "name": "Филиал 1", "address": "...", "latitude": 56.0, "longitude": 84.0 }]`

**Способ 1: JSON**

**Content-Type:** `application/json`

**Тело запроса (пример):**
```json
{
  "name": "ЭкоПартнер",
  "admin_email": "admin@ecopartner.ru",
  "admin_password": "сгенерированный_пароль",
  "currency": "RUB",
  "exchange_rate_cents_per_coin": 50,
  "logo_url": "https://example.com/logo.png",
  "website_url": "https://ecopartner.ru",
  "photo_urls": ["https://example.com/photo1.jpg"],
  "branches": [
    { "name": "Кафе Луна", "address": "ул. Ленина, 1", "latitude": 56.49, "longitude": 84.98 }
  ]
}
```

Адрес и координаты задаются только у филиалов в `branches`; у партнёра полей `address`, `latitude`, `longitude` нет.

**Способ 2: multipart/form-data с файлами**

**Content-Type:** `multipart/form-data`

**Поля формы:**
- `name`, `admin_email`, `admin_password` (обязательно)
- `currency` (string, обязательно), `exchange_rate_cents_per_coin` (number, обязательно)
- `logo` (file, опционально) - один файл логотипа
- `photos` (file[], опционально) - массив фото (максимум 10)
- `website_url`, `activity` - опционально
- `branches` - JSON-строка массива филиалов (адрес и координаты у каждого филиала): `[{ "name": "...", "address": "...", "latitude": ..., "longitude": ... }]`

**Ограничения для файлов:**
- Максимальный размер файла: 10MB
- Разрешенные форматы: JPEG, PNG, GIF, WebP
- Максимум 10 фото, 1 лого

**Ответ (201):** В `data.partner` возвращается созданный партнёр со всеми полями, включая `currency`, `exchange_rate_cents_per_coin` и `branches` (массив филиалов).
```json
{
  "success": true,
  "message": "Партнер создан",
  "data": {
    "partner": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "ЭкоПартнер",
      "logo_url": "https://joypick.world/uploads/logos/uuid.png",
      "photo_urls": ["https://joypick.world/uploads/photos/uuid1.jpg"],
      "activity": "Переработка пластика",
      "website_url": "https://ecopartner.ru",
      "currency": "RUB",
      "exchange_rate_cents_per_coin": 50,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z",
      "branches": [
        { "id": "uuid", "partner_id": "...", "name": "Кафе Луна", "address": "ул. Ленина, 1", "latitude": 56.49, "longitude": 84.98, "created_at": "...", "updated_at": "..." }
      ]
    }
  }
}
```

**Ошибки:**
- `400` - Ошибка валидации (в т.ч. если не переданы currency или exchange_rate_cents_per_coin)
- `401` - Не авторизован
- `403` - Нет прав администратора

### Обновление партнера

**PUT** `/partners/:id`

**Требует аутентификации и прав администратора**

**Поддерживает multipart/form-data с файлами**

**Content-Type:** `multipart/form-data` или `application/json`

**Поля (все опциональны, обновляются только переданные):**
- `name`, `activity`, `website_url`
- `currency` (string) - валюта скидки (код из GET /api/references/currencies)
- `exchange_rate_cents_per_coin` (int) - скидка в центах за 1 коин (≥ 1)
- `logo_url` (string) или файл `logo` - логотип
- `admin_email` (string) - логин админа партнёра
- `admin_password` (string) - новый пароль (если передан и не пустой — хеш обновляется)
- `photo_urls` (array[string]) или файлы `photos` - фотографии
- `branches` (array) - при передаче полная замена списка филиалов (адрес и координаты только у филиалов): `[{ "name", "address?", "latitude?", "longitude?" }]`

**Ответ (200):**
```json
{
  "success": true,
  "message": "Партнер обновлен",
  "data": {
    "partner": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "ЭкоПартнер (обновлено)",
      ...
    }
  }
}
```

**Ошибки:**
- `404` - Партнер не найден
- `401` - Не авторизован
- `403` - Нет прав администратора

### Удаление партнера

**DELETE** `/partners/:id`

**Требует аутентификации и прав администратора**

**Ответ (200):**
```json
{
  "success": true,
  "message": "Партнер удален",
  "data": null
}
```

**Ошибки:**
- `404` - Партнер не найден
- `401` - Не авторизован
- `403` - Нет прав администратора

### QR для волонтёра (одноразовый токен для скидки у партнёра)

**GET** `/partners/volunteer-qr`

**Требует аутентификации пользователя (JWT волонтёра)**

Волонтёр запрашивает одноразовый токен для отображения в QR. Срок действия токена в секундах задаётся на бэкенде в одном месте (`VOLUNTEER_QR_VALID_SECONDS` в `api/routes/partners.js`), по умолчанию 120 (2 минуты). В ответе передаётся `expiresInSeconds`, чтобы фронт мог использовать одно и то же число (таймер, подсказки). После списания коинов у партнёра токен помечается использованным.

**Ответ (200):**
```json
{
  "success": true,
  "message": "QR token created",
  "data": {
    "token": "64-символьная_hex-строка",
    "expiresAt": "2025-12-01T15:56:00.000Z",
    "expiresInSeconds": 120
  }
}
```

В QR кодируется значение `data.token`; приложение продавца сканирует QR и отправляет этот токен в `POST /api/partner-seller/scan-qr` и затем в `POST /api/partner-seller/redeem`.

### История погашений коинов (волонтёр)

**GET** `/partners/my-redemptions`

**Требует аутентификации пользователя (JWT волонтёра)**

**Query:** `page` (int, по умолчанию 1), `limit` (int, по умолчанию 20, макс. 100)

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "redemptions": [
      {
        "id": "uuid",
        "partnerId": "uuid",
        "partnerName": "Название партнёра",
        "branchId": "uuid",
        "branchName": "Название филиала",
        "coinsSpent": 10,
        "amountCents": 500,
        "currency": "USD",
        "createdAt": "2025-12-01T15:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 5, "totalPages": 1 }
  }
}
```

---

## 🔐 Партнёры: вход и кабинеты (partner-auth, partner-admin, partner-seller)

Вход администратора партнёра — по `/api/partner-auth`. Вход продавца — через единый роут приложения `POST /api/auth/app-login` (логин + пароль, в ответе `role: 'seller'` и данные продавца). Кабинеты используют JWT с типом `partner_admin` или `partner_seller`.

**Базовые пути:**
- Вход админа партнёра: `/api/partner-auth/admin/login`
- Вход продавца: `POST /api/auth/app-login` (единый вход с волонтёром, см. раздел «Единый вход для приложения»)
- Кабинет админа партнёра: `/api/partner-admin` (все запросы с JWT админа партнёра)
- Приложение продавца: `/api/partner-seller` (все запросы с JWT продавца)

Во всех запросах к `/api/partner-admin` и `/api/partner-seller` обязателен заголовок:
```
Authorization: Bearer <jwt_token>
```

---

### Вход администратора партнёра

**POST** `/partner-auth/admin/login`

**Авторизация:** Не требуется (публичный эндпоинт входа)

**Тело (JSON):**
```json
{
  "email": "admin@partner.ru",
  "password": "пароль"
}
```

**Ответ (200):**
```json
{
  "success": true,
  "message": "Вход выполнен",
  "data": {
    "token": "jwt_токен",
    "partner": {
      "id": "uuid_партнёра",
      "name": "Название партнёра",
      "email": "admin@partner.ru"
    }
  }
}
```

**Ошибки:** `400` — валидация; `401` — неверный email или пароль; `403` — пароль не задан.

---

### Вход продавца партнёра

Вход продавца выполняется через **единый роут приложения** `POST /api/auth/app-login` (тело: `login`, `password`). В ответе при совпадении с записью продавца: `role: 'seller'`, `token`, `seller` (id, partnerId, partnerName, fullName, login, jobTitle). Отдельный роут `/partner-auth/seller/login` удалён.

---

### Кабинет админа партнёра (partner-admin)

Все эндпоинты ниже требуют JWT администратора партнёра (`Authorization: Bearer <token>`).

#### Текущий партнёр и настройки

**GET** `/partner-admin/me`

**Ответ (200):** полные данные партнёра в `data.partner` (как GET /api/partners/:id: id, name, logo_url, photo_urls, activity, website_url, admin_email, currency, exchange_rate_cents_per_coin, branches, created_at, updated_at). Поле `admin_password_hash` не возвращается.

---

**PUT** `/partner-admin/settings`

**Тело (JSON):** `currency` (string, опционально), `exchange_rate_cents_per_coin` (int, опционально).

---

**PUT** `/partner-admin/settings/password`

**Тело (JSON):** `current_password`, `new_password` (не менее 6 символов).

---

#### Филиалы (добавление, изменение, удаление)

**GET** `/partner-admin/branches` — список филиалов партнёра.

**POST** `/partner-admin/branches` — добавить филиал.  
**Тело:** `name` (обязательно), `address`, `latitude`, `longitude` (опционально).

**GET** `/partner-admin/branches/:id` — филиал по ID.

**PUT** `/partner-admin/branches/:id` — изменить филиал.  
**Тело:** `name`, `address`, `latitude`, `longitude` (все опциональны).

**DELETE** `/partner-admin/branches/:id` — удалить филиал.

---

#### Продавцы

**GET** `/partner-admin/sellers` — список продавцов.

**POST** `/partner-admin/sellers` — добавить продавца.  
**Тело:** `full_name`, `login`, `password` (не менее 6 символов), `job_title` (опционально).

**GET** `/partner-admin/sellers/:id` — продавец по ID.

**PUT** `/partner-admin/sellers/:id` — изменить продавца (и/или пароль).  
**Тело:** `full_name`, `login`, `password`, `job_title` (все опциональны; пароль — только при смене).

**DELETE** `/partner-admin/sellers/:id` — удалить продавца.

---

#### История погашений коинов

**GET** `/partner-admin/redemptions`

**Query:** `page`, `limit` (по умолчанию 20).

**Ответ (200):** `data.redemptions` — массив записей (дата, филиал, продавец, волонтёр, коины, сумма скидки, валюта), `data.pagination`.

---

### Приложение продавца (partner-seller)

Все эндпоинты требуют JWT продавца партнёра.

**GET** `/partner-seller/me` — профиль продавца и данные партнёра (валюта, курс).

**GET** `/partner-seller/partner`

**Авторизация:** JWT продавца (`Authorization: Bearer <token>`).

**Назначение:** отдаёт данные партнёра, к которому привязан продавец (тот же формат, что у GET /api/partners/:id). Партнёр определяется по JWT (`req.partnerId`), передавать id в URL не нужно.

**Поля партнёра:** `id`, `name`, `logo_url`, `photo_urls`, `activity`, `website_url`, `admin_email`, `currency`, `exchange_rate_cents_per_coin`, `created_at`, `updated_at`, `branches` (массив филиалов с полями: `id`, `partner_id`, `name`, `address`, `latitude`, `longitude`, `created_at`, `updated_at`).

**Не отдаётся:** `admin_password_hash`.

---

**GET** `/partner-seller/branches` — список филиалов для выбора при списании.

---

**GET** `/partner-seller/redemptions`

**Авторизация:** JWT продавца (`Authorization: Bearer <token>`).

**Назначение:** отдаёт все погашения (транзакции), где `seller_id` совпадает с текущим продавцом.

**Query:** `page` (по умолчанию 1), `limit` (по умолчанию 20, макс. 100).

**Ответ (200):** в `data`:
- **redemptions** — массив: `id`, `partnerId`, `partnerName`, `branchId`, `branchName`, `sellerId`, `userId`, `userDisplayName`, `coinsSpent`, `amountCents`, `currency`, `createdAt`;
- **pagination** — `page`, `limit`, `total`, `totalPages`.

```json
{
  "success": true,
  "data": {
    "redemptions": [
      {
        "id": "uuid",
        "partnerId": "uuid",
        "partnerName": "Название партнёра",
        "branchId": "uuid",
        "branchName": "Название филиала",
        "sellerId": "uuid",
        "userId": "uuid",
        "userDisplayName": "Имя волонтёра",
        "coinsSpent": 10,
        "amountCents": 500,
        "currency": "USD",
        "createdAt": "2025-12-01T15:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 5, "totalPages": 1 }
  }
}
```

---

**POST** `/partner-seller/scan-qr`

Проверка QR-токена волонтёра (токен из `GET /partners/volunteer-qr`).

**Тело (JSON):**
```json
{
  "qr_token": "64-символьная_строка_из_QR"
}
```

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "qrTokenId": "uuid",
    "volunteer": {
      "userId": "uuid",
      "displayName": "Имя волонтёра",
      "email": "email",
      "jcoins": 100
    }
  }
}
```

**Ошибки:** `400` — недействительный/использованный/истёкший токен.

---

**POST** `/partner-seller/redeem`

Списание коинов у волонтёра. QR-токен после успешного списания помечается использованным.

**Тело (JSON):**
```json
{
  "qr_token": "токен_из_QR",
  "branch_id": "uuid_филиала",
  "coins_spent": 10
}
```

**Ответ (200):**
```json
{
  "success": true,
  "message": "Redeemed 10 coins. Discount: 5.00 USD",
  "data": {
    "redemption": {
      "id": "uuid",
      "coinsSpent": 10,
      "amountCents": 500,
      "currency": "USD",
      "volunteerNewBalance": 90
    }
  }
}
```

В `redemption.volunteerNewBalance` — баланс коинов волонтёра после списания (для проверки на клиенте).

**Ошибки:** `400` — неверный/использованный/истёкший QR, недостаточно коинов у волонтёра, неверный филиал; `404` — филиал не найден; `500` — ошибка обновления баланса.

---

## ♻️ Станции переработки

API для управления станциями переработки. Станции переработки - это места, где можно сдать мусор на переработку.

### Модель RecyclingStation

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `id` | string (UUID) | Нет (автогенерация) | Уникальный идентификатор станции |
| `name` | string | Да | Название станции переработки |
| `photo_urls` | array[string] | Нет | Массив URL фотографий станции (JSON) |
| `latitude` | float | Нет | Широта местоположения |
| `longitude` | float | Нет | Долгота местоположения |
| `address` | string | Нет | Адрес станции |
| `activity` | string | Нет | Деятельность/описание станции |
| `website_url` | string (URL) | Нет | URL сайта станции |
| `accepted_waste_types` | array[object] | Нет | Массив типов мусора для переработки (как в requests.waste_types) |
| `created_at` | datetime | Нет (автогенерация) | Дата создания |
| `updated_at` | datetime | Нет (автогенерация) | Дата обновления |

**Формат `accepted_waste_types`:**
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

### Получение списка станций переработки

**GET** `/recycling-stations`

**Авторизация:** Не требуется (публичный эндпоинт)

**Query параметры:**
- `page` (int, опционально) - номер страницы (по умолчанию 1)
- `limit` (int, опционально) - количество на странице (по умолчанию 20, максимум 100)
- `latitude` (float, опционально) - широта для поиска по радиусу
- `longitude` (float, опционально) - долгота для поиска по радиусу
- `radius` (int, опционально) - радиус поиска в метрах (по умолчанию 10000)
- `waste_type` (string, опционально) - фильтр по типу мусора (поиск в accepted_waste_types)

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "stations": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Станция переработки \"ЭкоТомск\"",
        "photo_urls": ["https://joypick.world/uploads/photos/uuid1.jpg"],
        "latitude": 56.4962847,
        "longitude": 84.9802779,
        "address": "г. Томск, ул. Экологическая, д. 10",
        "activity": "Прием и переработка пластика, стекла, бумаги",
        "website_url": "https://ecotomsk.ru",
        "accepted_waste_types": [
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
        ],
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

### Получение станции переработки по ID

**GET** `/recycling-stations/:id`

**Авторизация:** Не требуется (публичный эндпоинт)

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "station": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Станция переработки \"ЭкоТомск\"",
      "photo_urls": ["https://joypick.world/uploads/photos/uuid1.jpg"],
      "latitude": 56.4962847,
      "longitude": 84.9802779,
      "address": "г. Томск, ул. Экологическая, д. 10",
      "activity": "Прием и переработка пластика, стекла, бумаги",
      "website_url": "https://ecotomsk.ru",
      "accepted_waste_types": [
        {
          "id": "550e8400-e29b-41d4-a716-446655440000",
          "name": "Пластик",
          "danger": false
        }
      ],
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

**Ошибки:**
- `404` - Станция переработки не найдена

### Создание станции переработки

**POST** `/recycling-stations`

**Требует аутентификации и прав администратора**

**Поддерживает multipart/form-data с файлами**

**Content-Type:** `multipart/form-data` или `application/json`

**Поля формы:**
- `name` (string, обязательное) - название станции
- `latitude` (float, опционально) - широта
- `longitude` (float, опционально) - долгота
- `address` (string, опционально) - адрес
- `activity` (string, опционально) - деятельность/описание
- `website_url` (string, опционально) - URL сайта
- `photos` (file[], опционально) - массив файлов для фото (максимум 10)
- `accepted_waste_types` (array[object], опционально) - типы мусора для переработки

**Пример JSON запроса:**
```json
{
  "name": "Станция переработки \"ЭкоТомск\"",
  "latitude": 56.4962847,
  "longitude": 84.9802779,
  "address": "г. Томск, ул. Экологическая, д. 10",
  "activity": "Прием и переработка пластика, стекла, бумаги",
  "website_url": "https://ecotomsk.ru",
  "accepted_waste_types": [
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
}
```

**Ответ (201):**
```json
{
  "success": true,
  "message": "Станция переработки создана",
  "data": {
    "station": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Станция переработки \"ЭкоТомск\"",
      ...
    }
  }
}
```

**Ошибки:**
- `400` - Ошибка валидации
- `401` - Не авторизован
- `403` - Нет прав администратора

### Обновление станции переработки

**PUT** `/recycling-stations/:id`

**Требует аутентификации и прав администратора**

**Поддерживает multipart/form-data с файлами**

**Content-Type:** `multipart/form-data` или `application/json`

**Поля (все опциональны, обновляются только переданные):**
- `name` (string) - название станции
- `latitude` (float) - широта
- `longitude` (float) - долгота
- `address` (string) - адрес
- `activity` (string) - деятельность
- `website_url` (string) - URL сайта
- `photo_urls` (array[string] или file[]) - фотографии
- `accepted_waste_types` (array[object]) - типы мусора

**Ответ (200):**
```json
{
  "success": true,
  "message": "Станция переработки обновлена",
  "data": {
    "station": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      ...
    }
  }
}
```

**Ошибки:**
- `404` - Станция переработки не найдена
- `401` - Не авторизован
- `403` - Нет прав администратора

### Удаление станции переработки

**DELETE** `/recycling-stations/:id`

**Требует аутентификации и прав администратора**

**Ответ (200):**
```json
{
  "success": true,
  "message": "Станция переработки удалена",
  "data": null
}
```

**Ошибки:**
- `404` - Станция переработки не найдена
- `401` - Не авторизован
- `403` - Нет прав администратора

---

## 🗑️ Типы отходов (Waste Types)

API для управления типами отходов. Типы отходов используются в заявках для указания категории мусора.

**Важно:** В заявках поле `waste_types` хранится как JSON-массив названий типов отходов (например: `["plastic", "glass"]`). Таблица `waste_types` используется только как справочник для CRUD операций и не связана с заявками через внешние ключи.

### Модель WasteType

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `id` | string (UUID) | Нет (автогенерация) | Уникальный идентификатор типа отходов |
| `name` | string | Да | Название типа отходов (в нижнем регистре, уникальное) |
| `danger` | boolean | Нет | Флаг опасности (true - опасный, false - обычный, по умолчанию false) |
| `created_at` | datetime | Нет (автогенерация) | Дата создания |
| `updated_at` | datetime | Нет (автогенерация) | Дата обновления |

### Получение списка всех типов отходов

**GET** `/waste-types`

**Авторизация:** Не требуется (публичный эндпоинт)

**Параметры запроса:** Нет

**Успешный ответ (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-1",
      "name": "plastic",
      "danger": false,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "uuid-2",
      "name": "toxic",
      "danger": true,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**Пример запроса (Flutter):**

```dart
Future<List<Map<String, dynamic>>> getWasteTypes() async {
  final response = await http.get(
    Uri.parse('$baseUrl/waste-types'),
    headers: {'Content-Type': 'application/json'},
  );

  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(data['data']);
  } else {
    throw Exception('Ошибка получения типов отходов: ${response.body}');
  }
}
```

### Получение типа отходов по ID

**GET** `/waste-types/:id`

**Авторизация:** Не требуется

**Параметры пути:**
- `id` (UUID) - ID типа отходов

**Успешный ответ (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "plastic",
    "danger": false,
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**Ошибка (404):**

```json
{
  "success": false,
  "message": "Тип отходов не найден",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Создание типа отходов

**POST** `/waste-types`

**Авторизация:** Требуется (только для администраторов)

**Тело запроса:**

```json
{
  "name": "plastic",
  "danger": false
}
```

**Параметры:**

| Параметр | Тип | Обязательное | Описание |
|----------|-----|--------------|----------|
| `name` | string | Да | Название типа отходов (будет автоматически преобразовано в нижний регистр) |
| `danger` | boolean | Нет | Флаг опасности (по умолчанию false) |

**Успешный ответ (201):**

```json
{
  "success": true,
  "message": "Тип отходов успешно создан",
  "data": {
    "id": "uuid",
    "name": "plastic",
    "danger": false,
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**Ошибка (400):**

```json
{
  "success": false,
  "message": "Ошибка валидации",
  "errors": [
    {
      "field": "name",
      "message": "Название обязательно"
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Ошибка (409):**

```json
{
  "success": false,
  "message": "Тип отходов с таким названием уже существует",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Пример запроса (Flutter):**

```dart
Future<Map<String, dynamic>> createWasteType({
  required String name,
  bool danger = false,
}) async {
  final token = await getToken();
  final response = await http.post(
    Uri.parse('$baseUrl/waste-types'),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    },
    body: jsonEncode({
      'name': name,
      'danger': danger,
    }),
  );

  if (response.statusCode == 201) {
    final data = jsonDecode(response.body);
    return data['data'];
  } else {
    throw Exception('Ошибка создания типа отходов: ${response.body}');
  }
}
```

### Обновление типа отходов

**PUT** `/waste-types/:id`

**Авторизация:** Требуется (только для администраторов)

**Параметры пути:**
- `id` (UUID) - ID типа отходов

**Тело запроса:**

```json
{
  "name": "plastic",
  "danger": true
}
```

**Параметры:**

| Параметр | Тип | Обязательное | Описание |
|----------|-----|--------------|----------|
| `name` | string | Нет | Название типа отходов (будет автоматически преобразовано в нижний регистр) |
| `danger` | boolean | Нет | Флаг опасности |

**Успешный ответ (200):**

```json
{
  "success": true,
  "message": "Тип отходов успешно обновлен",
  "data": {
    "id": "uuid",
    "name": "plastic",
    "danger": true,
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:01:00.000Z"
  }
}
```

**Ошибка (404):**

```json
{
  "success": false,
  "message": "Тип отходов не найден",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Ошибка (409):**

```json
{
  "success": false,
  "message": "Тип отходов с таким названием уже существует",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Удаление типа отходов

**DELETE** `/waste-types/:id`

**Авторизация:** Требуется (только для администраторов)

**Параметры пути:**
- `id` (UUID) - ID типа отходов

**Успешный ответ (200):**

```json
{
  "success": true,
  "message": "Тип отходов успешно удален"
}
```

**Ошибка (400):**

```json
{
  "success": false,
  "message": "Невозможно удалить тип отходов, так как он используется в заявках",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Ошибка (404):**

```json
{
  "success": false,
  "message": "Тип отходов не найден",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Пример запроса (Flutter):**

```dart
Future<void> deleteWasteType(String id) async {
  final token = await getToken();
  final response = await http.delete(
    Uri.parse('$baseUrl/waste-types/$id'),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    },
  );

  if (response.statusCode != 200) {
    throw Exception('Ошибка удаления типа отходов: ${response.body}');
  }
}
```

### Начальные типы отходов

После создания таблицы в базе данных автоматически добавляются следующие типы отходов:

**Обычные типы (danger: false):**
- `plastic` - Пластик
- `glass` - Стекло
- `paper` - Бумага
- `cardboard` - Картон
- `metal` - Металл
- `organic` - Органические отходы
- `tires` - Шины
- `liquid` - Жидкие отходы
- `furniture` - Мебель
- `construction` - Строительные отходы
- `household waste` - Бытовые отходы
- `bottles and cans` - Бутылки и банки

**Опасные типы (danger: true):**
- `electronic` - Электроника
- `toxic` - Токсичные отходы
- `dead animals` - Мертвые животные

### Важные замечания

1. **Публичный доступ:** GET эндпоинты доступны без авторизации, так как типы отходов используются в публичных формах создания заявок.

2. **Административный доступ:** POST, PUT, DELETE эндпоинты доступны только администраторам.

3. **Валидация:** 
   - `name` обязателен и должен быть уникальным
   - `name` автоматически преобразуется в нижний регистр
   - `danger` по умолчанию false

4. **Безопасность удаления:** При удалении типа отходов проверяется, не используется ли он в существующих заявках. Если используется - удаление запрещено.

5. **Формат дат:** Все даты в формате ISO 8601: `2024-01-01T00:00:00.000Z`

---

## 📋 Справочники (References)

Публичные справочники для выбора значений в формах (валюта, и т.д.). Авторизация не требуется.

**Базовый путь:** `/api/references`

### Справочник валют

**GET** `/references/currencies`

**Авторизация:** Не требуется

Используется в админке при настройке партнёра: выбор валюты скидки за коины (`partners.currency`). В ответе — список валют с кодом и названием.

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "currencies": [
      { "code": "USD", "name": "Доллар США" },
      { "code": "CAD", "name": "Канадский доллар" },
      { "code": "EUR", "name": "Евро" },
      { "code": "GBP", "name": "Фунт стерлингов" },
      { "code": "CHF", "name": "Швейцарский франк" },
      { "code": "AUD", "name": "Австралийский доллар" },
      { "code": "NZD", "name": "Новозеландский доллар" },
      { "code": "JPY", "name": "Японская иена" },
      { "code": "CNY", "name": "Китайский юань" },
      { "code": "HKD", "name": "Гонконгский доллар" },
      { "code": "SGD", "name": "Сингапурский доллар" },
      { "code": "KRW", "name": "Южнокорейская вона" },
      { "code": "INR", "name": "Индийская рупия" },
      { "code": "RUB", "name": "Российский рубль" },
      { "code": "UAH", "name": "Гривна" },
      { "code": "BYN", "name": "Белорусский рубль" },
      { "code": "KZT", "name": "Тенге" },
      { "code": "TRY", "name": "Турецкая лира" },
      { "code": "BRL", "name": "Бразильский реал" },
      { "code": "MXN", "name": "Мексиканское песо" },
      { "code": "ZAR", "name": "Южноафриканский ранд" },
      { "code": "PLN", "name": "Польский злотый" },
      { "code": "CZK", "name": "Чешская крона" },
      { "code": "SEK", "name": "Шведская крона" },
      { "code": "NOK", "name": "Норвежская крона" },
      { "code": "DKK", "name": "Датская крона" },
      { "code": "THB", "name": "Тайский бат" },
      { "code": "IDR", "name": "Индонезийская рупия" },
      { "code": "MYR", "name": "Малайзийский ринггит" },
      { "code": "PHP", "name": "Филиппинское песо" },
      { "code": "AED", "name": "Дирхам ОАЭ" },
      { "code": "SAR", "name": "Саудовский риял" },
      { "code": "ILS", "name": "Новый израильский шекель" },
      { "code": "EGP", "name": "Египетский фунт" }
    ]
  }
}
```

При сохранении партнёра в API передаётся поле `currency` со значением `code` (например, `"USD"`, `"RUB"`).

---

## 🔔 Push-уведомления

Сервер автоматически отправляет push-уведомления пользователям через Firebase Cloud Messaging (FCM) при различных событиях в приложении. Все уведомления отправляются асинхронно и не блокируют ответы API.

### Автоматические уведомления

#### 1. При создании заявки

Когда пользователь создает новую заявку с координатами, сервер автоматически отправляет push-уведомления всем пользователям в радиусе **10 км** от места заявки.

**Триггер:** `POST /api/requests` (создание заявки с `latitude` и `longitude`)

**Получатели:** Все пользователи в радиусе 10 км (кроме создателя заявки)

**Формат уведомления:**
- **Заголовок:** `New {Category}` (например, "New Waste Location", "New Speed Clean-up", "New Event")
- **Текст:** `{Название заявки}\nCreated by: {Имя создателя}`
- **Изображение:** Первое фото заявки (если есть)
- **Deeplink:** Переход на страницу деталей заявки

**Пример:**
```
Title: New Waste Location
Body: Уборка парка
Created by: Иван Иванов
```

#### 2. При присоединении к заявке

Когда пользователь присоединяется к заявке типа `wasteLocation`, создатель заявки получает уведомление.

**Триггер:** `POST /api/requests/:id/join`

**Получатель:** Создатель заявки (если это не тот же пользователь)

**Формат уведомления:**
- **Заголовок:** `Someone joined your request`
- **Текст:** `{Имя пользователя} joined your request "{Название заявки}"`
- **Deeplink:** Переход на страницу деталей заявки

**Пример:**
```
Title: Someone joined your request
Body: Петр Петров joined your request "Уборка парка"
```

#### 3. При участии в событии

Когда пользователь присоединяется к событию (event), создатель события получает уведомление.

**Триггер:** `POST /api/requests/:id/participate`

**Получатель:** Создатель события (если это не тот же пользователь)

**Формат уведомления:**
- **Заголовок:** `Someone joined your event`
- **Текст:** `{Имя пользователя} joined your event "{Название события}"`
- **Deeplink:** Переход на страницу деталей события

**Пример:**
```
Title: Someone joined your event
Body: Мария Сидорова joined your event "Экологический субботник"
```

#### 4. При донате

Когда пользователь делает донат на заявку, создатель заявки получает уведомление с информацией о сумме и донаторе.

**Триггер:** `POST /api/donations`

**Получатель:** Создатель заявки (если это не тот же пользователь)

**Формат уведомления:**
- **Заголовок:** `Someone donated to your request`
- **Текст:** `{Имя донатора} donated ${Сумма} to your request "{Название заявки}"`
- **Deeplink:** Переход на страницу деталей заявки

**Пример:**
```
Title: Someone donated to your request
Body: Алексей Смирнов donated $25.00 to your request "Уборка парка"
```

#### 5. При отправке заявки на модерацию

**Если `AUTO_MODERATION_ENABLED` выключен:** при переходе в `pending` все модераторы получают push «New Request for Moderation».

**Если автомодерация включена:** при `pending` этот пуш **не** отправляется. Модераторы получают push только при **proposed reject** (см. раздел автомодерации: `moderation_auto_reject_pending` / `Auto-moderation: proposed reject`) — после `runIntegrityOnPending` или иного `proposeModerationDecision` с `action=reject`.

**Триггер (ручная очередь):** `PUT /api/requests/:id` → `pending` (speed), `POST …/participant-completion` (waste), `POST …/close-by-creator` (event) — только при выключенной автомодерации.

**Получатели:** Все администраторы (`admin = TRUE`, валидный FCM)

**Формат (ручная очередь):**
- **Заголовок:** `New Request for Moderation`
- **Текст:** `{Категория}: "{Название заявки}"\nCreated by: {Имя создателя}`
- **Deeplink:** Переход на страницу заявки в админ-панели

**Пример:**
```
Title: New Request for Moderation
Body: Waste Location: "Уборка парка"
Created by: Иван Иванов
```

**Deeplink формат:**
```
https://garbagedev-9c240.web.app/admin/requests/{requestId}
```

**Важно:**
- Уведомление отправляется только при переходе из другого статуса в `pending` (не при создании заявки со статусом `pending`)
- Deeplink ведет на страницу заявки в админ-панели, где модератор может одобрить или отклонить заявку
- Если у администратора нет FCM токена, уведомление не отправляется

### Ручная отправка уведомлений (только для админов)

Администраторы могут отправлять push-уведомления конкретным пользователям через специальный эндпоинт.

#### Отправка уведомлений пользователям

**Эндпоинт:** `POST /api/notifications/send`

**Требования:**
- Аутентификация: Да (только админы)
- Метод: `POST`
- Content-Type: `application/json`

**Тело запроса:**

```json
{
  "title": "Заголовок уведомления",
  "body": "Текст уведомления",
  "user_ids": [
    "353f958d-8796-44c7-a877-3e376eca6784",
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  ],
  "image_url": "https://example.com/image.jpg",  // Опционально
  "sound": "default",  // Опционально, по умолчанию "default"
  "data": {  // Опционально, дополнительные данные для навигации
    "initialPageName": "SomePage",
    "parameterData": "{\"key\":\"value\"}",
    "deeplink": "https://garbagedev-9c240.web.app/some/page"
  },
  "trigger": "admin_manual",  // Опционально: код/метка триггера (для истории в админке)
  "send_reason": "Напоминание участникам заявки",  // Опционально: зачем отправили (то же можно передать как `reason`)
  "request_id": "353f958d-8796-44c7-a877-3e376eca6784"  // Опционально: заявка; если не указать — сервер попробует взять из `data.request_id` / `requestId` / UUID в `deeplink` / JSON в `parameterData`
}
```

**Параметры:**

| Параметр | Тип | Обязательное | Описание |
|----------|-----|--------------|----------|
| `title` | string | Да | Заголовок уведомления |
| `body` | string | Да | Текст уведомления |
| `user_ids` | array[string] | Да | Массив UUID пользователей-получателей (минимум 1) |
| `image_url` | string | Нет | URL изображения для уведомления |
| `sound` | string | Нет | Звук уведомления (по умолчанию "default") |
| `data` | object | Нет | Дополнительные данные для навигации в приложении |
| `trigger` | string | Нет | Тип или источник рассылки (до 255 символов), сохраняется в истории |
| `send_reason` | string | Нет | Текст «почему отправили» (до 8000 символов) |
| `reason` | string | Нет | Синоним `send_reason` (не путать с полем `reason` в ответе об ошибке 400) |
| `request_id` | string (UUID) | Нет | ID заявки; если не передан, сервер пытается извлечь UUID из `data` |

**Успешный ответ (200):**

```json
{
  "success": true,
  "message": "Отправлено 2 из 2 уведомлений",
  "data": {
    "sent": 2,
    "failed": 0,
    "total": 2
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Ответ с частичной отправкой (200):**

Если хотя бы одно уведомление отправилось успешно, возвращается `200`:

```json
{
  "success": true,
  "message": "Отправлено 1 из 2 уведомлений",
  "data": {
    "sent": 1,
    "failed": 1,
    "total": 2
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Ошибка отправки (400):**

Если **ни одно** уведомление не отправилось, возвращается ошибка `400`:

```json
{
  "success": false,
  "message": "Не удалось отправить уведомления: у пользователей нет FCM токенов",
  "data": {
    "sent": 0,
    "failed": 1,
    "total": 1,
    "reason": "У пользователей отсутствуют FCM токены. Пользователи без токенов: user@example.com"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Примеры причин ошибок в поле `reason`:**

- `"У пользователей отсутствуют FCM токены. Пользователи без токенов: user@example.com"` - у указанных пользователей нет FCM токенов
- `"У пользователей отсутствуют FCM токены. Пользователи не найдены: uuid1, uuid2"` - указанные пользователи не найдены в БД
- `"Токен abc123...: messaging/invalid-registration-token - Invalid registration token"` - токен невалиден
- `"Ошибка при отправке через FCM: Network error"` - ошибка сети при отправке

**Ошибки:**

- `400` - Ошибка валидации (неверные параметры) или ошибка отправки уведомлений
  - Если у пользователей нет FCM токенов или все уведомления не отправились, возвращается `400` с детальной информацией:
  ```json
  {
    "success": false,
    "message": "Не удалось отправить уведомления: у пользователей нет FCM токенов",
    "data": {
      "sent": 0,
      "failed": 1,
      "total": 1,
      "reason": "У пользователей отсутствуют FCM токены. Пользователи без токенов: user@example.com"
    }
  }
  ```
- `401` - Не авторизован
- `403` - Доступ запрещен (не админ)
- `500` - Ошибка сервера

**Важно:**
- Если **ни одно** уведомление не отправилось (`sent: 0`), API возвращает ошибку **400** (не 200)
- В поле `reason` содержится детальная информация о причине ошибки:
  - Если пользователи не найдены в БД
  - Если у пользователей отсутствуют FCM токены (с указанием email пользователей)
  - Если токены невалидны (с кодами ошибок FCM)
- Если хотя бы одно уведомление отправилось успешно, возвращается `200` с информацией о количестве отправленных и неудачных уведомлений

**Пример запроса (Flutter):**

```dart
Future<Map<String, dynamic>> sendNotificationToUsers({
  required String title,
  required String body,
  required List<String> userIds,
  String? imageUrl,
  Map<String, dynamic>? data,
}) async {
  final token = await getToken();
  final response = await http.post(
    Uri.parse('$baseUrl/notifications/send'),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    },
    body: jsonEncode({
      'title': title,
      'body': body,
      'user_ids': userIds,
      if (imageUrl != null) 'image_url': imageUrl,
      if (data != null) 'data': data,
    }),
  );

  final data = jsonDecode(response.body);
  
  if (response.statusCode == 200) {
    return data;
  } else if (response.statusCode == 400) {
    // Детальная информация об ошибке
    final reason = data['data']?['reason'] ?? 'Неизвестная ошибка';
    throw Exception('Ошибка отправки уведомлений: ${data['message']}. Причина: $reason');
  } else {
    throw Exception('Ошибка отправки уведомлений: ${response.body}');
  }
}
```

#### Журнал исходящих push (админка)

В таблицу `admin_notification_sends` пишется **каждая** отправка через `sendNotificationToUsers` (модерация, закрытие заявки, донаты, напоминания, крон и т.д.) и отдельно пуш «новая заявка рядом» по координатам. Ручной массовый `POST /api/notifications/send` помечается **`source`: `admin_manual`** и `sent_by_user_id`; остальное — **`source`: `system`**, `sent_by_user_id` обычно отсутствует. Поле **`trigger`** для системных чаще берётся из `data.type`, иначе служебная метка (например `system_push`, `request_created_nearby`). Для ручной рассылки по-прежнему можно передать `trigger` / `send_reason` / `request_id` в теле `POST /send`.

Требуется миграция **`036_admin_notification_sends_source.sql`** (поле `send_source` в БД).

Отдельно в `push_notifications` по-прежнему пишется инбокс **каждого** получателя (если логика сохранения включена для этого сценария).

**Эндпоинт:** `GET /api/notifications/admin/sent`

**Требования:** аутентификация, только админ (как у `POST /send`).

**Query:**

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|--------------|----------|
| `page` | integer | `1` | Номер страницы (с 1) |
| `limit` | integer | `20` | Размер страницы (макс. `100`) |

**Успешный ответ (200):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "title": "Заголовок",
        "body": "Текст",
        "source": "admin_manual",
        "trigger": "admin_request_reminder",
        "send_reason": "Напоминание перед датой мероприятия",
        "request_id": "353f958d-8796-44c7-a877-3e376eca6784",
        "data": {
          "deeplink": "https://garbagedev-9c240.web.app/request/event/353f958d-8796-44c7-a877-3e376eca6784"
        },
        "sent_at": "2026-01-15T12:00:00.000Z",
        "recipient_count": 120,
        "success_count": 118,
        "failed_count": 2,
        "sent_by_user_id": "353f958d-8796-44c7-a877-3e376eca6784",
        "image_url": "https://example.com/image.jpg"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 57,
      "totalPages": 3
    }
  }
}
```

Поле **`source`**: `admin_manual` | `system`. Поля `sent_by_user_id`, `image_url`, `trigger`, `send_reason`, `request_id` могут быть `null`. `data` — payload push (для ручной рассылки — из тела `POST /send`). Список от новых к старым. При отсутствии записей: `items: []`, `total: 0`.

**Ошибки:** `401`, `403` (не админ), `500`.

#### Одна запись истории рассылки

**Эндпоинт:** `GET /api/notifications/admin/sent/:id`

**Требования:** аутентификация, только админ (как у списка и у `POST /send`).

**Параметр пути:** `id` — UUID записи из `items[].id` ответа `GET .../admin/sent`.

**Успешный ответ (200):**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "send": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "title": "Заголовок",
      "body": "Текст",
      "source": "admin_manual",
      "trigger": "admin_request_reminder",
      "send_reason": "Напоминание перед датой мероприятия",
      "request_id": "353f958d-8796-44c7-a877-3e376eca6784",
      "data": {},
      "sent_at": "2026-01-15T12:00:00.000Z",
      "recipient_count": 120,
      "success_count": 118,
      "failed_count": 2,
      "sent_by_user_id": "353f958d-8796-44c7-a877-3e376eca6784",
      "image_url": "https://example.com/image.jpg"
    },
    "request": null
  }
}
```

- **`send`** — тот же объект, что элементы массива `items` в списке истории (поля и смысл совпадают).
- **`request`** — объект заявки **в точности как** в успешном ответе `GET /api/requests/:id` в поле **`data.request`** (включая донаты, фото, нормализацию дат и т.д.), если в записи рассылки указан `request_id` и заявка с таким id существует в БД. Если `request_id` нет, заявка удалена или не найдена — **`request`: `null`**.

**Ошибки:** `400` (невалидный UUID в `:id`), `401`, `403`, `404` (нет записи истории с таким `id`), `500`.

### Получение списка уведомлений

Все отправленные push-уведомления автоматически сохраняются в базе данных. Пользователи могут просматривать историю своих уведомлений через API.

#### Получение списка уведомлений

**Эндпоинт:** `GET /api/notifications`

**Требования:**
- Аутентификация: Да
- Метод: `GET`

**Query параметры:**

| Параметр | Тип | Обязательное | Описание |
|----------|-----|--------------|----------|
| `page` | integer | Нет | Номер страницы (по умолчанию: 1) |
| `limit` | integer | Нет | Количество на странице (по умолчанию: 20, максимум: 100) |
| `read` | boolean | Нет | Фильтр по прочитанности (`true` - только прочитанные, `false` - только непрочитанные) |

**Успешный ответ (200):**

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "user_id": "353f958d-8796-44c7-a877-3e376eca6784",
        "title": "Thank you!",
        "body": "You've earned a coin for your cleanup work!",
        "data": {
          "type": "speedCleanup",
          "earnedCoin": true,
          "requestId": "660e8400-e29b-41d4-a716-446655440000"
        },
        "read": false,
        "created_at": "2024-01-01T10:00:00.000Z",
        "updated_at": "2024-01-01T10:00:00.000Z"
      },
      {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "user_id": "353f958d-8796-44c7-a877-3e376eca6784",
        "title": "Someone joined your request",
        "body": "Петр Петров joined your request \"Уборка парка\"",
        "data": {
          "type": "join",
          "requestId": "660e8400-e29b-41d4-a716-446655440001",
          "actionType": "joined"
        },
        "read": true,
        "created_at": "2024-01-01T09:00:00.000Z",
        "updated_at": "2024-01-01T09:05:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  }
}
```

**Примеры запросов:**

```
GET /api/notifications
GET /api/notifications?page=2&limit=10
GET /api/notifications?read=false
GET /api/notifications?read=true&page=1&limit=50
```

#### Отметить уведомление как прочитанное

**Эндпоинт:** `PUT /api/notifications/:id/read`

**Требования:**
- Аутентификация: Да
- Метод: `PUT`

**Параметры пути:**
- `id` (UUID) - ID уведомления

**Успешный ответ (200):**

```json
{
  "success": true,
  "message": "Уведомление отмечено как прочитанное"
}
```

**Ошибка (404):**

```json
{
  "success": false,
  "message": "Уведомление не найдено"
}
```

#### Отметить все уведомления как прочитанные

**Эндпоинт:** `PUT /api/notifications/read-all`

**Требования:**
- Аутентификация: Да
- Метод: `PUT`

**Успешный ответ (200):**

```json
{
  "success": true,
  "message": "Отмечено 5 уведомлений как прочитанных",
  "data": {
    "updated": 5
  }
}
```

#### Получить количество непрочитанных уведомлений

**Эндпоинт:** `GET /api/notifications/unread-count`

**Требования:**
- Аутентификация: Да
- Метод: `GET`

**Успешный ответ (200):**

```json
{
  "success": true,
  "data": {
    "unreadCount": 3
  }
}
```

**Пример запроса (Flutter):**

```dart
Future<List<Map<String, dynamic>>> getNotifications({
  int page = 1,
  int limit = 20,
  bool? read,
}) async {
  final token = await getToken();
  final queryParams = {
    'page': page.toString(),
    'limit': limit.toString(),
    if (read != null) 'read': read.toString(),
  };
  
  final uri = Uri.parse('$baseUrl/notifications').replace(
    queryParameters: queryParams,
  );
  
  final response = await http.get(
    uri,
    headers: {
      'Authorization': 'Bearer $token',
    },
  );
  
  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(data['data']['notifications']);
  } else {
    throw Exception('Ошибка получения уведомлений: ${response.body}');
  }
}

Future<void> markNotificationAsRead(String notificationId) async {
  final token = await getToken();
  final response = await http.put(
    Uri.parse('$baseUrl/notifications/$notificationId/read'),
    headers: {
      'Authorization': 'Bearer $token',
    },
  );
  
  if (response.statusCode != 200) {
    throw Exception('Ошибка отметки уведомления: ${response.body}');
  }
}

Future<void> markAllNotificationsAsRead() async {
  final token = await getToken();
  final response = await http.put(
    Uri.parse('$baseUrl/notifications/read-all'),
    headers: {
      'Authorization': 'Bearer $token',
    },
  );
  
  if (response.statusCode != 200) {
    throw Exception('Ошибка отметки всех уведомлений: ${response.body}');
  }
}

Future<int> getUnreadCount() async {
  final token = await getToken();
  final response = await http.get(
    Uri.parse('$baseUrl/notifications/unread-count'),
    headers: {
      'Authorization': 'Bearer $token',
    },
  );
  
  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    return data['data']['unreadCount'] as int;
  } else {
    throw Exception('Ошибка получения количества уведомлений: ${response.body}');
  }
}
```

**Важно:**
- Все отправленные push-уведомления автоматически сохраняются в базе данных
- Уведомления сохраняются даже если FCM отправка не удалась (для истории)
- Поле `data` содержит дополнительные данные для навигации (type, requestId и т.д.)
- Уведомления сортируются по дате создания (новые сначала)
- Пользователь может видеть только свои уведомления

### Технические детали

#### FCM токены

- FCM токены хранятся в поле `fcm_token` таблицы `users`
- Токены обновляются при обновлении профиля пользователя через `PUT /api/users/:id`
- Невалидные токены автоматически логируются (в будущем можно добавить автоматическое удаление)

#### Отправка батчами

- Уведомления отправляются батчами по **500 токенов** (лимит FCM)
- При большом количестве получателей уведомления отправляются параллельно

#### Обработка ошибок

- **Для ручной отправки (`POST /api/notifications/send`):**
  - Если **ни одно** уведомление не отправилось, возвращается ошибка **400** (не 200)
  - В ответе содержится детальная информация о причине ошибки в поле `reason`:
    - Если пользователи не найдены в БД - указываются их ID
    - Если у пользователей нет FCM токенов - указываются email пользователей без токенов
    - Если токены невалидны - указываются коды ошибок FCM (например: `messaging/invalid-registration-token`)
  - Если хотя бы одно уведомление отправилось успешно, возвращается `200` с информацией о количестве отправленных и неудачных уведомлений

- **Для автоматических уведомлений:**
  - Все ошибки отправки логируются, но не прерывают основной процесс
  - Если у пользователя нет FCM токена, уведомление просто пропускается
  - Невалидные токены логируются для последующей очистки

#### Проверка наличия токенов

При ручной отправке уведомлений сервер автоматически проверяет:
1. Существуют ли указанные пользователи в БД
2. Есть ли у них FCM токены
3. Валидны ли токены при отправке через FCM

Если токены отсутствуют или невалидны, в ответе указывается конкретная причина для каждого случая.

#### Deeplink формат

Все автоматические уведомления содержат deeplink для перехода на соответствующую страницу:

```
https://garbagedev-9c240.web.app/request/{category_path}/{request_id}
```

Где `category_path`:
- `waste_location` - для заявок типа `wasteLocation`
- `speed_cleanup` - для заявок типа `speedCleanup`
- `event` - для заявок типа `event`

#### Радиус уведомлений

- При создании заявки уведомления отправляются пользователям в радиусе **10 км**
- Радиус рассчитывается по формуле Haversine (расстояние по поверхности Земли)
- Учитываются только пользователи с заполненными координатами (`latitude`, `longitude`)

### Примечания

1. **Асинхронная отправка:** Все push-уведомления отправляются асинхронно и не блокируют ответы API
2. **Проверка на дубликаты:** Уведомления не отправляются самому себе (создатель заявки не получит уведомление о своем донате/присоединении)
3. **Отсутствие токенов:** Если у пользователя нет FCM токена, уведомление просто пропускается
4. **Логирование:** Все операции отправки логируются для отладки
5. **Масштабируемость:** Система поддерживает отправку уведомлений тысячам пользователей одновременно

---

## 📱 Примеры для Flutter

### Класс для работы с API

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class ApiService {
  final String baseUrl = 'https://joypick.world/api';
  final FlutterSecureStorage _storage = FlutterSecureStorage();

  // Получение токена
  Future<String?> getToken() async {
    return await _storage.read(key: 'auth_token');
  }

  // Сохранение токена
  Future<void> saveToken(String token) async {
    await _storage.write(key: 'auth_token', value: token);
  }

  // Удаление токена
  Future<void> deleteToken() async {
    await _storage.delete(key: 'auth_token');
  }

  // Базовый метод для запросов
  Future<Map<String, dynamic>> _request(
    String method,
    String endpoint, {
    Map<String, dynamic>? body,
    bool requiresAuth = false,
  }) async {
    final uri = Uri.parse('$baseUrl$endpoint');
    final headers = {
      'Content-Type': 'application/json',
    };

    if (requiresAuth) {
      final token = await getToken();
      if (token != null) {
        headers['Authorization'] = 'Bearer $token';
      }
    }

    http.Response response;
    switch (method.toUpperCase()) {
      case 'GET':
        response = await http.get(uri, headers: headers);
        break;
      case 'POST':
        response = await http.post(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      case 'PUT':
        response = await http.put(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      case 'DELETE':
        response = await http.delete(uri, headers: headers);
        break;
      default:
        throw Exception('Unsupported method: $method');
    }

    final data = jsonDecode(response.body);
    
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return data;
    } else {
      throw Exception(data['message'] ?? 'Ошибка запроса');
    }
  }

  // Регистрация
  Future<Map<String, dynamic>> register({
    required String email,
    required String password,
    String? display_name,
  }) async {
    final response = await _request('POST', '/auth/register', body: {
      'email': email,
      'password': password,
      'display_name': display_name,
    });
    
    if (response['success'] == true) {
      final token = response['data']['token'];
      await saveToken(token);
    }
    
    return response;
  }

  // Вход
  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    final response = await _request('POST', '/auth/login', body: {
      'email': email,
      'password': password,
    });
    
    if (response['success'] == true) {
      final token = response['data']['token'];
      await saveToken(token);
    }
    
    return response;
  }

  // Получение текущего пользователя
  Future<Map<String, dynamic>> getCurrentUser() async {
    return await _request('GET', '/auth/me', requiresAuth: true);
  }

  // Получение списка заявок
  Future<Map<String, dynamic>> getRequests({
    int page = 1,
    int limit = 20,
    String? category,
    String? city,
    double? latitude,
    double? longitude,
    int? radius,
  }) async {
    final queryParams = <String, String>{
      'page': page.toString(),
      'limit': limit.toString(),
    };
    
    if (category != null) queryParams['category'] = category;
    if (city != null) queryParams['city'] = city;
    if (latitude != null) queryParams['latitude'] = latitude.toString();
    if (longitude != null) queryParams['longitude'] = longitude.toString();
    if (radius != null) queryParams['radius'] = radius.toString();

    final queryString = Uri(queryParameters: queryParams).query;
    return await _request('GET', '/requests?$queryString');
  }

  // Создание заявки
  Future<Map<String, dynamic>> createRequest({
    required String category,
    required String name,
    String? description,
    double? latitude,
    double? longitude,
    String? city,
    List<String>? photos,
    List<String>? waste_types,
  }) async {
    return await _request('POST', '/requests', body: {
      'category': category,
      'name': name,
      'description': description,
      'latitude': latitude,
      'longitude': longitude,
      'city': city,
      'photos': photos ?? [],
      'waste_types': waste_types ?? [],
    }, requiresAuth: true);
  }

  // Присоединение к заявке
  Future<Map<String, dynamic>> joinRequest(String requestId) async {
    return await _request('POST', '/requests/$requestId/join', requiresAuth: true);
  }

  // Участие в событии
  Future<Map<String, dynamic>> participateInEvent(String requestId) async {
    return await _request('POST', '/requests/$requestId/participate', requiresAuth: true);
  }

  // Создание доната
  Future<Map<String, dynamic>> createDonation({
    required String requestId,
    required int amount,
    required String paymentIntentId,
  }) async {
    return await _request('POST', '/donations', body: {
      'requestId': requestId,
      'amount': amount,
      'paymentIntentId': paymentIntentId,
    }, requiresAuth: true);
  }
}
```

---

## ⏰ Cron задачи (только для админов)

Cron задачи выполняются автоматически через `node-cron` при запуске сервера. Администраторы могут проверять статус и запускать задачи вручную через API.

### Проверка статуса cron задач

**GET** `/api/cron/status`

**Требует аутентификации и прав администратора**

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "status": "running",
    "isRunning": true,
    "lastRun": "2025-11-28T14:11:20.278Z",
    "hoursSinceLastRun": 0.5,
    "lastRunInfo": {
      "lastRun": "2025-11-28T14:11:20.278Z",
      "results": {
        "autoCompleteSpeedCleanup": {
          "processed": 0,
          "errors": 0
        }
      },
      "status": "success"
    },
    "fileExists": true,
    "message": "Cron задачи работают нормально"
  }
}
```

**Статусы:**
- `running` - последний запуск был менее 2 часов назад (cron работает нормально)
- `warning` - последний запуск был 2-24 часа назад (возможно, cron не работает)
- `stopped` - последний запуск был более 24 часов назад (cron не работает)
- `never_run` - cron задачи еще не запускались

**Ошибка (403):**
```json
{
  "success": false,
  "message": "Доступ запрещен"
}
```

---

### Ручной запуск cron задач

**POST** `/api/cron/run`

**Требует аутентификации и прав администратора**

Запуск **синхронный**: сервер дожидается `runAllCronTasks()` и возвращает объект **`results`** (см. [Автоматические сроки (SLA) и cron](#автоматические-сроки-sla-и-cron)).

**Ответ (200):**
```json
{
  "success": true,
  "message": "Success",
  "data": {
    "message": "Cron tasks completed",
    "results": {
      "autoCompleteSpeedCleanup": { "processed": 0, "errors": 0, "total": 0 },
      "checkWasteReminders": { "processed": 0, "errors": 0, "total": 0 },
      "checkExpiredWasteJoins": { "processed": 0, "errors": 0, "total": 0 },
      "checkEventTimes": { "processed": 0, "errors": 0, "total": 0 },
      "checkEventAfterStartDate": { "processed": 0, "warnings": 0, "errors": 0, "total": 0 },
      "checkTransferPayoutAvailability": { "processed": 0, "errors": 0, "total": 0 },
      "notifyInactiveWasteRequests": { "processed": 0, "errors": 0, "total": 0 },
      "notifySuperadminsRequestNotClosed": { "processed": 0, "errors": 0, "total": 0 },
      "cleanupUnpaidRequests": { "processed": 0, "errors": 0, "total": 0 },
      "checkExecutorStaleness": { "warned": 0, "archived": 0, "errors": 0 },
      "checkModerationReviewStale": { "warned": 0, "archived": 0, "errors": 0 },
      "deleteInactiveRequests": { "processed": 0, "errors": 0, "total": 0 }
    }
  }
}
```

**Ошибка (500):**
```json
{
  "success": false,
  "message": "Ошибка при запуске cron задач: [детали ошибки]",
  "error": "[сообщение об ошибке]",
  "errorName": "Error",
  "stack": "[stack trace]"
}
```

---

### Получение ближайших действий по заявкам

**GET** `/api/cron/actions`

**Требует аутентификации и прав администратора**

Возвращает 10 последних выполненных действий и 10 ближайших запланированных действий по заявкам.

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "completed": [
      {
        "id": "uuid",
        "action_type": "autoCompleteSpeedCleanup",
        "request_id": "request-uuid",
        "request_category": "speedCleanup",
        "action_description": "speedCleanup [id]: перевод в archived через 7 суток с created_at (выплата новых донатов перед архивом)",
        "status": "completed",
        "executed_at": "2025-12-01T10:30:00.000Z",
        "metadata": {
          "donorCount": 5,
          "coinsAwarded": 1
        }
      },
      {
        "id": "uuid",
        "action_type": "checkWasteReminders",
        "request_id": "request-uuid",
        "request_category": "wasteLocation",
        "action_description": "Ошибка при отправке напоминания для заявки [id]: Connection timeout",
        "status": "error",
        "executed_at": "2025-12-01T10:25:00.000Z",
        "metadata": {
          "error": "Connection timeout",
          "errorName": "Error",
          "errorStack": "Error: Connection timeout\n    at ...",
          "requestId": "request-uuid"
        }
      }
    ],
    "scheduled": [
      {
        "action_type": "autoCompleteSpeedCleanup",
        "request_id": "request-uuid",
        "request_category": "speedCleanup",
        "request_name": "Название заявки",
        "action_description": "speedCleanup \"Название заявки\": архив через 7 суток с created_at при статусе approved",
        "scheduled_at": "2025-12-02T10:30:00.000Z",
        "time_until": 24.0
      },
      {
        "action_type": "checkWasteReminders",
        "request_id": "request-uuid",
        "request_category": "wasteLocation",
        "request_name": "Уборка мусора",
        "action_description": "Напоминание исполнителю заявки \"Уборка мусора\" за 2 часа до окончания срока",
        "scheduled_at": "2025-12-01T20:00:00.000Z",
        "time_until": 2.5
      },
      {
        "action_type": "checkEventTimes",
        "request_id": "request-uuid",
        "request_category": "event",
        "request_name": "Экологическое мероприятие",
        "action_description": "Уведомление участникам события \"Экологическое мероприятие\" за 24 часа до начала",
        "scheduled_at": "2025-12-02T12:00:00.000Z",
        "time_until": 25.5
      }
    ],
    "total_completed": 10,
    "total_scheduled": 10
  }
}
```

**Типы действий:**

1. **autoCompleteSpeedCleanup** — `speedCleanup` в **`approved`**, **≥ 7 суток** с **`created_at`**: выплата новых донатов, затем **`archived`**
2. **checkWasteReminders** - напоминание исполнителю `wasteLocation` заявки за 2 часа до окончания срока
3. **checkExpiredWasteJoins** - проверка истечения срока для `wasteLocation` заявок (24 часа после присоединения)
4. **checkEventTimes** - уведомления для `event` заявок:
   - За 24 часа до начала
   - За 2 часа до начала
   - Начало события
5. **checkEventAfterStartDate**, **checkTransferPayoutAvailability**, **notifyInactiveWasteRequests**, **notifySuperadminsRequestNotClosed**, **cleanupUnpaidRequests** — вспомогательные задачи из `runAllCronTasks()` (см. `scripts/cronTasks.js`)
6. **checkExecutorStaleness** / **executorStaleWarnCreator**, **executorStaleArchive** — SLA исполнителя **7+1** (см. [SLA и cron](#автоматические-сроки-sla-и-cron))
6. **finalizePendingModerationProposals** — финализация предложенной автомодерации после grace period  
7. **checkModerationReviewStale** / **moderationStaleWarnAdmins**, **moderationTimeoutArchive** — SLA модерации **`pending`** **7+1** (не пересекается с активным `moderation_finalize_at` в будущем)
8. **deleteInactiveRequests** — waste **`new`** после **`expires_at` + 1 день** → **`archived`**; **speed** **`new`/`inProgress`**, **8 суток** с **`created_at`** → автоотклонение. **Event** здесь **не** обрабатывается (только **checkEventAfterStartDate** от **`start_date`**).

**Поля выполненных действий:**
- `id` - ID действия
- `action_type` - тип действия
- `request_id` - ID заявки (может быть null для общих действий)
- `request_category` - категория заявки
- `action_description` - описание действия
- `status` - статус выполнения: `"completed"` или `"error"`
- `executed_at` - время выполнения (ISO 8601)
- `metadata` - дополнительные данные (JSON):
  - Для успешных действий: `{ donorCount, coinsAwarded, processed, errors, total, ... }`
  - Для ошибок: `{ error, errorName, errorStack, requestId }` - **подробная информация об ошибке**

**Поля запланированных действий:**
- `action_type` - тип действия
- `request_id` - ID заявки
- `request_category` - категория заявки
- `request_name` - название заявки
- `action_description` - описание действия
- `scheduled_at` - запланированное время выполнения (ISO 8601)
- `time_until` - время до выполнения (в часах или днях, с одним знаком после запятой)

**Важно:** Если действие завершилось с ошибкой (`status: "error"`), в поле `metadata` содержится подробная информация об ошибке:
- `error` - сообщение об ошибке
- `errorName` - тип ошибки (Error, TypeError, etc.)
- `errorStack` - полный stack trace ошибки
- `requestId` - ID заявки, при обработке которой произошла ошибка

**Ошибка (500):**
```json
{
  "success": false,
  "message": "Ошибка при получении действий cron",
  "error": "[сообщение об ошибке]",
  "errorName": "Error",
  "stack": "[stack trace]"
}
```

---

### Текущие cron задачи

Порядок вызовов в **`runAllCronTasks()`** (`scripts/cronTasks.js`):  
**autoCompleteSpeedCleanup** → **checkWasteReminders** → **checkExpiredWasteJoins** → **checkEventTimes** → **checkEventAfterStartDate** → **checkTransferPayoutAvailability** → **notifyInactiveWasteRequests** → **notifySuperadminsRequestNotClosed** → **cleanupUnpaidRequests** → **checkExecutorStaleness** → **checkModerationReviewStale** → **deleteInactiveRequests**.

Подробные сроки (**7+1** исполнитель и модерация, waste `expires_at`, автоотклонение speed/event) — в разделе [Автоматические сроки (SLA) и cron](#автоматические-сроки-sla-и-cron). Итог ручного запуска — в **`POST /api/cron/run`** (`data.results`).

**Расписание:** Настраивается через переменную окружения `CRON_SCHEDULE` в `.env`:
```env
CRON_SCHEDULE=0 * * * *  # Каждый час (рекомендуется для продакшена)
```

**История действий:** Все выполненные действия сохраняются в таблице `cron_actions` и доступны через `GET /api/cron/actions`.

---

## Коды ошибок

- `200` - Успешно
- `201` - Создано
- `400` - Ошибка валидации
- `401` - Не авторизован
- `403` - Доступ запрещен
- `404` - Не найдено
- `409` - Конфликт (например, уже существует)
- `500` - Ошибка сервера

---

## Формат ошибок

Все ошибки возвращаются в формате JSON с детальной информацией для локализации проблемы.

### Ошибка валидации (400)

```json
{
  "success": false,
  "message": "Ошибка валидации",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "errors": [
    {
      "msg": "Некорректный email",
      "param": "email",
      "location": "body"
    },
    {
      "msg": "Пароль должен быть не менее 6 символов",
      "param": "password",
      "location": "body"
    }
  ]
}
```

### Ошибка базы данных (400/500)

```json
{
  "success": false,
  "message": "Ошибка базы данных: Duplicate entry 'user@example.com' for key 'email'",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "errorDetails": {
    "code": "ER_DUP_ENTRY",
    "sqlMessage": "Duplicate entry 'user@example.com' for key 'email'",
    "sql": "INSERT INTO users ...",
    "message": "Запись с такими данными уже существует"
  }
}
```

### Общая ошибка сервера (500)

**В режиме разработки (NODE_ENV !== 'production'):**
```json
{
  "success": false,
  "message": "Внутренняя ошибка сервера: Cannot read property 'id' of undefined",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "error": "Cannot read property 'id' of undefined",
  "name": "TypeError",
  "errorDetails": {
    "code": undefined,
    "name": "TypeError",
    "sql": null,
    "sqlMessage": null,
    "message": "Cannot read property 'id' of undefined"
  },
  "stack": "TypeError: Cannot read property 'id' of undefined\n    at ..."
}
```

**В продакшене:**
```json
{
  "success": false,
  "message": "Внутренняя ошибка сервера",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "error": "Cannot read property 'id' of undefined",
  "name": "TypeError",
  "errorDetails": {
    "message": "Детали ошибки доступны только в режиме разработки"
  }
}
```

### Ошибка авторизации (401)

```json
{
  "success": false,
  "message": "Неверный email или пароль",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Ошибка JWT токена (401)

```json
{
  "success": false,
  "message": "Недействительный токен",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

или

```json
{
  "success": false,
  "message": "Токен истёк",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Ошибка 404 (Маршрут не найден)

```json
{
  "success": false,
  "message": "Маршрут POST /api/auth/invalid не найден",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Структура полей ошибки

| Поле | Тип | Описание |
|------|-----|----------|
| `success` | boolean | Всегда `false` для ошибок |
| `message` | string | Понятное сообщение об ошибке на русском языке |
| `timestamp` | string | ISO 8601 формат времени ошибки |
| `errors` | array | Массив ошибок валидации (только для 400) |
| `errorDetails` | object | Детальная информация об ошибке (код, SQL и т.д.) |
| `error` | string | Текст ошибки (для разработки) |
| `name` | string | Тип ошибки (TypeError, Error и т.д.) |
| `stack` | string | Stack trace (только в режиме разработки) |

### Коды ошибок базы данных

| Код | Описание | HTTP код |
|-----|----------|----------|
| `ER_DUP_ENTRY` | Дублирующаяся запись (уникальное поле) | 409 |
| `ER_NO_REFERENCED_ROW_2` | Ссылка на несуществующую запись (FOREIGN KEY) | 400 |
| `ER_ROW_IS_REFERENCED_2` | Невозможно удалить, есть ссылки | 400 |
| `ER_BAD_FIELD_ERROR` | Неизвестное поле в таблице | 400 |
| `ER_NO_SUCH_TABLE` | Таблица не существует | 500 |
| `ER_PARSE_ERROR` | Ошибка синтаксиса SQL | 500 |

### Примеры обработки ошибок на Flutter

```dart
try {
  final response = await dio.post(
    '$baseUrl/auth/register',
    data: {'email': email, 'password': password},
  );
  
  if (response.data['success'] == true) {
    // Успех
    return response.data['data'];
  } else {
    // Ошибка
    throw Exception(response.data['message']);
  }
} on DioException catch (e) {
  if (e.response != null) {
    final errorData = e.response!.data;
    
    // Ошибка валидации
    if (e.response!.statusCode == 400 && errorData['errors'] != null) {
      final errors = errorData['errors'] as List;
      final errorMessages = errors.map((e) => e['msg']).join(', ');
      throw Exception('Ошибка валидации: $errorMessages');
    }
    
    // Ошибка базы данных
    if (errorData['errorDetails'] != null) {
      final details = errorData['errorDetails'];
      final code = details['code'];
      final sqlMessage = details['sqlMessage'];
      
      if (code == 'ER_DUP_ENTRY') {
        throw Exception('Пользователь с таким email уже существует');
      }
      
      // Логируем детали для отладки
      print('❌ DB Error: $code - $sqlMessage');
      throw Exception(errorData['message'] ?? 'Ошибка базы данных');
    }
    
    // Общая ошибка
    throw Exception(errorData['message'] ?? 'Произошла ошибка');
  } else {
    throw Exception('Ошибка сети: ${e.message}');
  }
}
```

### Логирование ошибок на сервере

Все ошибки логируются на сервере с полной информацией:

```
❌ Ошибка регистрации: ER_BAD_FIELD_ERROR: Unknown column 'email_verified' in 'field list'
❌ Stack trace: Error: ER_BAD_FIELD_ERROR: Unknown column 'email_verified' in 'field list'
    at PoolConnection.query ...
```

Это помогает быстро локализовать проблему при разработке.

---

## 🏥 Проверка здоровья сервера

### Статус сервера

**GET** `/health`

**Ответ (200):**
```json
{
  "success": true,
  "message": "Сервер работает",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Статус базы данных

**GET** `/api/health/db`

**Ответ (200):**
```json
{
  "success": true,
  "database": "connected",
  "databaseVersion": "8.0.0"
}
```

**Ошибка (500):**
```json
{
  "success": false,
  "database": "disconnected",
  "error": "Error message"
}
```

---

## Настройка Email

Для работы верификации email необходимо настроить отправку email. Поддерживаются следующие способы:

### Логотип в письме

Чтобы в письме отображался логотип приложения:
1. **Положите файл логотипа** в папку `uploads` проекта и назовите его, например, `email-logo.png` (или другой формат: jpg, webp).
2. Убедитесь, что в `.env` задан **APP_URL** (полный URL сайта, например `https://joypick.world`). Тогда логотип будет доступен по адресу `APP_URL/uploads/email-logo.png`.
3. Либо задайте в `.env` переменную **EMAIL_LOGO_URL** с полным URL картинки (например `https://joypick.world/uploads/email-logo.png`).

В шаблоне письма с фронта используйте плейсхолдер `{{logo_url}}` — он подставит этот URL.

### Способ 1: SMTP (Gmail, Outlook, Yandex и т.д.)

Добавьте в `.env`:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=your-email@gmail.com
APP_NAME=Joy Pick
```

**Для Gmail:**
- Используйте "Пароль приложения" вместо обычного пароля
- Включите двухфакторную аутентификацию
- Создайте пароль приложения: https://myaccount.google.com/apppasswords

### Способ 2: Gmail OAuth2

```env
GMAIL_USER=your-email@gmail.com
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token
EMAIL_FROM=your-email@gmail.com
APP_NAME=Joy Pick
```

### Способ 3: SendGrid

```env
SENDGRID_API_KEY=your-sendgrid-api-key
EMAIL_FROM=noreply@yourdomain.com
APP_NAME=Joy Pick
```

### Способ 4: Mailgun

```env
MAILGUN_SMTP_USER=your-mailgun-smtp-user
MAILGUN_SMTP_PASS=your-mailgun-smtp-password
EMAIL_FROM=noreply@yourdomain.com
APP_NAME=Joy Pick
```

**Примечание:** Если email не настроен, регистрация будет работать, но код верификации не будет отправляться. Пользователь все равно сможет зарегистрироваться, но `email_verified` останется `false`.

---

---

## 💬 Real-time API (Server-Sent Events)

### Подключение

**Важно:** Используйте тот же домен, что и для HTTP API, БЕЗ указания порта!

- **Production URL:** `https://joypick.world`
- **Development URL:** `http://localhost:3000` (только для локальной разработки)

**Как работает:**
- Клиент открывает долгий HTTP GET запрос к `/api/chats/:chatId/events`
- Сервер отправляет события через SSE поток (односторонне: сервер → клиент)
- Для отправки сообщений используется обычный POST запрос к `/api/chats/:chatId/messages`

### Аутентификация

JWT токен передается в заголовке `Authorization: Bearer <token>` (как для обычных HTTP запросов).

### Endpoint для SSE потока

**GET** `/api/chats/:chatId/events`

Открывает Server-Sent Events (SSE) поток для получения новых сообщений в реальном времени.

**Заголовки:**
```
Authorization: Bearer <jwt_token>
```

**Ответ (200):**
SSE поток с событиями в формате:
```
data: {"type":"connected","message":"Подключено к чату","chatId":"uuid","timestamp":"2024-01-01T00:00:00.000Z"}

data: {"type":"new_message","id":"uuid","chat_id":"uuid","sender_id":"uuid","message":"Текст","message_type":"text","created_at":"2024-01-01T00:00:00.000Z"}

data: {"type":"message_read","messageId":"uuid","userId":"uuid","readAt":"2024-01-01T00:00:00.000Z"}

data: {"type":"ping","timestamp":"2024-01-01T00:00:00.000Z"}
```

**Пример для JavaScript/TypeScript:**
```javascript
const eventSource = new EventSource('https://joypick.world/api/chats/chat-uuid/events', {
  headers: {
    'Authorization': 'Bearer your_jwt_token'
  }
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'new_message') {
    console.log('Новое сообщение:', data.message);
  } else if (data.type === 'message_read') {
    console.log('Сообщение прочитано:', data.messageId);
  } else if (data.type === 'connected') {
    console.log('Подключено к чату');
  } else if (data.type === 'ping') {
    // Ping для поддержания соединения
  }
};

eventSource.onerror = (error) => {
  console.error('Ошибка SSE:', error);
  // Автоматически переподключается
};
```

**Пример для Flutter/Dart:**
```dart
import 'package:eventsource/eventsource.dart';

// Подключение к SSE потоку
final eventSource = EventSource.connect(
  'https://joypick.world/api/chats/$chatId/events',
  headers: {
    'Authorization': 'Bearer $jwtToken',
  },
);

// Обработка событий
eventSource.listen((event) {
  final data = jsonDecode(event.data);
  
  if (data['type'] == 'new_message') {
    print('Новое сообщение: ${data['message']}');
    // Обновить UI с новым сообщением
  } else if (data['type'] == 'message_read') {
    print('Сообщение прочитано: ${data['messageId']}');
    // Обновить статус прочтения
  } else if (data['type'] == 'connected') {
    print('Подключено к чату');
  }
});

// Обработка ошибок
eventSource.onError = (error) {
  print('Ошибка SSE: $error');
  // Автоматически переподключается
};
```

**Отправка сообщения (через обычный POST):**
```dart
// POST /api/chats/:chatId/messages
final response = await http.post(
  Uri.parse('https://joypick.world/api/chats/$chatId/messages'),
  headers: {
    'Authorization': 'Bearer $jwtToken',
    'Content-Type': 'application/json',
  },
  body: jsonEncode({
    'message': 'Текст сообщения',
    'message_type': 'text',
  }),
);
```

### Типы событий SSE

#### `connected` - Подключение установлено
```json
{
  "type": "connected",
  "message": "Подключено к чату",
  "chatId": "uuid",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### `new_message` - Новое сообщение
```json
{
  "type": "new_message",
  "success": true,
  "id": "uuid",
  "chat_id": "uuid",
  "sender_id": "uuid",
  "message": "Текст сообщения",
  "message_type": "text",
  "created_at": "2024-01-01T00:00:00.000Z",
  "read_by": ["uuid"],
  "unread_by": ["uuid", "uuid"]
}
```
**Примечание:** Включает массивы `read_by` и `unread_by` для отслеживания прочтения.

#### `message_read` - Сообщение прочитано
```json
{
  "type": "message_read",
  "success": true,
  "messageId": "uuid",
  "userId": "uuid",
  "readAt": "2024-01-01T00:00:00.000Z"
}
```

#### `all_messages_read` - Все сообщения отмечены как прочитанные
```json
{
  "type": "all_messages_read",
  "success": true,
  "userId": "uuid",
  "chatId": "uuid",
  "messagesCount": 5,
  "readAt": "2024-01-01T00:00:00.000Z"
}
```
Отправляется при вызове `POST /chats/:chatId/read` (при открытии чата).

#### `ping` - Поддержание соединения
```json
{
  "type": "ping",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```
Отправляется каждые 30 секунд для поддержания соединения.

### Отправка сообщений

**POST** `/api/chats/:chatId/messages`

Отправка сообщения через обычный HTTP POST запрос. После сохранения сообщение автоматически отправляется всем подключенным клиентам через SSE.

**Тело запроса:**
```json
{
  "message": "Текст сообщения",
  "message_type": "text"
}
```

**Ответ (201):**
```json
{
  "success": true,
  "message": "Сообщение отправлено",
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

### Отметка о прочтении

**POST** `/api/chats/:chatId/messages/:messageId/read`

Отметить сообщение как прочитанное. После сохранения событие автоматически отправляется всем подключенным клиентам через SSE.

**Ответ (200):**
```json
{
  "success": true,
  "message": "Сообщение отмечено как прочитанное",
  "data": {
    "messageId": "uuid",
    "userId": "uuid",
    "readAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Преимущества SSE

- ✅ Работает на любом хостинге (включая Beget)
- ✅ Проще, чем Socket.io
- ✅ Меньше запросов, чем long polling
- ✅ Поддерживается современными браузерами
- ✅ Не требует WebSocket

### Обработка ошибок

При ошибке подключения к SSE потоку возвращается обычный HTTP ответ с ошибкой:
```json
{
  "success": false,
  "message": "Чат не найден или нет доступа",
  "error": "Чат не найден или нет доступа"
}
```

**Важно:** Все ошибки возвращаются в JSON формате. Нет логирования в файлы - все ошибки видны клиенту.

---

## 📤 Загрузка файла (Upload)

Общий эндпоинт для загрузки одного изображения (админка: картинки для новостей, партнёров и т.д.).

**POST** `/upload`

**Авторизация:** обязательна, только администратор (Bearer token).

**Content-Type:** `multipart/form-data`. Поле с файлом: **`file`** или **`image`** (один файл). Форматы: JPEG, PNG, GIF, WebP. Максимум 10 MB.

**Ответ (201):**
```json
{
  "success": true,
  "message": "Файл загружен",
  "data": {
    "url": "https://joypick.world/uploads/photos/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.jpg"
  }
}
```

Полученный `data.url` (полный URL) подставляйте в поле `image_url` при создании/редактировании новости или в другие сущности. Для статей в приложении передаётся только полный путь.

**Ошибки:** 400 — файл не передан или неверное поле; 401/403 — не авторизован или не админ; 500 — ошибка при сохранении.

---

## 🖼️ Галерея изображений для создания заявок (Admin)

Серверная галерея изображений, из которой админка может выбирать картинку при создании заявки.

**Базовый путь:** `/api/request-gallery`

**Авторизация:** обязательна, только администратор (Bearer token).

### POST `/request-gallery/upload`

Загружает изображение в галерею.

**Content-Type:** `multipart/form-data`  
**Поле файла:** `file` или `image` (один файл)  
**Форматы:** JPEG, PNG, GIF, WebP  
**Максимум:** 10 MB

**Ответ (201):**
```json
{
  "success": true,
  "message": "Image uploaded to request gallery",
  "data": {
    "id": 123,
    "image_url": "https://joypick.world/uploads/photos/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.jpg",
    "uploaded_by": "uuid-admin",
    "created_at": "2026-03-24T12:34:56.000Z"
  }
}
```

### GET `/request-gallery`

Возвращает список изображений галереи (новые сверху) для выбора на фронте.

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `page` | Номер страницы, с **1** (по умолчанию **1**) |
| `limit` | Размер страницы **1..100** (по умолчанию **50**) |

**Ответ (200):**
```json
{
  "success": true,
  "message": "Success",
  "data": {
    "items": [
      {
        "id": 123,
        "image_url": "https://joypick.world/uploads/photos/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.jpg",
        "uploaded_by": "uuid-admin",
        "created_at": "2026-03-24T12:34:56.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

**Ошибки:** 400 — файл не передан/неверный тип; 401/403 — нет прав админа; 500 — ошибка сохранения/чтения.

---

## 📰 Новости (News)

API для мультиязычной ленты новостей. Контент при создании/редактировании задаётся одним полем `content` и языком оригинала `source_lang`; сервер переводит на все поддерживаемые локали и сохраняет в БД. При выдаче можно передать параметр `locale` — в ответе возвращаются переведённые `title`, `short_description`, `text` для этой локали; если `locale` не передан или неверный, используется `en`.

**Пути:**
- **`/api/news`** — для приложения: GET (обязательный `locale`), лайки; для админа также POST, PUT, DELETE.
- **`/api/news-admin`** — только для админки (обязательны права администратора): список/одна новость (опционально `locale`), создание/редактирование с отчётом перевода.

**Поддерживаемые локали:** `en`, `ru`, `es`, `ar`, `zh`, `hi`, `fr`, `pt`, `he`, `de`.

### Типы статей

- **`simple`** — обычная статья: массив фото `image_urls` (полные URL).
- **`from_request`** — статья из заявки: в ответе приложению передаются поля **`theme`** (тема) и **`text`** (текст), а также **`request_id`** (ID заявки). Данные заявки берутся из репо заявок в приложении. Поле картинки не отдаётся. Заголовок и подзаголовок не используются — только тема и текст.

**Важно:** При выдаче списка или одной статьи сервер проверяет заявки, привязанные к статьям типа `from_request`. Если заявка перешла в статус **archived**, статья удаляется из БД и в ответ не попадает (или возвращается 404 для одной статьи).

### Модель News (в ответах API для приложения)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string (UUID) | ID новости |
| `type` | string | Тип: `simple` \| `from_request` |
| `title` | string | Только для `type: "simple"`. Заголовок (для выбранной локали). |
| `short_description` | string | Только для `type: "simple"`. Краткое описание (для выбранной локали). |
| `text` | string | Текст новости (для выбранной локали). |
| `theme` | string | Только для `type: "from_request"`. Тема статьи (для выбранной локали). Для simple не отдаётся. |
| `image_urls` | array[string] | Только для `type: "simple"`. Массив полных URL фото. Для `from_request` поле отсутствует. |
| `request_id` | string \| null | Только для `type: "from_request"`. ID заявки; данные заявки брать из репо заявок в приложении. |
| `published_at` | datetime | Дата публикации (UTC, ISO 8601) |
| `view_count` | number | Количество просмотров |
| `likes_count` | number | Количество лайков (из таблицы `news_likes`) |
| `is_liked` | boolean | Лайкнул ли текущий пользователь (только при запросе с токеном) |
| `created_at` | datetime | Дата создания |
| `updated_at` | datetime \| null | Дата обновления |

В БД хранятся `type`, `source_lang`, `title_i18n`, `short_description_i18n`, `text_i18n`, `image_urls` (JSON), `request_id`. См. `database/news_table_structure.md`.

**Механизм лайков:** таблица `news_likes` (пары `news_id`, `user_id`). Поставить/убрать лайк — **POST** `/news/:id/like` (toggle). В ответах списка и одной новости при переданном токене возвращается `is_liked`.

---

### Для приложения

#### Список новостей

**GET** `/news?locale=<locale>&page=1&limit=20`

**Query-параметры:**
| Параметр | Обязательный | Описание |
|----------|--------------|----------|
| `locale` | Нет | Один из: `en`, `ru`, `es`, `ar`, `zh`, `hi`, `fr`, `pt`, `he`, `de`. Если не передан или неверный — используется `en` (обратная совместимость со старыми клиентами). |
| `page` | Нет | Страница (по умолчанию 1). |
| `limit` | Нет | Записей на странице (по умолчанию 20, макс. 100). |

**Авторизация:** Не обязательна. При заголовке `Authorization: Bearer <token>` в каждой новости будет поле `is_liked`.

В ответе у каждой новости поля `title`, `short_description`, `text` приведены к выбранной локали (fallback на `en`, если перевода нет).

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "news": [
      {
        "id": "uuid",
        "type": "simple",
        "title": "Заголовок",
        "short_description": "Краткое описание",
        "text": "Текст новости",
        "image_urls": ["https://...", "https://..."],
        "published_at": "2025-02-20T12:00:00.000Z",
        "view_count": 100,
        "likes_count": 15,
        "is_liked": false,
        "created_at": "2025-02-20T10:00:00.000Z"
      },
      {
        "id": "uuid2",
        "type": "from_request",
        "theme": "Тема статьи",
        "text": "Текст статьи...",
        "request_id": "uuid-заявки",
        "published_at": "2025-02-20T12:00:00.000Z",
        "view_count": 50,
        "likes_count": 5,
        "is_liked": false,
        "created_at": "2025-02-20T10:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 50, "totalPages": 3 }
  }
}
```
Статьи типа `from_request`, у которых заявка в архиве, при запросе удаляются из БД и в список не попадают.

---

#### Просмотр одной новости (увеличивает счётчик просмотров)

**GET** `/news/:id?locale=<locale>`

**Query:** `locale` — опционален; при отсутствии или неверном значении используется `en`.

При каждом запросе (кроме админа с `skip_view=1`) счётчик `view_count` увеличивается на 1.

**Ответ (200):** объект `news` с полями `title`, `short_description`, `text` для выбранной локали, плюс `view_count`, `likes_count`, `is_liked` (при токене).

---

#### Поставить или убрать лайк (toggle)

**POST** `/news/:id/like`

**Авторизация:** Требуется (Bearer token).

**Ответ (200):** `{ "success": true, "message": "Лайк поставлен" | "Лайк убран", "data": { "liked": true|false, "likes_count": N } }`.

---

#### Статус лайка

**GET** `/news/:id/like-status`

**Авторизация:** Требуется (Bearer token).

**Ответ (200):** `{ "success": true, "data": { "liked": true|false, "likes_count": N } }`.

---

### Создание и редактирование новостей (админ)

Доступно по **`/api/news`** и по **`/api/news-admin`** (предпочтительно для админ-панели). Тело запроса — одно поле контента и язык оригинала; сервер переводит на все локали и при создании/обновлении контента возвращает **`translation_report`**.

**Формат контента:** одна строка с разделителем **`[|||]`** (три вертикальных черты):
```
title[|||]short_description[|||]text
```
- Все три части обязательны; пустые значения допускаются (например `Заголовок[|||][|||]Только текст`).
- При ошибке парсинга API вернёт 400 с сообщением о неверном формате.

#### Создание новости

**POST** `/news` или **POST** `/news-admin`

**Request Body (простая статья):**
```json
{
  "type": "simple",
  "content": "Заголовок новости[|||]Краткое описание.[|||]Полный текст новости.",
  "source_lang": "ru",
  "image_urls": ["https://example.com/1.jpg", "https://example.com/2.jpg"],
  "published_at": "2025-02-20T12:00:00.000Z"
}
```

**Request Body (статья из заявки):** для `from_request` контент — два поля: **тема** и **текст** (разделитель `[|||]`).
```json
{
  "type": "from_request",
  "content": "Тема статьи[|||]Текст статьи.",
  "source_lang": "ru",
  "request_id": "uuid-заявки",
  "published_at": "2025-02-20T12:00:00.000Z"
}
```

| Поле | Обязательное | Описание |
|------|---------------|----------|
| `type` | Нет | Тип статьи: `simple` (по умолчанию) или `from_request`. |
| `content` | Да | Для **simple**: `title[|||]short_description[|||]text`. Для **from_request**: `theme[|||]text` (тема и текст, два поля). |
| `source_lang` | Да | Язык оригинала: один из поддерживаемых локалей. |
| `image_urls` | Для `simple` | Массив полных URL фото (как возвращает POST /api/upload). Для `from_request` не передаётся. |
| `request_id` | Для `from_request` | ID заявки (UUID). Обязателен при `type: "from_request"`. Заявка должна существовать. |
| `published_at` | Да | Дата публикации (ISO 8601). |

**Ответ (201):**
```json
{
  "success": true,
  "message": "Новость создана",
  "data": {
    "news": { "id": "uuid", "type": "simple", "title": "...", "short_description": "...", "text": "...", "image_urls": [], "published_at": "...", "view_count": 0, "created_at": "...", "updated_at": "..." },
    "translation_report": {
      "success": true,
      "source_lang": "ru",
      "locales": { "en": { "status": "ok" }, "ru": { "status": "ok" }, "es": { "status": "ok" }, ... },
      "errors": [],
      "warnings": []
    }
  }
}
```

При ошибках перевода в `translation_report` будут заполнены `errors`, `warnings` и статусы по локалям; контент всё равно сохраняется (fallback на английский где нужно).

---

#### Редактирование новости

**PUT** `/news/:id` или **PUT** `/news-admin/:id`

**Request Body (все поля опциональны, частичное обновление):**
```json
{
  "type": "simple",
  "content": "Новый заголовок[|||]Новое краткое описание[|||]Новый текст",
  "source_lang": "en",
  "image_urls": ["https://..."],
  "request_id": null,
  "published_at": "2025-02-21T14:00:00.000Z"
}
```

- Если переданы `content` и `source_lang` — контент парсится, переводится на все локали; в ответ добавляется **`translation_report`**.
- `type`: при смене на `from_request` обязателен `request_id`; при `simple` — можно передать `image_urls` (массив URL).
- `published_at` можно менять отдельно.

**Ответ (200):** `data.news` — обновлённая новость; при обновлении контента также `data.translation_report`.

---

#### Удаление новости

**DELETE** `/news/:id` или **DELETE** `/news-admin/:id`

Удаляет новость и связанные лайки. Ответ: `{ "success": true, "message": "Новость удалена" }`.

---

### Админка: эндпоинты `/api/news-admin`

Все запросы требуют **`Authorization: Bearer <admin_token>`**.

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/news-admin?page=1&limit=20&locale=` | Список новостей. Если передан валидный `locale` — в каждой новости плоские `title`, `short_description`, `text` для этой локали; без `locale` — полные объекты `title_i18n`, `short_description_i18n`, `text_i18n` (для редактора). |
| GET | `/news-admin/:id?locale=` | Одна новость. Аналогично: с `locale` — плоские поля для локали; без — полные i18n. Счётчик просмотров не увеличивается. |
| POST | `/news-admin` | Создание: `type` (simple \| from_request), `content`, `source_lang`, для simple — `image_urls` (массив), для from_request — `request_id`, `published_at`. Ответ: `news` + `translation_report`. |
| PUT | `/news-admin/:id` | Редактирование: опционально `type`, `content`+`source_lang`, `image_urls` (simple), `request_id` (from_request), `published_at`. При обновлении контента — `translation_report`. |
| DELETE | `/news-admin/:id` | Удаление новости. |

---

## 🌍 Earth Day cleanups (импорт с карты, суперадмин)

Синхронизация заявок **The Great Global Cleanup** из ArcGIS в таблицу `earthday_cleanups`. Доступ **только суперадмину** (`isSuperAdmin: true` в JWT), не путать с обычным админом.

**Базовый путь:** `/api/earthday-cleanups-admin`

**Заголовок:** `Authorization: Bearer <jwt_token>`

### Таблица и поле «уже использовано для нашей заявки»

В БД у каждой строки есть флаг **`used_for_internal_request`** (`0` / `1`):

- **`0`** — запись ещё не использовали для создания заявки Joy Pick (можно предлагать в админке).
- **`1`** — из этой записи уже создавали нашу заявку; **повторно использовать нельзя**.

При **повторном синке** из ArcGIS поля заявки обновляются, но **`used_for_internal_request` не сбрасывается** (остаётся прежнее значение).

Чтобы зафиксировать, что запись **взяли для создания нашей заявки**, обновите флаг: **`PATCH /api/earthday-cleanups-admin/:objectid`** (см. ниже).

Созданная из импорта заявка в **`requests`** должна иметь **`from_external_source`: `true`** при **`POST /api/requests`** (только суперадмин; описание поля — в модели **Request** выше).

Структура таблицы: [database/earthday_cleanups_table_structure.md](database/earthday_cleanups_table_structure.md).

### GET `/earthday-cleanups-admin`

Список записей из таблицы с **пагинацией** и диапазоном по **`cleanup_date`** (в БД — **epoch ms**, как в ArcGIS).
Если фронт **не передал** `cleanup_date_from` / `cleanup_date_to`, бэкенд применяет дефолтное окно:
- `cleanup_date_from = now + 24h`
- `cleanup_date_to = now + 7d`
То есть по умолчанию админка получает **ближайшую неделю вперёд**.

**Query-параметры:**

| Параметр | Описание |
|----------|-----------|
| `page` | Номер страницы, с **1** (по умолчанию **1**) |
| `limit` | Размер страницы (**1…100**, по умолчанию **20**) |
| `cleanup_date_from` | Нижняя граница **включительно**. Если не передан, по умолчанию `now+24h`. Форматы: **ISO 8601** (`2025-04-01T00:00:00.000Z`); только дата **`YYYY-MM-DD`** → начало этого дня **UTC**; строка из **цифр** → трактуется как **миллисекунды** с эпохи |
| `cleanup_date_to` | Верхняя граница **включительно**. Если не передан, по умолчанию `now+7d`. Те же форматы; для **`YYYY-MM-DD`** подставляется **конец этого дня UTC** (`23:59:59.999`) |
| `exclude_used` | Опционально. Если **`true`**, **`1`** или **`yes`** (регистр не важен) — в выборку попадают **только** записи с **`used_for_internal_request = 0`** (ещё не использованы для внутренней заявки Joy Pick). Условие **И** с фильтрами по дате. **Без параметра** — как раньше: все строки в диапазоне дат (полный список для обратной совместимости). |
| `continent` | Опционально. **Точное совпадение** с колонкой **`continent`** в БД (англ. строка, как после синка: `Asia`, `Europe`, …). Пустое значение — без фильтра. Строки с **`continent IS NULL`** при указанном фильтре **не попадают** в выборку. |
| `country` | Опционально. **Точное совпадение** с колонкой **`country`** (`United States`, `Japan`, …). Пустое — без фильтра. Записи с **`country IS NULL`** при **`country=…`** не попадают; чтобы получить только «без страны», отдельного параметра нет (можно доработать по запросу). |
| `sort_by` | Опционально. **`cleanup_date`** (по умолчанию) — ведущая сортировка по дате события; **`continent`** — по полю **`continent`** (англ.); **`country`** — по **`country`**. За один запрос задаётся **одна** из этих осей; даты по-прежнему задаются **`cleanup_date_from` / `cleanup_date_to`**. |
| `sort_dir` | Опционально. **`asc`** (по умолчанию) или **`desc`**. Для **`sort_by=continent`** или **`country`**: строки с **NULL** в этом поле идут **в конце**, внутри группы с известным значением — порядок по имени; затем всегда **`cleanup_date` ASC**, **`objectid` ASC** для стабильности. Для **`sort_by=cleanup_date`** — только **`cleanup_date`** и **`objectid`** в указанном направлении по дате. |
| `search` | Опционально. Подстрока **без учёта регистра**: совпадение **хотя бы** по **`GeoCodedAddress`**, **`name_of_cleanup_location`**, **`country`**, **`email_address_`**, **`name_of_the_cleanup_event`**, **`who_is_holding_the_cleanup`**, **`cleanup_event_location`**, **`first_name_`**, **`last_name_`**, строковому представлению **`objectid`**. Условие **AND** с **`cleanup_date_*`**, **`continent`**, **`country`**, **`exclude_used`** и прочими ограничениями списка. Пусто / не передан — без изменений. Максимум **50** символов; иначе **400**. **`pagination.total`** / **`totalPages`** считаются после фильтра. |

Сортировка по умолчанию (без **`sort_by`**): **`cleanup_date` ASC**, **`objectid` ASC**.

Строки с координатами-заглушкой **`lat = 0` и `lng = 0`** (и эквивалент **NULL** для обоих) **в списке не возвращаются** — `total` / `totalPages` считаются без них.

В каждом элементе **`items`** дополнительно приходят **`continent`**, **`country`**, **`location_hint`** (английские названия континента и страны; страна может быть **`null`**). Значения задаются при **синхронизации** из `lat` / `lng` (нормализация долготы в **(-180, 180]**, правила как в админ-клиенте; без обратного геокодинга). **`location_hint`** — строка для подписи в UI: континент, при наличии страны — **` · approx: `** + страна, при непустом **`GeoCodedAddress`** из источника — **` · `** + этот адрес.

**Пример (экран парсинга / только неиспользованные):**
`GET /api/earthday-cleanups-admin?page=1&limit=20&cleanup_date_from=2025-04-01&cleanup_date_to=2025-04-30&exclude_used=true`

**С текстовым поиском (AND с датами и `exclude_used`):**
`GET /api/earthday-cleanups-admin?search=Louisiana&exclude_used=true&page=1&limit=20`

**Ответ `data`:** `items`, `pagination`: `{ page, limit, total, totalPages }`, `filters`: `cleanup_date_from` / `cleanup_date_to` в **ms** или `null`, **`exclude_used`**: boolean, **`continent`** / **`country`**: применённое значение фильтра или **`null`** (фильтр не задан), **`sort_by`**: строка (`cleanup_date` \| `continent` \| `country`), **`sort_dir`**: `asc` \| `desc`, **`search`**: переданная подстрока или **`null`**. При **`exclude_used=true`** поля **`pagination.total`** и **`pagination.totalPages`** считаются **только по отфильтрованным** строкам (неиспользованным), поэтому **`items.length`** на странице согласован с **`limit`** (кроме последней страницы), и пагинация в админке корректна без догрузки «лишних» записей на клиент.

### POST `/earthday-cleanups-admin/sync`

По нажатию в админке: удаляет строки с **`cleanup_date` раньше чем `now + 24 часа`**; подтягивает из ArcGIS до **1000** заявок в окне дат **`now+24ч` … `now+60 суток`** (≈2 месяца, по умолчанию); вставляет/обновляет по **`objectid`**. Глубина окна синка настраивается env-переменной **`EARTHDAY_SYNC_DAYS_AHEAD`** (допустимый диапазон: `7..120`, по умолчанию `60`). Записи **без `start_time`**, без точки в `geometry`, с координатами вне WGS84 или с заглушкой **(0, 0)** **пропускаются** — в таблицу не попадают. Счётчики: **`skippedNoStartTime`**, **`skippedNoCoordinates`**. Для сохранённых строк по валидным **`lat` / `lng`** пересчитываются и пишутся в БД **`continent`**, **`country`**, **`location_hint`** (см. описание **GET** выше).

**Успешный ответ (200):**
```json
{
  "success": true,
  "message": "Синхронизация Earth Day cleanups выполнена",
  "data": {
    "deletedCount": 0,
    "fetchedFromApi": 120,
    "newRows": 40,
    "updatedRows": 80,
    "skippedNoStartTime": 2,
    "skippedNoCoordinates": 1,
    "skippedInvalid": 0,
    "upsertDbErrors": 0,
    "totalInTable": 500,
    "window": {
      "deleteIfCleanupDateBeforeMs": 1234567890123,
      "arcgisCleanupDateFromMs": 1234567890123,
      "arcgisCleanupDateToMs": 1234567890123,
      "nowMs": 1234567890123
    },
    "parseErrors": []
  }
}
```

**`parseErrors`** — массив объектов для отображения в админке (ошибки/пропуски при разборе и записях в БД). Примеры полей: `code`, `message`, `objectid`, `globalid`, `sqlMessage`, …  
Коды в `parseErrors`, среди прочих: `SKIP_NO_START_TIME` (дублирует счётчик), `MISSING_OBJECTID`, `MISSING_GLOBALID`, `INVALID_CLEANUP_DATE`, `DB_UPSERT`. Пропуски только из‑за координат в `parseErrors` **не дублируются** — смотрите **`skippedNoCoordinates`**.

**Ошибка ArcGIS (502 или HTTP ответа сервиса):** `success: false`, в **`errorDetails`** — `arcgisError`, `httpStatus`; тексты ошибок смотрите в `message` / `errorDetails`.

### PATCH `/earthday-cleanups-admin/:objectid`

Обновляет **только** поле **`used_for_internal_request`**. Когда в админке **выбираете запись импорта для создания заявки Joy Pick**, отправьте **`true`** или **`1`**, чтобы пометить строку как уже использованную и не предлагать её повторно.

**Заголовок:** `Content-Type: application/json`

**Тело (обязательно):**
```json
{ "used_for_internal_request": true }
```
Допустимо также **`false`** / **`0`** (например, отмена пометки вручную) и числа **`0`** / **`1`**.

**Ответ `200`:** `data: { objectid, used_for_internal_request: true|false }` (boolean).  
**404** — нет строки с таким **`objectid`**.  
**400** — нет поля или неверный тип.

### POST `/earthday-cleanups-admin/bulk-create-requests`

Пакетное создание заявок **`category: event`** с **`from_external_source: true`** из выбранных строк **`earthday_cleanups`** за один запрос. Для каждой строки собираются **`name`**, **`description`**, **`start_date`**, **`latitude` / `longitude`**, **`city`**.  
**Время:** календарный день из **`cleanup_date`** (UTC), для **`start_time`** в формате **HH:mm** часы и минуты подставляются в эту дату **как UTC** (как в админке).  
**Описание:** основной текст из названий/локаций события; при необходимости блок «Организатор»; в **конце** при наличии — **`Email:`** из **`email_address_`** и полный **`Адрес:`** из **`GeoCodedAddress`** (адрес парсинга не дублируется в «шапке» описания).  
**`city` в заявке:** первое непустое из полей строки **`city`**, **`City`**, **`country`** (как на клиенте; без вычленения города из адреса). В текущей схеме БД чаще заполнено только **`country`**.  

**Чанки по 5:** клиент шлёт **не больше 5** **`objectid`** за один запрос, дожидается ответа и затем следующий чанк — так удобно показывать **прогресс** при небольшом объёме. На сервере **нет группировки** по адресу: для **каждой** строки — логика Wikimedia Commons (до **`EARTHDAY_WIKIMEDIA_DOWNLOAD_MAX_CANDIDATES`** кандидатов, поочерёдно до **первого** успешного скачивания и сжатия **≤ 1 МБ (JPEG)**), запись в **`request_creation_gallery`** и **`photos_before`**; после успеха — **`used_for_internal_request = 1`**. Кэш изображений по региону — см. код/миграции `earthday_image_cache` (не дублируем здесь полностью).

**Авторизация:** только суперадмин.

**Тело (JSON):**
```json
{ "objectids": [ 101, 102, 103, 104, 105 ] }
```
Допустимо поле **`object_ids`** или **`ids`**. Дубликаты **`objectid`** удаляются. Максимум **`EARTHDAY_BULK_CHUNK_MAX`** id за запрос (по умолчанию **5**).

**Ответ `200`:** всегда при отработанном запросе (валидация тела прошла): **`success: true`**, **`requested_count`**, **`created_count`**, **`created`**, **`errors_count`**, **`errors`**, **`semantics: "chunk_sequential"`**, флаг **`batch_all_failed`**: **`true`**, если в теле были id, но **`created_count === 0`** (ни одна заявка не создана) — клиент может по нему показать предупреждение, **HTTP при этом остаётся 200**.

**Частичный успех внутри чанка:** успешные заявки **не откатываются**, если другие id в том же запросе упали. Отдельной транзакции на весь чанк нет.

Коды в **`errors`**, среди прочих: **`NOT_FOUND`**, **`ALREADY_USED`**, **`BAD_COORDS`**, **`BAD_DATE`**, **`BAD_START_TIME`**, **`NO_SEARCH`**, **`WIKIMEDIA`**, **`NO_COMMONS_IMAGES`**, **`IMAGE_PIPELINE`**, **`CREATE_REQUEST`**, **`MARK_USED_FAILED`**.

**`400`:** неверное тело (не объект, не массив id, пустой список, **больше лимита чанка**).

---

### Асинхронное массовое создание (сотни `objectid`, рекомендуется для админки)

Чтобы **не держать** сотни последовательных HTTP-запросов от браузера и не упираться в таймауты/обрывы сети, используйте **очередь на сервере** + опрос статуса.

**Идея:** один **`POST`** с полным списком id → сервер сразу возвращает **`job_id`**; фактическое создание заявок идёт **порциями** в **cron** (тот же проход, что и остальные задачи в `runAllCronTasks`, интервал задаётся в приложении, например раз в несколько минут). За один проход cron обрабатывает до **`EARTHDAY_ASYNC_JOB_CHUNKS_PER_TICK`** чанков подряд (по умолчанию **10**), каждый чанк — не больше **`EARTHDAY_BULK_CHUNK_MAX`** id (как у **`POST .../bulk-create-requests`**).

**Глобально на весь сервис** (общая БД, без тенантов) в один момент может быть **не более одной активной** async-задачи этого типа: статусы **`pending`** и **`running`** считаются активными. После **`done`** или **`failed`** можно поставить новую. Пока активная есть, второй **`POST .../bulk-create-requests-async`** от любого суперадмина отклоняется (**`409`**, см. ниже). Любой суперадмин с тем же доступом к **`earthday-cleanups-admin`** bulk может **читать** статус по **`job_id`** и через **`GET .../bulk-create-jobs/active`**, чтобы синхронизировать прогресс и блокировку парсинга у всех модераторов.

**Переменные окружения (опционально):**

| Переменная | Смысл | По умолчанию |
|------------|--------|----------------|
| `EARTHDAY_ASYNC_BULK_MAX_IDS` | Максимум **`objectid`** в одной задаче | **2000** (жёсткий потолок на бэке **5000**) |
| `EARTHDAY_ASYNC_JOB_CHUNKS_PER_TICK` | Сколько чанков за один вызов обработчика из cron | **10** |
| `EARTHDAY_ASYNC_CREATE_LOCK_SEC` | Таймаут **`GET_LOCK`** при постановке задачи (секунды, **5…120**) | **30** |

#### `POST /earthday-cleanups-admin/bulk-create-requests-async`

**Авторизация:** только суперадмин, заголовок **`Authorization: Bearer …`**, **`Content-Type: application/json`**.

**Тело:** как у синхронного bulk — **`{ "objectids": [ … ] }`** (или **`object_ids`** / **`ids`**). Дубликаты удаляются; пустой список или превышение **`EARTHDAY_ASYNC_BULK_MAX_IDS`** → **`400`**.

**Успешный ответ `200`, `data`:**
- **`job_id`** (строка UUID) — для опроса статуса;
- **`total`** — сколько id принято в задачу;
- **`chunk_size`** — размер одного внутреннего чанка (= **`EARTHDAY_BULK_CHUNK_MAX`**, по умолчанию 5).

**Ошибки:**
- **`400`** — валидация тела;
- **`409 Conflict`** — уже есть активная задача (**`pending`** / **`running`**). Тело JSON (без обёртки `success/data` как у части других ошибок): **`success: false`**, **`message`** (по-русски для UI), верхнеуровневое поле **`code: "EARTHDAY_BULK_ALREADY_RUNNING"`**, опционально **`data: { existing_job_id }`**;
- **`503`** — не удалось взять серверную блокировку постановки за отведённое время или ошибка блокировки: **`code`** — **`EARTHDAY_BULK_LOCK_TIMEOUT`** или **`EARTHDAY_BULK_LOCK_ERROR`**;
- **`500`** — прочие ошибки БД и т.п.

Гонка двух одновременных **`POST`** снимается **атомарно** (MySQL **`GET_LOCK`** + проверка активной записи + **`INSERT`** в одной сессии).

#### `GET /earthday-cleanups-admin/bulk-create-jobs/active`

**Авторизация:** только суперадмин (тот же уровень, что у остальных bulk-эндпоинтов Earth Day).

**Успешный ответ `200`:** **`data`** — **`null`**, если нет задачи со статусом **`pending`** или **`running`**; иначе **один** объект (самая ранняя по **`created_at`** среди активных): **`job_id`**, **`status`**, **`total`**, **`progress_offset`**, **`progress_done`**, **`updated_at`**, **`objectids`** — полный массив id в порядке очереди (как в теле **`POST`**), для скрытия строк парсинга у всех клиентов без локального storage.

#### `GET /earthday-cleanups-admin/bulk-create-jobs/:jobId`

Статус задачи **любой** (не только создатель): любой суперадмин с доступом к bulk Earth Day.

**Успешный ответ `200`, `data` (основные поля):**

| Поле | Описание |
|------|-----------|
| `job_id` | Идентификатор задачи |
| `status` | **`pending`** — ещё не брала cron; **`running`** — идёт обработка; **`done`** — все id обработаны; **`failed`** — фатальная ошибка чанка (см. **`message`**) |
| `total` | Всего id в задаче |
| `progress_offset` | Сколько id уже **отработано** с начала массива (смещение; растёт к **`total`**) |
| `progress_done` | Дублирует **`progress_offset`** (удобно для прогресс-бара) |
| `remaining` | **`total - progress_offset`** |
| `created_count` | Размер накопленного массива **`created`** |
| `errors_count` | Размер накопленного массива **`errors`** |
| `created` | Массив **`{ objectid, request_id }`** |
| `errors` | Массив объектов ошибок по objectid (тот же формат, что у синхронного bulk) |
| `message` | Текст при **`failed`** |
| `chunk_size` | Размер чанка |
| `objectids` | Полный массив **`objectid`** в порядке постановки в очередь (как в теле **`POST`**) |
| `created_at`, `updated_at` | Метки времени |

**`404`** — нет задачи с таким **`jobId`**.

#### `GET /earthday-cleanups-admin/bulk-create-jobs`

Последние задачи **текущего** суперадмина (история по **`created_by`**; для «что сейчас крутится у всех» используйте **`GET .../bulk-create-jobs/active`**).

**Query:** **`limit`** — **1…50**, по умолчанию **20**.

**Ответ `200`, `data.items`:** массив кратких записей: **`job_id`**, **`status`**, **`progress_offset`**, **`total`**, **`message`**, **`created_at`**, **`updated_at`**.

---

**Рекомендации для фронта (админка):**

1. При открытии экрана Earth Day сначала **`GET .../bulk-create-jobs/active`**: если не **`null`** — показать глобальный прогресс, **`objectids`** для скрытия строк парсинга, запретить повторный запуск до **`done`** / **`failed`**.
2. Опрос **`GET .../bulk-create-jobs/:jobId`** каждые **3–10 с** (при известном **`job_id`**); при **`document.visibilityState === 'hidden'`** — реже или с паузой, при возврате на вкладку — сразу один запрос.
3. При **`status === 'done'`** или **`failed`** — остановить таймер; при **`done`** можно очистить сохранённый **`job_id`** в storage.
4. **`POST .../async`** при **`409`** и **`code: EARTHDAY_BULK_ALREADY_RUNNING`** — не создавать вторую задачу; при необходимости подставить **`existing_job_id`** из ответа в опрос статуса.

### GET `/earthday-cleanups-admin/:objectid/wikimedia-preview`

Прокси-эндпоинт для админки: получает превью изображений из **Wikimedia Commons** по данным записи `earthday_cleanups`.
Нужен, потому что прямой запрос с браузера часто упирается в CORS.

**Авторизация:** только суперадмин (`isSuperAdmin: true`).

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `limit` | Опционально. Целое число **1..50**, по умолчанию **18** |

**Логика поиска:**
- Берётся запись по `objectid` из `earthday_cleanups` (включая **`lat`**, **`lng`**, `GeoCodedAddress`, `location_hint`, `country`, `name_of_cleanup_location`).
- По очереди пробуются стратегии (до первой с результатами, затем результаты дополняются следующими при нехватке `limit`):
  1. **`nearcoord`** — геопоиск на Commons (`nearcoord:<радиус>km,lat,lng`) + **`filetype:bitmap`** (растровые фото, без PDF и прочих «документов» в индексе).
  2. Текст **`GeoCodedAddress`** (+ `country`, если строка не дублирует страну).
  3. **`name_of_cleanup_location` + GeoCodedAddress** (если оба заданы).
  4. **`location_hint`** (+ `country` при необходимости).
  5. Только **`country`**, если других данных нет.
- Дополнительно отбрасываются файлы с расширениями вроде **`.pdf`**, **`.svg`**, видео/аудио; в превью попадают в основном **`.jpg`/`.jpeg`/`.png`/`.gif`/`.webp`**.
- Снижается доля **спутниковых / орто / с орбиты** снимков: к строке поиска добавляются отрицательные слова и фразы CirrusSearch (в т.ч. **ISS**, **NASA**, фразы вроде **View of Earth** / **Earth at night**) и отсев по шаблонам в **имени файла** (например `ISS030-E-…`, ночные снимки с орбиты).
- Уклон в **природу / уборку** и минусы по городу/спутнику/музеям задаются **короткой** строкой (лимит Commons ~300 символов). Отсев по **имени файла** (здания, орбита, taxidermy, banding, indoor…). Кандидаты **сортируются по score** (cleanup/beach/park ↑, museum/specimen ↓), не случайный порядок.
- **Vision (OpenRouter)** при **скачивании** новых картинок из Commons (`EARTHDAY_VISION_FILTER`, по умолчанию вкл. при `OPENROUTER_API_KEY`). **Reject** → не сохраняем. Разовая/периодическая чистка кэша: `node scripts/earthday_purge_bad_cache_images.js` (`--dry-run`, `--all`, `--limit=N`) — удаляет плохие из кэша/uploads (файл на диске **сохраняется**, если URL уже в заявке). **При reuse кэша vision не вызывается** — только проверка, что файл существует.
- Одинаковые **`full_url`** (редиректы/дубли) по-прежнему **дедуплицируются**.
- **Разнообразие при каждом запросе:** при достаточно большом `totalhits` выбирается случайное смещение **`sroffset`** в первых N попаданиях (по умолчанию **N=500**, env **`WIKIMEDIA_RANDOM_OFFSET_MAX`**). Перед выборкой порядок кандидатов **перемешивается**, итоговый список превью — тоже **в случайном порядке** (в разумных пределах одного и того же ответа API).
- Радиус nearcoord по умолчанию **25 km**; можно переопределить env **`WIKIMEDIA_NEARRADIUS_KM`** (от 5 до 80).

**Успешный ответ (200):**
```json
{
  "success": true,
  "message": "Wikimedia preview loaded",
  "data": {
    "objectid": 123456,
    "limit": 18,
    "search_strategy": "nearcoord_bitmap",
    "srsearch": "nearcoord:25km,52.52,13.41 filetype:bitmap",
    "attempts": [
      { "label": "nearcoord_bitmap", "srsearch": "nearcoord:25km,52.52,13.41 filetype:bitmap" },
      { "label": "address_bitmap", "srsearch": "Berlin Germany filetype:bitmap" }
    ],
    "items": [
      {
        "thumb_url": "https://upload.wikimedia.org/...",
        "full_url": "https://upload.wikimedia.org/...",
        "title": "File:Berlin skyline.jpg",
        "page_url": "https://commons.wikimedia.org/wiki/File%3ABerlin_skyline.jpg"
      }
    ],
    "urls": [
      "https://upload.wikimedia.org/..."
    ]
  }
}
```

**Ошибки:**
- `404` — запись `earthday_cleanups` с таким `objectid` не найдена
- `400` — некорректный `objectid`, `limit` вне диапазона, либо нет ни координат, ни текстовых полей для поиска
- `502` — ошибка ответа/таймаут Wikimedia Commons

---

## 💳 Stripe Integration

### Обзор

Все операции со Stripe выполняются на бэкенде через API. Мобильное приложение только инициирует операции и отображает результаты. Это обеспечивает безопасность (секретные ключи не хранятся в приложении) и централизованную логику.

### Комиссии

- **Комиссия платформы:** 7% (вычитается от исходной суммы)
- **Комиссия Stripe:** 10.9% + $0.33 (вычитается автоматически при capture)
- **Волонтёр получает:** Исходная сумма - Комиссия платформы (7%) - Комиссия Stripe (10.9% + $0.33)

**Пример:** Платеж $100
- Комиссия платформы: $7.00
- Комиссия Stripe: $11.23
- Волонтёр получает: $81.77

---

### Создание Stripe Express Account

**POST** `/stripe/create-account`

**Требует аутентификации**

**Описание:**
Создает Express Account для волонтёра с предзаполненными данными согласно рекомендациям Stripe Support.

**Request Body:**
```json
{
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+5511999999999",
  "city": "São Paulo",
  "country": "BR"
}
```

`user_id` берётся из JWT (тело `user_id` не используется для привязки аккаунта).

**Поле `country` (обязательное при первом создании аккаунта):**
- Формат: **ISO 3166-1 alpha-2**, ровно две латинские буквы в любом регистре (на сервере приводится к верхнему).
- Пустая строка, `null` или отсутствие поля — **ошибка** (см. ниже). Дефолта `US` нет.
- Страна Connected Account задаётся **только здесь** при `accounts.create`; в hosted onboarding Stripe **нельзя** сменить страну аккаунта.

**Response (200):**
```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "account_id": "acct_xxxxx",
    "account_link_url": "https://connect.stripe.com/setup/s/xxxxx",
    "message": "Account created successfully"
  }
}
```

**Ошибка (400) — нет или неверный формат страны:**
```json
{
  "success": false,
  "message": "country is required (ISO 3166-1 alpha-2, e.g. BR, US)",
  "timestamp": "...",
  "errorDetails": {
    "code": "STRIPE_COUNTRY_REQUIRED"
  }
}
```
или
```json
{
  "success": false,
  "message": "country must be exactly 2 letters (ISO 3166-1 alpha-2)",
  "errorDetails": {
    "code": "STRIPE_COUNTRY_INVALID"
  }
}
```

**Ошибка (400) — Stripe не принимает страну для Connect (например не включена в Dashboard):**
```json
{
  "success": false,
  "message": "...",
  "errorDetails": {
    "code": "STRIPE_COUNTRY_NOT_SUPPORTED",
    "stripeCode": "account_country_invalid"
  }
}
```

**Ошибка (409) — не удалось удалить старый Connect в Stripe при смене страны** (например уже были выплаты / баланс; редко для «только начал онбординг»):
```json
{
  "success": false,
  "message": "...",
  "errorDetails": {
    "code": "STRIPE_ACCOUNT_COUNTRY_RESET_FAILED",
    "stripeCountry": "US",
    "requestedCountry": "AM"
  }
}
```

**Ошибка (400) — валидация express-validator:**
```json
{
  "success": false,
  "message": "Validation error",
  "errors": [...]
}
```

**Ошибка (500):**
```json
{
  "success": false,
  "message": "Error creating Stripe account",
  "error": "..."
}
```

**Важно:**
- Страна Connected Account задаётся при `accounts.create` и **не меняется** внутри hosted onboarding.
- Если в `stripe_accounts` уже есть аккаунт и **страна в теле совпадает** со страной в Stripe — выдаётся новый `account_link_url` для доонбординга.
- Если страна в теле **другая** — сервер вызывает **`accounts.del`** у старого `acct_*`, удаляет строку в `stripe_accounts`, обнуляет `users.stripe_id` и **создаёт новый** Connect с переданной страной (пользователь проходит Express уже под AM и т.д.).
- Если Stripe **не даёт** удалить старый аккаунт — **409** с `STRIPE_ACCOUNT_COUNTRY_RESET_FAILED` (тогда только поддержка).
- Автоподстановки `US` при ошибке страны **нет**.

---

### Проверка статуса Stripe аккаунта

**GET** `/stripe/account-status?user_id=<uuid>`

**Требует аутентификации**

**Описание:**
Проверяет статус Stripe аккаунта пользователя и возвращает актуальную информацию из Stripe API. При каждом вызове обновляет кэш в таблице `users`: поля `stripe_account_status`, `stripe_status_label`, `can_donate`, `can_receive_payouts`, `stripe_status_updated_at`. Эти поля затем возвращаются в `GET /api/auth/me` и `GET /api/users/:id`, поэтому экран статуса Stripe можно показывать без лишнего вызова этого эндпоинта.

**Response (200):**
```json
{
  "success": true,
  "message": "Account status retrieved",
  "data": {
    "account_id": "acct_xxxxx",
    "charges_enabled": true,
    "payouts_enabled": true,
    "details_submitted": true,
    "onboarding_complete": true,
    "account_link_url": "https://connect.stripe.com/setup/s/xxxxx"
  }
}
```

**Если аккаунт не найден:**
```json
{
  "success": true,
  "message": "Account status retrieved",
  "data": {
    "account_id": null,
    "charges_enabled": false,
    "payouts_enabled": false,
    "details_submitted": false,
    "onboarding_complete": false
  }
}
```

**Важно:**
- `account_link_url` возвращается только если `onboarding_complete = false`
- Статус автоматически обновляется из Stripe API при каждом запросе
- Кэш в `users` обновляется при вызове этого эндпоинта и по вебхуку Stripe `account.updated`

---

### Webhooks от Stripe

**POST** `/stripe/webhooks`

**НЕ требует аутентификации** (используется только Stripe)

**Описание:**
Endpoint для получения webhooks от Stripe. Обрабатывает следующие события:
- `account.updated` - обновление аккаунта
- `payment_intent.succeeded` - успешный платеж
- `payment_intent.payment_failed` - неудачный платеж
- `transfer.created` - создан transfer
- `transfer.paid` - transfer выплачен
- `transfer.failed` - transfer не удался

**КРИТИЧЕСКИ ВАЖНО - Настройка SSL/HTTPS:**

Stripe **требует HTTPS** для webhooks в продакшене. На Beget SSL настраивается следующим образом:

1. **Войдите в панель управления Beget**
2. **Перейдите в раздел "Домены" → "SSL сертификаты"**
3. **Выберите домен** `joypick.world`
4. **Установите SSL сертификат:**
   - Можно использовать **Let's Encrypt** (бесплатный, автоматическое обновление)
   - Или загрузить свой сертификат
5. **Включите "Принудительное перенаправление HTTP → HTTPS"** (опционально, но рекомендуется)

**После настройки SSL:**
- Webhook URL в Stripe Dashboard должен быть: `https://joypick.world/api/stripe/webhooks`
- Сервер автоматически проверяет HTTPS в продакшене

**Настройка в Stripe Dashboard:**

1. Перейдите в **Stripe Dashboard** → **Developers** → **Webhooks**
2. Нажмите **"Add endpoint"**
3. Укажите URL: `https://joypick.world/api/stripe/webhooks`
4. Выберите события для отправки:
   - `account.updated`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `transfer.created`
   - `transfer.paid`
   - `transfer.failed`
5. Скопируйте **Signing secret** (начинается с `whsec_`)
6. Добавьте в `.env` файл:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_xxxxx
   ```

**Важно:**
- Webhook secret должен быть настроен в переменных окружения (`STRIPE_WEBHOOK_SECRET`)
- Подпись webhook проверяется автоматически
- Все события обрабатываются и обновляют соответствующие записи в базе данных
- В продакшене endpoint автоматически проверяет наличие HTTPS

---

## 💰 Платежи (Payments)

### Создание доната

**POST** `/payments/create-donation`

**Требует аутентификации**

**Описание:**
Создает PaymentIntent для доната к заявке. Средства холдируются до завершения заявки.

**Request Body:**
```json
{
  "request_id": "uuid-заявки",
  "user_id": "uuid-пользователя",
  "amount": 10.00,
  "request_category": "event"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Payment intent created",
  "data": {
    "payment_intent_id": "pi_xxxxx",
    "client_secret": "pi_xxxxx_secret_xxxxx",
    "message": "Payment intent created"
  }
}
```

**Ошибка (400):**
```json
{
  "success": false,
  "message": "Ошибка валидации",
  "errors": [...]
}
```

**Важно:**
- Минимум 50 центов (требование Stripe)
- `client_secret` используется для PaymentSheet в мобильном приложении
- PaymentIntent создается с `capture_method: manual` (средства холдируются)
- Донат автоматически сохраняется в таблицу `donations`

**Возможные ошибки:**
- Ошибка 500: "Ошибка при создании PaymentIntent для доната" - см. детали в разделе "Атомарное создание заявки с платежом"
- Все ошибки содержат детальную информацию в поле `errorDetails`
- Если `client_secret` отсутствует - это критическая ошибка, нужно повторить попытку или обратиться в поддержку

---

### ~~Создание платежа за заявку (cost)~~ [УДАЛЕН]

**POST** `/payments/create-request-payment`

**❌ ЭНДПОИНТ УДАЛЕН**

**Описание:**
Эндпоинт удален в рамках упрощения системы платежей. Теперь все платежи идут только через донаты.

**Вместо этого используйте:**
- `POST /api/payments/create-donation` - для создания доната от любого пользователя (включая создателя заявки)

**Response (410 Gone):**
```json
{
  "success": false,
  "message": "Эндпоинт удален. Платные заявки больше не поддерживаются. Используйте POST /api/payments/create-donation для создания доната от создателя заявки.",
  "statusCode": 410
}
```

---

### Завершение заявки и выплата волонтёру

**POST** `/payments/complete-request`

**Требует аутентификации**

**Описание:**
Выполняет capture всех PaymentIntent и создает transfer волонтёру. Рассчитывает комиссии и переводит средства исполнителю.

**Request Body:**
```json
{
  "request_id": "uuid-заявки",
  "performer_user_id": "uuid-исполнителя"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Request completed and transfer created",
  "data": {
    "captured_payment_intents": ["pi_xxxxx", "pi_yyyyy"],
    "transfer_id": "tr_xxxxx",
    "transfer_amount_cents": 8177,
    "platform_fee_cents": 700,
    "stripe_fee_cents": 1123,
    "message": "Request completed and transfer created"
  }
}
```

**Ошибка (404):**
```json
{
  "success": false,
  "message": "Stripe аккаунт исполнителя не найден"
}
```

**Логика:**
1. Получает все PaymentIntent для заявки (только донаты)
2. Выполняет capture всех PaymentIntent
3. Рассчитывает сумму для transfer:
   - `total_amount = sum(donations)` (включая донат создателя, если он делал)
   - `platform_fee = total_amount * 0.07`
   - `stripe_fee = (total_amount * 0.109) + 33`
   - `transfer_amount = total_amount - platform_fee - stripe_fee`
4. Создает Transfer в Stripe на аккаунт исполнителя
5. Обновляет статус заявки на `archived`

**Важно:**
- Если capture не удался для некоторых PaymentIntent, они добавляются в `capture_errors`
- Заявка всегда обновляется, даже при ошибках Stripe
- Transfer создается только если у исполнителя есть Stripe аккаунт

---

### Получение истории платежей

**GET** `/payments/history?user_id=<uuid>&page=1&limit=20`

**Требует аутентификации**

**Описание:**
Возвращает историю платежей пользователя (донаты и платежи за заявки).

**Response (200):**
```json
{
  "success": true,
  "message": "Payment history retrieved",
  "data": {
    "payments": [
      {
        "id": "pi_xxxxx",
        "type": "donation",
        "amount": 10.00,
        "status": "succeeded",
        "request_id": "uuid-заявки",
        "request_name": "Clean up park",
        "created_at": "2024-01-15T10:30:00.000Z"
      }
    ],
    "total": 50,
    "page": 1,
    "limit": 20
  }
}
```

**Параметры:**
- `user_id` (обязательный) - UUID пользователя
- `page` (опционально, по умолчанию 1) - номер страницы
- `limit` (опционально, по умолчанию 20, максимум 100) - количество записей на странице

---

### Получение истории выплат

**GET** `/payments/payouts?user_id=<uuid>&page=1&limit=20`

**Требует аутентификации**

**Описание:**
Возвращает историю выплат волонтёру (transfers).

**Response (200):**
```json
{
  "success": true,
  "message": "Payout history retrieved",
  "data": {
    "payouts": [
      {
        "id": "tr_xxxxx",
        "amount_cents": 8177,
        "status": "paid",
        "request_id": "uuid-заявки",
        "request_name": "Clean up park",
        "platform_fee_cents": 700,
        "stripe_fee_cents": 1123,
        "created_at": "2024-01-15T10:30:00.000Z"
      }
    ],
    "total": 10,
    "page": 1,
    "limit": 20
  }
}
```

**Параметры:**
- `user_id` (обязательный) - UUID пользователя
- `page` (опционально, по умолчанию 1) - номер страницы
- `limit` (опционально, по умолчанию 20, максимум 100) - количество записей на странице

**Статусы transfer:**
- `pending` - ожидает обработки
- `paid` - выплачен
- `failed` - не удался
- `canceled` - отменен

---

## Stripe Admin API

**Требует суперадминских прав**

### Получение активных заявок с платежами

**GET** `/stripe-admin/requests/active`

**Описание:**
Получает список активных заявок (new, inProgress, pending), которые являются платными или имеют донаты. В каждой заявке возвращаются `joined_user_id`, `created_by` и вычисляемое поле `performer_user_id` (исполнитель, которому предназначается transfer: присоединившийся пользователь или создатель).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "id": "uuid-заявки",
        "name": "Название заявки",
        "category": "wasteLocation",
        "status": "inProgress",
        "joined_user_id": "uuid-исполнителя",
        "created_by": "uuid-создателя",
        "performer_user_id": "uuid-исполнителя",
        "created_at": "2024-01-15T10:30:00.000Z",
        "updated_at": "2024-01-15T12:30:00.000Z",
        "donations": [
          {
            "user_id": "uuid-создателя",
            "email": "creator@example.com",
            "name": "Имя создателя",
            "amount": 50.00,
            "payment_intent_id": "pi_xxxxx",
            "stripe_status": "succeeded",
            "capture_method": "automatic",
            "amount_captured": 50.00,
            "amount_received": 50.00,
            "is_captured": true
          },
          {
            "user_id": "uuid-донатера",
            "email": "donor@example.com",
            "name": "Имя донатера",
            "amount": 25.00,
            "payment_intent_id": "pi_yyyyy",
            "stripe_status": "succeeded",
            "capture_method": "automatic",
            "amount_captured": 25.00,
            "amount_received": 25.00,
            "is_captured": true
          }
        ],
        "donations_count": 2,
        "total_donations": 75.00
      }
    ],
    "total": 1
  }
}
```

### Получение закрытых/архивных заявок с платежами

**GET** `/stripe-admin/requests/closed`

**Описание:**
Получает список закрытых заявок (approved, rejected, completed), которые являются платными или имеют донаты. Transfers берутся из локальной таблицы `transfers` по `request_id`. В каждой заявке возвращаются `joined_user_id`, `created_by` и `performer_user_id` (исполнитель, которому предназначается transfer).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "id": "uuid-заявки",
        "name": "Название заявки",
        "category": "wasteLocation",
        "status": "completed",
        "joined_user_id": "uuid-исполнителя",
        "created_by": "uuid-создателя",
        "performer_user_id": "uuid-исполнителя",
        "created_at": "2024-01-15T10:30:00.000Z",
        "updated_at": "2024-01-15T16:30:00.000Z",
        "donations": [
          {
            "user_id": "uuid-создателя",
            "email": "creator@example.com",
            "name": "Имя создателя",
            "amount": 50.00,
            "payment_intent_id": "pi_xxxxx",
            "stripe_status": "succeeded",
            "capture_method": "automatic",
            "amount_captured": 50.00,
            "amount_received": 50.00,
            "is_captured": true
          },
          {
            "user_id": "uuid-донатера",
            "email": "donor@example.com",
            "name": "Имя донатера",
            "amount": 25.00,
            "payment_intent_id": "pi_yyyyy",
            "stripe_status": "succeeded",
            "capture_method": "automatic",
            "amount_captured": 25.00,
            "amount_received": 25.00,
            "is_captured": true
          }
        ],
        "donations_count": 2,
        "total_donations": 75.00,
        "transfers": [
          {
            "to_user_id": "uuid-исполнителя",
            "amount": 68.50,
            "transfer_id": "tr_zzzzz",
            "status": "paid",
            "created": 1705316400,
            "error": null
          }
        ],
        "request_balance": 6.50,
        "total_captured": 75.00,
        "total_transferred": 68.50
      }
    ],
    "total": 1
  }
}
```

**Поля ответа:**
- `donations` - массив донатов с информацией о статусе захвата (включая донат создателя, если он делал)
- `transfers` - массив переводов (только для закрытых заявок)
- `request_balance` - остаток средств по заявке (захвачено - переведено)
- `total_captured` - общая сумма захваченных средств
- `total_transferred` - общая сумма переведенных средств

**Статусы Stripe:**
- `requires_capture` - средства авторизованы, но не захвачены
- `succeeded` - средства захвачены
- `canceled` - отменен
- `refunded` - возвращен

---

## Примечания

1. Все даты в формате ISO 8601: `2024-01-01T00:00:00.000Z`
2. Суммы денег в центах (1000 = 10.00 USD)
3. Координаты: `latitude` (широта), `longitude` (долгота)
4. Радиус поиска в метрах
5. Токен JWT действителен 7 дней (по умолчанию)
6. При истечении токена получите новый через `/auth/refresh`
7. Базовый URL: `https://joypick.world`
8. **Верификация email:** После регистрации автоматически отправляется код верификации (6 цифр), действителен 10 минут
9. **Real-time чаты:** Используйте Server-Sent Events (SSE) для получения новых сообщений в реальном времени через `GET /api/chats/:chatId/events`

---

## Админские эндпоинты для управления Transfer

### Создание Transfer вручную

**POST** `/stripe-admin/create-transfer`

**Требует суперадминских прав**

**Описание:**
Создание Transfer вручную для заявки. **Перед созданием трансфера бэкенд автоматически проверяет каждый донат в Stripe** и удаляет из заявки те, у которых платёж не успешен (`requires_payment_method`, `canceled` и т.д.). Админу не нужно вручную удалять такие донаты — достаточно нажать «Создать перевод»; расчёт суммы и трансфер идут только по успешным донатам.

**Ответ (200)** при успехе содержит, в том числе:
- `removed_failed_donations` — сколько донатов с неуспешным платежом было удалено перед трансфером
- `removed_failed_donation_ids` — их id
- Если удалён хотя бы один: сообщение вида «Transfer created. Before transfer, N donation(s) with failed/incomplete payment were removed from the request.»

**Request Body:**
```json
{
  "request_id": "uuid-заявки",
  "performer_user_id": "uuid-исполнителя",
  "amount_cents": 5000
}
```

**Параметры:**
- `request_id` (обязательный) - UUID заявки
- `performer_user_id` (обязательный) - UUID исполнителя/создателя, кому переводим деньги
- `amount_cents` (опциональный) - сумма в центах. Если не указана, рассчитывается автоматически с учетом комиссий

**Response (200):** В `data` также возвращаются `removed_failed_donations` (число удалённых неуспешных донатов) и `removed_failed_donation_ids`.
```json
{
  "success": true,
  "message": "Transfer created successfully",
  "data": {
    "removed_failed_donations": 1,
    "removed_failed_donation_ids": ["uuid-доната"],
    "transfer": {
      "id": "uuid",
      "transfer_id": "tr_xxxxx",
      "request_id": "uuid-заявки",
      "performer_user_id": "uuid-исполнителя",
      "amount_cents": 5000,
      "amount_dollars": "50.00",
      "platform_fee_cents": 350,
      "platform_fee_dollars": "3.50",
      "stripe_fee_cents": 145,
      "stripe_fee_dollars": "1.45",
      "currency": "usd",
      "status": "pending",
      "created": 1234567890,
      "stripe_data": {
        "destination": "acct_xxxxx",
        "source_transaction": "pi_xxxxx",
        "metadata": {
          "request_id": "uuid",
          "performer_user_id": "uuid",
          "created_by": "admin_manual"
        }
      }
    },
    "request_info": {
      "id": "uuid",
      "category": "wasteLocation",
      "name": "Название заявки"
    },
    "calculations": {
      "total_donations_cents": 5000,
      "total_donations_dollars": "50.00",
      "donations_count": 1
    }
  }
}
```

**Ошибки:**
- `400` - Validation error, Request not found, No successful donations found, Transfer already exists
- `402` - Недостаточно средств на платформенном Stripe-аккаунте (balance_insufficient)
- `404` - Performer Stripe account not found
- `500` - Error creating transfer in Stripe, Error creating transfer

**Важно:**
- Transfer создается только если есть успешные донаты для заявки
- Если Transfer уже существует для этой заявки и исполнителя, вернется ошибка
- Комиссии рассчитываются автоматически: платформа 7%, Stripe 2.9% + $0.30 за транзакцию
- Можно указать `amount_cents` вручную для переопределения суммы

**Примеры использования:**

**Пример 1: Создание Transfer для заявки wasteLocation (исполнителю)**
```json
POST /api/stripe-admin/create-transfer
{
  "request_id": "4c4b6668-57a9-4c56-b234-418fff1a7ac9",
  "performer_user_id": "20286825-1c77-43f0-9357-154edaffaa77"
}
```
Сумма рассчитывается автоматически: все донаты минус комиссии.

**Пример 2: Создание Transfer для заявки event (создателю)**
```json
POST /api/stripe-admin/create-transfer
{
  "request_id": "event-uuid-123",
  "performer_user_id": "creator-uuid-456"
}
```
Для событий деньги переводятся создателю (заказчику).

**Пример 3: Создание Transfer с фиксированной суммой**
```json
POST /api/stripe-admin/create-transfer
{
  "request_id": "request-uuid",
  "performer_user_id": "performer-uuid",
  "amount_cents": 4500
}
```
Сумма переопределена вручную (например, для корректировки).

**Workflow создания Transfer:**

1. **Проверка заявки:** Система проверяет существование заявки
2. **Удаление неуспешных донатов:** Для каждого доната проверяется статус в Stripe; донаты с платёжом не в статусе succeeded/requires_capture удаляются из заявки и из расчёта (админу ничего делать не нужно)
3. **Проверка донатов:** Проверяет наличие успешных донатов для заявки (после удаления неуспешных)
4. **Проверка Transfer:** Убеждается, что Transfer еще не создан
5. **Проверка Stripe аккаунта:** Проверяет наличие Stripe аккаунта у исполнителя
6. **Расчет суммы:** Рассчитывает сумму с учетом комиссий (или использует указанную)
7. **Создание в Stripe:** Создает Transfer через Stripe API
8. **Сохранение в БД:** Сохраняет информацию о Transfer в базу данных
9. **Возврат результата:** Возвращает детальную информацию о созданном Transfer и количество удалённых неуспешных донатов

**После создания Transfer:**

- Transfer обрабатывается Stripe и переводит деньги на баланс пользователя
- Статус Transfer обновляется через webhook (`transfer.paid`, `transfer.failed`)
- Пользователь может получить деньги через instant payout или автоматическую выплату
- Админ может отслеживать статус Transfer через `/api/stripe-admin/transfers`

---

### Удаление доната из заявки (ручное, по необходимости)

**DELETE** `/stripe-admin/requests/:request_id/donations/:donation_id`

**Требует суперадминских прав**

Удаляет запись доната из заявки и уменьшает `total_contributed`. Обычно не требуется: при вызове `POST /stripe-admin/create-transfer` неуспешные донаты удаляются автоматически. Используйте только если нужно вручную исключить конкретный донат по другой причине.

**Ответ (200):** `removed_donation_id`, `amount_removed`, `request_id`, `message`.

---

**Типичные сценарии:**

1. **Заявка одобрена, но Transfer не создался:**
   - Проверьте логи/ошибки при одобрении
   - Используйте этот эндпоинт для создания Transfer вручную
   - Убедитесь, что у исполнителя есть Stripe аккаунт

2. **Старая заявка без Transfer:**
   - Найдите заявку через `/api/stripe-admin/requests/closed`
   - Проверьте наличие донатов
   - Создайте Transfer для исполнителя/создателя

3. **Неправильная сумма Transfer:**
   - Удалите старый Transfer (если возможно) или создайте новый с правильной суммой
   - Используйте `amount_cents` для указания точной суммы

---

## Управление Payout и мгновенными выплатами

### Получение баланса пользователя

**GET** `/stripe/balance/:user_id`

**Требует аутентификации**

**Описание:**
Получает доступный баланс пользователя для выплат и информацию о настройках.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "account_id": "acct_xxxxx",
    "payouts_enabled": true,
    "balance": {
      "available": [
        {
          "amount": 5000,
          "amount_dollars": "50.00",
          "currency": "usd"
        }
      ],
      "pending": [
        {
          "amount": 2500,
          "amount_dollars": "25.00", 
          "currency": "usd"
        }
      ]
    },
    "payout_schedule": {
      "interval": "daily",
      "delay_days": 2
    },
    "recent_payouts": [
      {
        "id": "uuid",
        "amount_dollars": "30.00",
        "status": "paid",
        "created_at": "2025-01-22T10:30:00Z"
      }
    ],
    "can_instant_payout": true,
    "pending_transfers": [
      {
        "request_id": "uuid",
        "amount_cents": 78,
        "amount_dollars": "0.78",
        "status": "pending",
        "created_at": "2025-01-22T10:00:00Z"
      }
    ],
    "pending_transfers_total_cents": 78,
    "pending_transfers_total_dollars": "0.78"
  }
}
```

**Поля «ожидаемые выплаты»:** `pending_transfers` — список выплат из нашей БД (transfers), где пользователь получатель; `pending_transfers_total_*` — их сумма. Показывайте на фронте блок «Ожидаемые: $X.XX» по этим полям. Если список пустой при одобренной заявке — Transfer не был создан, создайте его вручную через админку (create-transfer).

---

### Получение методов выплат

**GET** `/stripe/payout-methods/:user_id`

**Требует аутентификации**

**Описание:**
Получает доступные методы выплат для пользователя, включая банковские счета и дебетовые карты.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "account_id": "acct_xxxxx",
    "instant_payout_available": true,
    "payout_settings": {
      "schedule": {
        "interval": "daily",
        "delay_days": 2
      },
      "statement_descriptor": null,
      "debit_negative_balances": false
    },
    "external_accounts": [
      {
        "id": "ba_xxxxx",
        "object": "bank_account",
        "type": "bank_account",
        "last4": "6789",
        "brand": null,
        "bank_name": "STRIPE TEST BANK",
        "currency": "usd",
        "country": "US",
        "default_for_currency": true,
        "status": "verified"
      },
      {
        "id": "card_xxxxx", 
        "object": "card",
        "type": "debit_card",
        "last4": "4242",
        "brand": "visa",
        "bank_name": null,
        "currency": "usd",
        "country": "US",
        "default_for_currency": false,
        "status": "verified"
      }
    ],
    "can_add_debit_card": true,
    "onboarding_complete": true
  }
}
```

---

### Создание мгновенной выплаты

**POST** `/stripe/instant-payout`

**Требует аутентификации**

**Описание:**
Создает мгновенную выплату на дебетовую карту (поступает в течение 30 минут).

**Request Body:**
```json
{
  "user_id": "uuid-пользователя",
  "amount": 50.00,
  "external_account_id": "card_xxxxx"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Instant payout created successfully",
  "data": {
    "payout_id": "po_xxxxx",
    "amount_cents": 5000,
    "amount_dollars": "50.00",
    "status": "in_transit",
    "arrival_date": 1737123456,
    "method": "instant",
    "external_account_id": "card_xxxxx"
  }
}
```

**Важно:**
- Доступно только для US дебетовых карт Visa/MasterCard
- Комиссия Stripe: 1.5% от суммы
- Минимум: $1.00, максимум зависит от карты
- Средства поступают в течение 30 минут

---

### Обновление расписания выплат

**PUT** `/stripe/payout-schedule/:user_id`

**Требует аутентификации**

**Request Body:**
```json
{
  "interval": "daily",
  "delay_days": 2
}
```

**Параметры:**
- `interval`: `"manual"`, `"daily"`, `"weekly"`, `"monthly"`
- `delay_days`: от 0 до 365 дней (только для автоматических выплат)

**Response (200):**
```json
{
  "success": true,
  "message": "Payout schedule updated successfully",
  "data": {
    "account_id": "acct_xxxxx",
    "payout_schedule": {
      "interval": "daily",
      "delay_days": 2
    }
  }
}
```

---

### История мгновенных выплат

**GET** `/stripe/instant-payouts/:user_id`

**Требует аутентификации**

**Query параметры:**
- `page` - номер страницы (по умолчанию 1)
- `limit` - количество записей (по умолчанию 20, максимум 100)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "payouts": [
      {
        "id": "uuid",
        "payout_id": "po_xxxxx",
        "amount_cents": 5000,
        "amount_dollars": "50.00",
        "currency": "usd",
        "status": "paid",
        "method": "instant",
        "external_account_id": "card_xxxxx",
        "failure_code": null,
        "failure_message": null,
        "arrival_date": 1737123456,
        "created_at": "2025-01-22T10:30:00Z",
        "stripe_data": {
          "automatic": false,
          "balance_transaction": "txn_xxxxx",
          "description": "Instant payout"
        }
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 20,
    "has_more": false
  }
}
```

**Статусы payout:**
- `pending` - в обработке
- `in_transit` - отправлен, ожидает поступления
- `paid` - успешно выплачен
- `failed` - ошибка выплаты
- `canceled` - отменен

---

### Тестирование Webhook событий

**POST** `/stripe/test-webhook`

**Требует аутентификации**

**Описание:**
Тестовый эндпоинт для симуляции webhook событий от Stripe. Позволяет проверить обработку webhook без реальных событий от Stripe. Полезно для отладки и тестирования обработки событий.

**Request Body:**
```json
{
  "event_type": "payment_intent.succeeded",
  "event_data": {
    "id": "pi_test_123",
    "status": "succeeded",
    "amount": 5000,
    "currency": "usd",
    "metadata": {
      "request_id": "uuid-заявки",
      "user_id": "uuid-пользователя",
      "type": "donation"
    }
  }
}
```

**Поддерживаемые типы событий:**
- `account.updated`
- `payment_intent.succeeded`
- `payment_intent.requires_capture`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `transfer.created`
- `transfer.paid`
- `transfer.failed`
- `payout.created`
- `payout.paid`
- `payout.failed`

**Response (200) - Успех:**
```json
{
  "success": true,
  "message": "Webhook test completed",
  "data": {
    "test_event": {
      "id": "evt_test_1234567890",
      "object": "event",
      "type": "payment_intent.succeeded",
      "created": 1234567890
    },
    "processing_result": {
      "success": true,
      "event_type": "payment_intent.succeeded",
      "event_id": "evt_test_1234567890",
      "message": "Payment intent succeeded event processed successfully"
    },
    "note": "This is a test endpoint. Real webhooks from Stripe go to /api/stripe/webhooks"
  }
}
```

**Response (200) - Ошибка обработки:**
```json
{
  "success": true,
  "message": "Webhook test failed",
  "data": {
    "test_event": {
      "id": "evt_test_1234567890",
      "type": "payment_intent.succeeded"
    },
    "processing_result": {
      "success": false,
      "event_type": "payment_intent.succeeded",
      "event_id": "evt_test_1234567890",
      "message": "Error processing webhook event",
      "errorDetails": {
        "errorMessage": "Column count doesn't match value count",
        "errorName": "Error",
        "errorCode": "ER_WRONG_VALUE_COUNT_ON_ROW",
        "sqlMessage": "Column count doesn't match value count at row 1",
        "sql": "INSERT INTO ..."
      }
    }
  }
}
```

**Response (400) - Неизвестный тип события:**
```json
{
  "success": true,
  "message": "Webhook test failed",
  "data": {
    "processing_result": {
      "success": false,
      "message": "Unknown event type: unknown_event",
      "errorDetails": {
        "supportedEvents": [
          "account.updated",
          "payment_intent.succeeded",
          ...
        ]
      }
    }
  }
}
```

**Важно:**
- Этот эндпоинт только для тестирования
- Реальные webhook от Stripe идут на `/api/stripe/webhooks`
- Все ошибки обработки возвращаются в `processing_result.errorDetails`
- Можно использовать для отладки проблем с webhook обработкой

---

