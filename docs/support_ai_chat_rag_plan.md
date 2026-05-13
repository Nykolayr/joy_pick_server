# AI-чат поддержки: актуальный контракт (RAG + async accepted + polling)

## Что реализовано сейчас

- Запрос в чат работает асинхронно: `POST /api/support/chat` сразу возвращает `accepted`.
- Генерация ответа идет в фоне, клиент получает результат через polling.
- RAG выполняется на backend:
  - `ru` -> `docs/knowledge/support_ru/chunks.json`
  - остальные локали -> `docs/knowledge/support_en/chunks.json`
- Контекст беседы собирается на сервере из последних сообщений пользователя (из БД), клиент не отправляет всю историю.
- Провайдер LLM для Support AI: **только OpenRouter** (`OPENROUTER_API_KEY`); размер prompt ограничивается **`AI_SUPPORT_MAX_PROMPT_TOKENS`** (по умолчанию 12500 оценочных токенов), лишние чанки урезаются.

### Гостевой режим (лендинг без JWT)

- Заголовок **`X-Support-Guest-Id`**: UUID v4 (тот же id хранить в `localStorage` на клиенте).
- С тем же заголовком: `GET /api/support/chat/history`, `GET .../messages/:id`, `DELETE .../history`, `POST /api/support/chat`.
- `DELETE /api/support/chat/history` без JWT и без заголовка: `200` и `{ deleted: 0 }` (идемпотентно, удобно для лендинга до генерации guest id).
- Если передан **Bearer** — используется аккаунт пользователя, гостевой id не нужен.
- Таблица БД: `support_ai_messages_guest` (миграция `038_support_ai_messages_guest.sql`).

### Синхронная проверка качества (`eval-reply`)

- **`POST /api/support/eval-reply`** — один запрос → один ответ Support AI **без записи в БД** (для скриптов и ручной проверки).
- Полный путь на проде: **`https://joypick.world/api/support/eval-reply`** (в `app.js` префикс **`/api`**, в `api/index.js` — **`/support`**, в роутере — **`/eval-reply`**).
- Эндпоинт **не существует для клиента**, пока в `.env` **на сервере** не задан **`SUPPORT_EVAL_SECRET`** (иначе ответ **`404`**).
- Заголовок **`X-Support-Eval-Secret`** должен совпадать с этим секретом (иначе **`403`**).
- **Один произвольный вопрос к прод-API с машины разработчика:** **`npm run support:eval:once -- "текст вопроса"`** (`scripts/support_eval_once.js`) — читает **`SUPPORT_EVAL_SECRET`** и **`SUPPORT_EVAL_BASE_URL`** из **локального** `.env`; предпочтительнее «голого» `curl` из PowerShell из‑за кавычек и JSON.
- Прогон всех эталонов по HTTP: **`npm run support:eval`** (`scripts/run_support_eval.js`, кейсы в `scripts/support_eval_cases.json`). Переменные: **`SUPPORT_EVAL_SECRET`** (обязательно, **тот же**, что на целевом сервере), **`SUPPORT_EVAL_BASE_URL`** (для прода: **`https://joypick.world/api`**; по умолчанию в скрипте — `http://127.0.0.1:300/api` для локального сервера с тем же секретом).
- **`npm run support:eval:direct`** — те же кейсы, вызов **`getSupportAiAnswer`** в процессе Node (**без** HTTP и **без** `SUPPORT_EVAL_SECRET`); для ответа с LLM нужен **`OPENROUTER_API_KEY`** (Support AI на сервере использует только OpenRouter). Проверка через прод: `support:eval:once` / `support:eval`.
- **`npm run support:eval:rag`** — только ретривал чанков (`previewSupportRetrieval`), без LLM; проверяет, что ожидаемые `chunk_id` попадают в top‑K.
- Подробный чеклист, типовые ошибки агента (`.env`, PowerShell, 403/404): **`docs/support_eval_checklist.md`** (раздел «Инструкция для агента»).

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

---

## Таксономия чанков по приложению (joy_pick)

Источник правды для пользовательских ответов — **поведение и тексты в клиенте** (`D:\Projects\joy_pick\joy_pick`). Чанки в `chunks.json` должны совпадать с тем, что пользователь реально видит. Ниже — карта **префиксов `chunk_id`** и соответствие папкам `lib/pages/`, чтобы при доработке приложения быстро находить, куда дописать знания.

| Префикс / зона | Папки и экраны в приложении | Темы |
|----------------|----------------------------|------|
| `auth_*` | `login`, `registration`, `email_verification`, сброс пароля | вход, регистрация, код на почту, валидации |
| `location_*` | старт / splash + сервисы геолокации | разрешения, выключенный GPS, настройки |
| `request_*`, `map_*` | `requests`, `new_map_listing`, `creation_all`, карточки заявок | создание трёх типов, join/unjoin, дистанция, статусы, завершение |
| `request_details` / детали | `request_details` (event, waste, speed), `donation_dialog` | кнопки действий, чат заявки, шаринг, донат с карточки |
| `donation_*`, `stripe_*`, `payout_*` | `stripe_onboarding`, `stripe_callback`, `payouts`, профиль (Stripe) | донат, минимумы, ошибки оплаты, подключение Stripe, вывод |
| `chat_*` | `chats` | список чатов, отправка, read receipts, ошибки маршрута |
| `notifications_*` | `notifications` | список, прочитано, push, retry |
| `news_*` | `news` | лента, детали, точка непрочитанного, донат из новости |
| `profile_*` | `profile`, `volunteer_hours_list_page` | редактирование, фото, язык, часы, публичный профиль |
| `deeplink_*` | навигация по ссылкам (роутер + обработчики) | request/news/chat/profile по URL |
| `support_*` | общие troubleshooting, в т.ч. из `support_chat` | что спросить у пользователя, типовые «застрял» |
| `product_*`, `features_*`, `faq_*`, `rewards_*` | продуктовые формулировки (несколько экранов) | ценность приложения, мотивация, верификация, награды |
| `intent_*`, `intent_alias_*` | мета-правила для LLM | уточнение намерения, короткие запросы, смешанные темы |

**Соглашение по `chunk_id`:** `область_конкретика` в snake_case (как уже в файле). Один чанк — один сценарий или одно состояние UI (не смешивать «создание event» и «создание waste» в одном тексте без явной структуры).

**Как обновлять из приложения:** открыть нужный экран/виджет в `joy_pick`, зафиксировать видимые шаги и ограничения → добавить или править пару RU+EN в `docs/knowledge/support_ru/chunks.json` и `support_en/chunks.json` с теми же `chunk_id`. Теги — слова, которыми пользователь может спросить (включая опечатки и англ. синонимы).

**Пробелы для ревью по коду приложения** (при появлении вопросов пользователей): `help/ui_guide_page`, экран `support_chat` в клиенте, таймеры/особые потоки `speed_cleanup_timer_page`, завершение `event_completion_page` / `participant_completion_page` / `cleanup_result_page` — при необходимости вынести в отдельные чанки с префиксом `request_complete_*` или `ui_guide_*`.

