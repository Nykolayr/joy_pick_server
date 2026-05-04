# План проверки Support AI (чанки + ответ)

## Цель

По очереди задавать типовые вопросы через **`POST /api/support/eval-reply`**, сверять **`sources`** (ожидаемые `chunk_id`) и отсутствие запрещённых формулировок в **`answer`**. При сбое — правка `chunks.json` / промпта в `supportAiService.js`. Если из чанков нельзя однозначно ответить — **остановиться и спросить продукт**.

## Как гонять

- **Прод:** в `.env` локально задать `SUPPORT_EVAL_SECRET` (как на сервере) и `SUPPORT_EVAL_BASE_URL=https://joypick.world/api`, затем `npm run support:eval`.
- **Только RAG (без LLM):** `npm run support:eval:rag` — проверка, что нужные чанки попадают в top‑K.
- **Без HTTP:** `npm run support:eval:direct` (нужны ключи AI в `.env`).

Источник кейсов: **`scripts/support_eval_cases.json`** (поля `id`, `message`, `locale`, `sourcesMustIncludeAny`, `answerMustNotContain`).

## Чек-лист по `id` (обновляйте статус вручную при ревью)

| Статус | id | Тема |
|--------|-----|------|
| ☑ | donate_send_ru | Донат по чужой заявке |
| ☑ | what_requests_ru | Какие заявки / как смотреть |
| ☑ | hold_refund_ru | Холд / возврат донатеру |
| ☑ | map_paid_marker_ru | Маркеры денег на карте |
| ☑ | share_link_ru | Шаринг ссылки на заявку |
| ☑ | stripe_profile_ru | Stripe в профиле |
| ☑ | event_split_en | Event + несколько участников (EN) |
| ☑ | create_event_ru | Создание заявки «событие» |
| ☑ | donation_min_ru | Минимум доната |
| ☑ | unjoin_ru | Выйти из заявки |
| ☑ | pending_status_ru | Статус «на проверке» |
| ☑ | password_reset_ru | Восстановление пароля |
| ☑ | location_off_ru | Геолокация выключена |
| ☑ | join_event_ru | Присоединиться к событию |
| ☑ | too_far_cleanup_ru | Слишком далеко от точки уборки |
| ☑ | push_missing_ru | Не приходят push |
| ☑ | chat_request_ru | Сообщение в чате заявки |

Последний автоматический прогон `npm run support:eval` на **joypick.world** (ответы + `sources` + запретные фразы): **17/17 OK** после выката `supportAiService.js` и `chunks.json` RU/EN.
