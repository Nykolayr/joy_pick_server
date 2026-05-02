# AI-чат поддержки: актуальный контракт (RAG + async accepted + polling)

## Что реализовано сейчас

- Запрос в чат работает асинхронно: `POST /api/support/chat` сразу возвращает `accepted`.
- Генерация ответа идет в фоне, клиент получает результат через polling.
- RAG выполняется на backend:
  - `ru` -> `docs/knowledge/support_ru/chunks.json`
  - остальные локали -> `docs/knowledge/support_en/chunks.json`
- Контекст беседы собирается на сервере из последних сообщений пользователя (из БД), клиент не отправляет всю историю.
- Провайдеры LLM:
  - primary: Gemini
  - fallback: OpenRouter

### Гостевой режим (лендинг без JWT)

- Заголовок **`X-Support-Guest-Id`**: UUID v4 (тот же id хранить в `localStorage` на клиенте).
- С тем же заголовком: `GET /api/support/chat/history`, `GET .../messages/:id`, `DELETE .../history`, `POST /api/support/chat`.
- Если передан **Bearer** — используется аккаунт пользователя, гостевой id не нужен.
- Таблица БД: `support_ai_messages_guest` (миграция `038_support_ai_messages_guest.sql`).

---

## API-контракт (текущий)

### POST `/api/support/chat`

Принимает сообщение, создает pending-запись и сразу возвращает `accepted`.

Request:

```json
{
  "message": "как создать заявку",
  "locale": "ru"
}
```

Response (200):

```json
{
  "success": true,
  "message": "Support AI request accepted",
  "data": {
    "message_id": "uuid",
    "status": "accepted"
  }
}
```

### GET `/api/support/chat/messages/:messageId`

Polling статуса конкретного сообщения текущего пользователя.

Статусы:
- `pending` — генерация еще идет
- `done` — ответ готов
- `error` — генерация завершилась ошибкой

Пример `done`:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_message": "как создать заявку",
    "answer": "Какой тип заявки вы хотите создать...",
    "answer_en": null,
    "locale": "ru",
    "model": "openai/gpt-4o-mini",
    "sources": ["intent_alias_how_to_create_request"],
    "translation_fallback": false,
    "status": "done",
    "error_message": null,
    "created_at": "2026-04-28T12:00:00.000Z",
    "updated_at": "2026-04-28T12:00:02.000Z"
  }
}
```

### GET `/api/support/chat/history`

История текущего пользователя.

Query:
- `limit` (1..200, default 50)
- `offset` (default 0)

В `items[]` есть поле `status`.

### DELETE `/api/support/chat/history`

Очищает всю AI-историю текущего пользователя.

Response:

```json
{
  "success": true,
  "message": "Support AI history cleared",
  "data": {
    "deleted": 12
  }
}
```

---

## Языковая логика

- `locale=ru`:
  - retrieval по `support_ru`
  - ответ сразу на русском
  - `answer_en` обычно `null`
- `locale=en`:
  - retrieval по `support_en`
  - ответ на английском
- другие локали:
  - вопрос переводится в `en`
  - retrieval + generation на английском
  - ответ переводится обратно в локаль

---

## Логика деградации и диагностики

Если провайдер недоступен, возвращается degraded-ответ (без 500 на клиента):

- `degraded: true`
- `ai_error_code` (например `AI_PROVIDER_REGION_BLOCKED`, `AI_TIMEOUT`, `AI_CONFIG_ERROR`)
- `ai_error_message` (сырой текст причины)

Это нужно для стабильного UX и технической диагностики во Flutter-логах.

---

## Контекст беседы

- Сервер подмешивает последние сообщения пользователя в prompt (`AI_SUPPORT_CONTEXT_TURNS`, default 8).
- Контекст берется из записей со статусом `done`.
- Текущая pending-запись из контекста исключается.

---

## ENV (актуально)

```env
AI_SUPPORT_ENABLED=1
AI_SUPPORT_TOP_K=3
AI_SUPPORT_TIMEOUT_MS=12000
AI_SUPPORT_CONTEXT_TURNS=8

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite

OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-4o-mini
```

---

## Минимальный клиентский flow (Flutter)

1. `POST /api/support/chat` -> получить `message_id`.
2. Показать локальный loading bubble.
3. Poll `GET /api/support/chat/messages/:messageId` до `done/error`.
4. Обновить bubble:
   - `done` -> показать `answer`
   - `error` -> показать retry/error UI

---

## Важное по качеству ответов

- Качество ответа зависит от актуальности `chunks.json`.
- В knowledge уже добавлены:
  - актуальный UX с кнопкой `+` (вместо "Создать")
  - синонимы типа `субботник -> событие`
  - правило уточнения типа заявки при неоднозначном вопросе.

