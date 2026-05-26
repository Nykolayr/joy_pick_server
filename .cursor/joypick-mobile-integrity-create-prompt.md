# Промпт: joy_pick — integrity при создании заявки

Скопируй в чат агента репозитория **joy_pick**.

---

## Контракт с бэкендом

`POST /api/requests` (multipart):

| Поле | Когда |
|------|--------|
| **`integrity_enforce`** = `true` или `1` | Всегда в релизе с поддержкой 422 (новые сборки) |
| **`locale`** | Как в support (`ru`, `en`, …) |
| **`description`** | Обязательно, если шлёте `integrity_enforce` |

**Старые сборки в сторах** поле **не** отправляют — сервер создаёт заявку как раньше.

## Ответ 422

- `errorCode: "INTEGRITY_CHECK_FAILED"`
- `data.integrity.issues[]` — `field`, `message_key`, `message`
- Заявку **не** считать созданной

UI: подсветка полей (`name`, `description`, `photos_before`, `location`), ARB по `message_key`, fallback `message`.

Ключи ARB: `integrity_missing_name`, `integrity_missing_description`, `integrity_gibberish_name`, `integrity_gibberish_description`, `integrity_missing_coords`, `integrity_geo_not_land`, `integrity_missing_photos_before`, `integrity_indoor_photo`, `integrity_check_failed_title`.

## Пример

```dart
request.fields['integrity_enforce'] = 'true';
request.fields['locale'] = currentLocale;
```

Дока: `joy_pick_server/API_DOCUMENTATION.md` — «Проверка integrity при создании».

Закрытие заявки: см. **`joypick-mobile-integrity-close-prompt.md`**.

---
