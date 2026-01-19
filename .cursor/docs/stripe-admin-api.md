# Stripe Admin API

## Обзор

Новые роуты для администрирования заявок с платежами через Stripe.

## Новые эндпоинты

### GET /api/stripe-admin/requests/active
Получает список активных заявок (new, inProgress, pending), которые являются платными или имеют донаты.

### GET /api/stripe-admin/requests/closed  
Получает список закрытых заявок (approved, rejected, completed), которые являются платными или имеют донаты.

## Структура ответа

### Общие поля заявки
- `id` - UUID заявки
- `name` - название заявки
- `category` - категория (wasteLocation, speedCleanup, event)
- `status` - статус заявки
- `cost` - стоимость заявки (если платная)
- `created_at` - дата создания
- `updated_at` - дата обновления

### Информация о платеже создателя (creator_payment)
- `user_id` - UUID создателя
- `email` - email создателя
- `name` - имя создателя
- `amount` - сумма платежа
- `payment_intent_id` - ID PaymentIntent в Stripe
- `stripe_status` - статус в Stripe (requires_capture, succeeded, canceled, refunded)
- `capture_method` - метод захвата (automatic/manual)
- `amount_captured` - захваченная сумма
- `amount_received` - полученная сумма
- `is_captured` - захвачены ли средства (boolean)

### Информация о донатах (donations)
Массив объектов с такой же структурой как у creator_payment для каждого доната.

### Информация о переводах (transfers) - только для закрытых заявок
- `to_user_id` - UUID получателя
- `amount` - сумма перевода
- `transfer_id` - ID перевода в Stripe
- `status` - статус перевода (pending, paid, failed, canceled)
- `created` - дата создания (timestamp)
- `error` - ошибка если есть

### Финансовые поля (только для закрытых заявок)
- `request_balance` - остаток по заявке (total_captured - total_transferred)
- `total_captured` - общая захваченная сумма
- `total_transferred` - общая переведенная сумма

## Статусы Stripe

- `requires_capture` - средства авторизованы, но не захвачены
- `succeeded` - средства захвачены
- `canceled` - отменен
- `refunded` - возвращен

## Использование

Эти эндпоинты требуют суперадминских прав и используются для:
- Мониторинга активных платежей
- Проверки статусов захвата средств
- Анализа финансовых потоков по закрытым заявкам
- Выявления проблем с переводами

## Важные замечания

- Все суммы возвращаются в долларах (не в центах)
- Даты в формате UTC ISO 8601
- При ошибках Stripe поля содержат stripe_error
- Для закрытых заявок рассчитывается остаток средств
