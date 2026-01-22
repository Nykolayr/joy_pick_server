# Instant Payouts (Мгновенные выплаты)

## Обзор

Instant Payouts позволяют волонтерам получать средства на дебетовую карту в течение 30 минут вместо стандартных 2-7 дней.

## Как это работает

### 1. Настройка аккаунта
- При создании Stripe Express Account автоматически настраивается поддержка instant payouts
- По умолчанию установлен режим `daily` выплат с задержкой 2 дня
- Пользователь может изменить расписание через API

### 2. Добавление дебетовой карты
- Пользователь проходит Stripe onboarding и добавляет дебетовую карту
- Поддерживаются Visa и MasterCard (в основном для US)
- Карта должна быть верифицирована Stripe

### 3. Создание мгновенной выплаты
- Через API `POST /api/stripe/instant-payout`
- Средства списываются с Stripe баланса аккаунта
- Комиссия: 1.5% от суммы выплаты
- Минимум: $1.00

## API Endpoints

### Получение методов выплат
```
GET /api/stripe/payout-methods/:user_id
```
Возвращает доступные банковские счета и дебетовые карты.

### Создание мгновенной выплаты
```
POST /api/stripe/instant-payout
{
  "user_id": "uuid",
  "amount": 50.00,
  "external_account_id": "card_xxxxx"
}
```

### Обновление расписания выплат
```
PUT /api/stripe/payout-schedule/:user_id
{
  "interval": "daily|weekly|monthly|manual",
  "delay_days": 2
}
```

### История выплат
```
GET /api/stripe/instant-payouts/:user_id?page=1&limit=20
```

## Webhook Events

Система автоматически обрабатывает следующие события:

- `payout.created` - создание выплаты
- `payout.paid` - успешная выплата
- `payout.failed` - ошибка выплаты

## Push-уведомления

Пользователи получают уведомления о:
- Успешной выплате
- Ошибках выплаты
- Статусе обработки

## База данных

### Таблица `instant_payouts`
```sql
CREATE TABLE instant_payouts (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  stripe_account_id VARCHAR(255) NOT NULL,
  payout_id VARCHAR(255) NOT NULL UNIQUE,
  amount_cents INT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  external_account_id VARCHAR(255) NULL,
  failure_code VARCHAR(100) NULL,
  failure_message TEXT NULL,
  arrival_date TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## Статусы выплат

- `pending` - в очереди на обработку
- `in_transit` - отправлена, ожидает поступления
- `paid` - успешно выплачена
- `failed` - ошибка выплаты
- `canceled` - отменена

## Ограничения

1. **География**: Instant payouts в основном доступны для US дебетовых карт
2. **Лимиты**: Зависят от карты и истории аккаунта
3. **Комиссия**: 1.5% от суммы выплаты
4. **Время**: Обычно 30 минут, но может быть до 24 часов

## Настройка для дебетовых карт

При создании Express Account автоматически настраивается:
- `capabilities.transfers: requested`
- `settings.payouts.schedule.interval: daily`

Пользователь добавляет дебетовую карту через Stripe Dashboard или Connect Onboarding.

## Мониторинг

- Все instant payouts логируются в БД
- Webhook события обновляют статусы
- Push-уведомления информируют пользователей
- Admin API позволяет отслеживать выплаты

## Troubleshooting

### Частые ошибки:
- `insufficient_funds` - недостаточно средств на балансе
- `debit_not_authorized` - карта не поддерживает instant payouts
- `invalid_card` - проблемы с картой

### Решения:
1. Проверить баланс Stripe аккаунта
2. Убедиться, что карта поддерживает instant payouts
3. Попробовать стандартную выплату вместо мгновенной