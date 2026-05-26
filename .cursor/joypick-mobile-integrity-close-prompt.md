# Промпт: joy_pick — integrity при закрытии заявки

Скопируй в чат агента **joy_pick**.

---

## Общее

При сдаче на модерацию передавать **`integrity_enforce=true`** (как при создании). Без поля — старые сборки работают без 422.

При **422** `INTEGRITY_CHECK_FAILED` — заявка **не** уходит в `pending`, показать `data.integrity.issues[]` (`field`, `message_key`, `message`). Для event в issues может быть `user_id` / `role` (`creator` | `participant`).

## Endpoints

| Тип | Действие |
|-----|----------|
| **waste** | `POST /api/requests/:id/participant-completion` — multipart: `photos_after`, `completion_latitude`, `completion_longitude`, `work_duration_minutes`, `integrity_enforce`, `locale` |
| **speed** | `PUT /api/requests/:id` — `status=pending` + те же поля + фото before/after на заявке |
| **event (участник)** | `POST …/participant-completion` — как waste (без смены статуса заявки) |
| **event (заказчик)** | `POST …/close-by-creator` — после сдачи всех участников; при необходимости фото/гео заказчика: `photos_after`, `completion_latitude`, `completion_longitude` |

## Правила (сервер)

- Гео исполнителя в **200 м** от координат заявки (`requests.latitude/longitude`).
- Фото «после», не indoor (AI), для speed — не совпадать с «до».
- Мин. время: waste 15 мин, speed 15 мин.

## ARB (добавить)

`integrity_executor_coords_missing`, `integrity_executor_too_far`, `integrity_participant_not_completed` + существующие `integrity_*`.

Дока: `joy_pick_server/API_DOCUMENTATION.md` — «Проверка integrity при закрытии».

---
