# План проверки Support AI (чанки + ответ)

## Цель

По очереди задавать типовые вопросы через **`POST /api/support/eval-reply`**, сверять **`sources`** (ожидаемые `chunk_id`) и отсутствие запрещённых формулировок в **`answer`**. При сбое — правка `chunks.json` / промпта в `supportAiService.js`. Если из чанков нельзя однозначно ответить — **остановиться и спросить продукт**.

## Как гонять

- **Прод:** в `.env` локально задать `SUPPORT_EVAL_SECRET` (как на сервере) и `SUPPORT_EVAL_BASE_URL=https://joypick.world/api`, затем `npm run support:eval`.
- **Только RAG (без LLM):** `npm run support:eval:rag` — проверка, что нужные чанки попадают в top‑K.
- **Stress RAG (много формулировок):** `npm run support:eval:rag:stress` или `node scripts/run_support_rag_stress.js --locale=ru --per-chunk=6 --limit=2000 --seed=1` — вопросы собираются из `title`/`tags` чанков, для каждого проверяется, что **свой** `chunk_id` в top‑K. Отчёт: `tmp/rag_stress_last.json` (падения с `message`, `top`, `effectiveQuestion`). При падениях exit code 1.
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
| ☑ | profile_language_ru | Язык / локализация в профиле |
| ☑ | profile_photo_ru | Фото профиля / аватар |
| ☑ | payout_tabs_ru | Вкладки Available / History на выплатах |
| ☑ | news_pulse_ru | Точка непрочитанных на News |
| ☑ | deeplink_request_missing_ru | Ссылка на заявку → «не найдена» |
| ☑ | waste_create_ru | Создание waste / уборка мусора |
| ☑ | speed_photo_ru | Фото до/после в speed cleanup |
| ☑ | profile_language_en | Change app language (EN) |
| ☑ | payout_minimum_en | Минимум instant payout (EN) |
| ☑ | news_donate_en | Донат из новости (EN) |
| ☑ | notifications_list_ru | Список уведомлений |
| ☑ | notifications_mark_all_ru | Отметить все уведомления прочитанными |
| ☑ | profile_public_ru | Публичный профиль по ссылке / user id |
| ☑ | join_request_ru | Join к waste/speed (не event) |
| ☑ | deeplink_news_ru | Deeplink на новость |
| ☑ | read_receipt_ru | Галочки прочтения в чате |
| ☑ | request_not_visible_ru | Заявка не видна в списке |
| ☑ | rewards_cleanup_ru | Награды за уборки (коины, часы) |
| ☑ | volunteer_money_ru | Деньги волонтёру (донаты, выплаты) |
| ☑ | faq_polluted_ru | Отметить загрязнение без статуса волонтёра |
| ☑ | notifications_list_en | In-app notifications (EN) |
| ☑ | join_request_en | Join waste/speed request (EN) |
| ☑ | map_search_ru | Поиск и фильтры на карте |
| ☑ | donation_payment_failed_ru | Ошибка оплаты доната |
| ☑ | stripe_executor_ru | Stripe для исполнителя |
| ☑ | auth_login_ru | Вход email / пароль |
| ☑ | participant_complete_ru | Завершение участником |
| ☑ | moderation_verification_ru | Верификация уборки (гео, фото, модератор) |
| ☑ | volunteer_hours_typo_ru | «Чамы» / волонтёрские часы |
| ☑ | status_approved_ru | Статус Approved |
| ☑ | chat_empty_ru | Пустое сообщение в чате |
| ☑ | deeplink_chat_ru | Deeplink на чат `/chat/` |
| ☑ | profile_edit_ru | Редактирование полей профиля |
| ☑ | map_search_en | Map search / filters (EN) |
| ☑ | donation_failed_en | Donation payment failed (EN) |
| ☑ | status_approved_en | Approved status (EN) |

Последний прогон: **`npm run support:eval:rag`** и **`npm run support:eval`** на **joypick.world** — **53/53 OK** (выкат `supportAiService.js` + `chunks.json` RU/EN).
