# План: мультиязычные статьи (новости) с переводом

## Цель
- При создании статьи передаётся одно поле с текстами (заголовок, описание, текст), разделёнными `[|||]`, и поле языка источника.
- Бэкенд переводит на все 10 языков и сохраняет в БД.
- При выдаче списка/статьи обязателен параметр `locale` — отдаём уже переведённые поля.

## Языки (locales)
`en`, `ru`, `es`, `ar`, `zh`, `hi`, `fr`, `pt`, `he`, `de`. Fallback при ошибке перевода: `en`.

## Библиотека перевода
**google-translate-api-x** — форк с batch-переводом, актуальная поддержка, один запрос на несколько языков/текстов. Установка: `npm install google-translate-api-x`.

---

## 1. Миграция БД

**Файл:** `migrations/021_news_i18n.sql`

- Добавить колонки:
  - `source_lang` VARCHAR(10) NOT NULL DEFAULT 'en' — язык оригинала.
  - `title_i18n` JSON — объект `{ "en": "...", "ru": "...", ... }`.
  - `short_description_i18n` JSON — то же по локалям.
  - `text_i18n` JSON — то же по локалям.
- Перенести существующие данные: для каждой строки заполнить `title_i18n = {"en": title}`, `short_description_i18n = {"en": short_description}`, `text_i18n = {"en": text}`, `source_lang = 'en'`.
- Удалить колонки `title`, `short_description`, `text`.

---

## 2. Сервис перевода

**Файл:** `api/services/translateNews.js` (или `api/utils/translateNews.js`)

- Константа списка локалей: `SUPPORTED_LOCALES = ['en','ru','es','ar','zh','hi','fr','pt','he','de']`.
- Функция `translateToAllLocales(sourceLang, title, shortDescription, text)`:
  - Для `sourceLang` записать оригинальные значения в результат.
  - Для остальных локалей вызывать перевод (google-translate-api-x). Можно переводить по одному полю и языку или батчами, если API позволяет.
  - При ошибке перевода для конкретной локали подставлять значение для `en` (если `sourceLang !== 'en'`, сначала получить перевод в `en` и использовать его как fallback).
  - Собирать по ходу **translation_report**: для каждой локали фиксировать status (ok / fallback / error), при ошибке — message; итоговые массивы errors и warnings.
- Возвращать `{ title_i18n, short_description_i18n, text_i18n, translation_report }` — объекты i18n вида `{ [locale]: string }` и полный отчёт для админки.

---

## 3. Создание статьи (POST /api/news)

- **Тело запроса:**
  - `content` (string) — три блока через разделитель: `Title[|||]Short description[|||]Full text`. Разделитель — строго `[|||]`.
  - `source_lang` (string) — одна из 10 локалей (валидация).
  - `image_url`, `published_at` — как раньше.
- Парсинг: `content.split('[|||]')` → массив из 3 элементов (title, short_description, text). Если элементов не 3 — 400 с понятным сообщением.
- Вызов сервиса перевода → получение `title_i18n`, `short_description_i18n`, `text_i18n` и **translation_report** (см. п. 6.1).
- INSERT в `news`: `id`, `source_lang`, `title_i18n`, `short_description_i18n`, `text_i18n`, `image_url`, `published_at`, `view_count`, `created_at`, `updated_at`. JSON-поля сохранять через `JSON.stringify`.
- Ответ 201: `{ news: created, translation_report }` — всегда включать полный отчёт перевода для админки.

---

## 4. Выдача списка и одной статьи (GET /api/news, GET /api/news/:id)

- Обязательный query-параметр `locale` (или заголовок, но проще query для кэширования и логирования). Допустимые значения — из списка 10 локалей.
- При отсутствии или неверном `locale` — 400 с сообщением, что нужен допустимый `locale`.
- При выборке из БД парсить JSON `title_i18n`, `short_description_i18n`, `text_i18n`.
- Для ответа брать текст по локали: `title = title_i18n[locale] ?? title_i18n['en']`, аналогично `short_description` и `text`. В теле ответа отдавать плоские поля `title`, `short_description`, `text` (уже в выбранном языке), чтобы фронт не менял формат отображения.
- Остальные поля (id, image_url, published_at, view_count, likes_count, is_liked и т.д.) без изменений.

---

## 5. Админка (newsAdmin)

- **POST (создание):** тот же контракт — `content`, `source_lang`, `image_url`, `published_at`; логика как в п.3.
- **GET (список/одна):** при необходимости можно оставить без `locale` и отдавать полный i18n для редактирования, либо тоже требовать `locale` и отдавать плоские поля. Рекомендация: для админки GET с `locale` опционально — если передан, отдаём плоские title/short_description/text для этого locale; если не передан — отдаём title_i18n, short_description_i18n, text_i18n для редактирования.
- **PUT (редактирование):** либо принимаем те же `content` + `source_lang` и заново переводим (перезаписываем все локали), либо принимаем объекты i18n целиком. В первом варианте консистентно с созданием. Предлагаю первый вариант: body с `content`, `source_lang` (и при необходимости image_url, published_at) — пересчёт переводов и UPDATE. В ответе так же возвращать **translation_report** (полный отчёт по переводу).

---

## 6. Валидация и ошибки

- `source_lang`: строго одна из `SUPPORTED_LOCALES`.
- `content`: не пустой, при разборе по `[|||]` ровно 3 части; каждая часть после trim не пустая (или разрешить пустой short_description — уточнить).
- При сбое перевода: логировать, подставлять fallback по `en`, не падать весь запрос.

## 6.1. Полный отчёт для админки при создании/редактировании

При любых проблемах с переводом (или для прозрачности — всегда) в ответе админке возвращать объект **translation_report**:

- **success** (boolean) — все ли локали переведены без ошибок.
- **source_lang** (string) — язык источника.
- **locales** (object) — по каждой локали:
  - **status**: `'ok'` | `'fallback'` | `'error'`
  - **message** (при error/fallback): текст ошибки или причина fallback (например: "Translation failed, used en").
- **errors** (array) — список всех ошибок перевода: `{ locale, field?, message }`.
- **warnings** (array) — предупреждения (например, «перевод не получен для ar, подставлен en»).

Даже если запрос в целом успешен (статья создана/обновлена), в теле ответа всегда включать **translation_report**, чтобы админка могла показать полный отчёт: что переведено, где был fallback, где ошибка.

---

## 7. Документация API

- В `API_DOCUMENTATION.md` описать:
  - новый формат POST /api/news (content, source_lang);
  - обязательный параметр `locale` для GET /api/news и GET /api/news/:id;
  - примеры запросов/ответов и список допустимых locale.

---

## Порядок реализации

1. Миграция 021: добавить колонки, перенести данные, удалить старые колонки.
2. Установить `google-translate-api-x`, реализовать сервис перевода с fallback на `en`.
3. Изменить POST /api/news (и админский POST): приём `content` + `source_lang`, парсинг, перевод, запись i18n.
4. Изменить GET /api/news и GET /api/news/:id: обязательный `locale`, выбор из i18n и отдача плоских title/short_description/text.
5. При необходимости изменить PUT в админке (content + source_lang + пересчёт переводов).
6. Обновить API_DOCUMENTATION.md.

После этого на бэке всё будет «правильно»: одна строка с переводами, выдача по `locale` с готовым текстом.
