# Информация, доступная из Stripe

## 📊 Обзор

Stripe предоставляет обширную информацию через API. Ниже описано, что можно получить для каждого типа объекта.

---

## 💳 PaymentIntent (Платежи)

### Что можно получить через API:

```javascript
const paymentIntent = await stripe.paymentIntents.retrieve('pi_xxxxx');
```

**Доступная информация:**

1. **Базовая информация:**
   - `id` - ID PaymentIntent (pi_xxxxx)
   - `amount` - сумма в центах
   - `currency` - валюта (usd)
   - `status` - статус (requires_payment_method, requires_confirmation, requires_action, processing, requires_capture, succeeded, canceled)
   - `client_secret` - секрет для фронтенда
   - `created` - timestamp создания

2. **Информация о платеже:**
   - `payment_method` - ID метода оплаты (pm_xxxxx)
   - `payment_method_types` - типы методов оплаты (['card'])
   - `capture_method` - метод захвата (manual/automatic)
   - `confirmation_method` - метод подтверждения

3. **Информация о карте/плательщике:**
   - `charges.data[0].payment_method_details.card` - данные карты:
     - `brand` - бренд карты (visa, mastercard, etc.)
     - `last4` - последние 4 цифры
     - `exp_month`, `exp_year` - срок действия
     - `country` - страна карты
   - `charges.data[0].billing_details` - данные плательщика:
     - `name` - имя
     - `email` - email
     - `phone` - телефон
     - `address` - адрес

4. **Метаданные:**
   - `metadata` - ваши кастомные данные:
     - `request_id` - ID заявки
     - `user_id` - ID пользователя
     - `request_category` - категория заявки
     - `type` - тип (donation/request_payment)

5. **Информация о холде:**
   - `amount_capturable` - сумма, которую можно захватить
   - `amount_received` - сумма, которая уже получена
   - `canceled_at` - дата отмены (если отменен)

### Что уже хранится в БД (таблица `payment_intents`):
- `payment_intent_id` - ID из Stripe
- `user_id` - ID пользователя
- `request_id` - ID заявки
- `amount_cents` - сумма в центах
- `currency` - валюта
- `status` - статус
- `type` - тип (donation/request_payment)
- `metadata` - JSON с метаданными

---

## 💸 Transfers (Переводы волонтёрам)

### Что можно получить через API:

```javascript
const transfer = await stripe.transfers.retrieve('tr_xxxxx');
```

**Доступная информация:**

1. **Базовая информация:**
   - `id` - ID transfer (tr_xxxxx)
   - `amount` - сумма в центах
   - `currency` - валюта
   - `status` - статус (pending, paid, failed, canceled)
   - `created` - timestamp создания

2. **Информация о получателе:**
   - `destination` - ID Stripe аккаунта получателя (acct_xxxxx)
   - `destination_payment` - ID платежа на аккаунте получателя

3. **Информация об источнике:**
   - `source_transaction` - ID транзакции-источника
   - `source_type` - тип источника (card, bank_account, etc.)

4. **Комиссии:**
   - `reversals` - информация об отменах/возвратах
   - Можно получить баланс аккаунта через `stripe.balance.retrieve()`

5. **Метаданные:**
   - `metadata` - ваши кастомные данные:
     - `request_id` - ID заявки
     - `performer_user_id` - ID исполнителя

### Что уже хранится в БД (таблица `transfers`):
- `transfer_id` - ID из Stripe
- `request_id` - ID заявки
- `performer_user_id` - ID исполнителя
- `amount_cents` - сумма в центах
- `platform_fee_cents` - комиссия платформы
- `stripe_fee_cents` - комиссия Stripe
- `currency` - валюта
- `status` - статус
- `source_payment_intent_id` - ID исходного PaymentIntent

---

## 👤 Accounts (Stripe Express аккаунты волонтёров)

### Что можно получить через API:

```javascript
const account = await stripe.accounts.retrieve('acct_xxxxx');
```

**Доступная информация:**

1. **Базовая информация:**
   - `id` - ID аккаунта (acct_xxxxx)
   - `type` - тип аккаунта (express)
   - `country` - страна
   - `default_currency` - валюта по умолчанию
   - `created` - timestamp создания

2. **Статус аккаунта:**
   - `charges_enabled` - может ли принимать платежи
   - `payouts_enabled` - может ли получать выплаты
   - `details_submitted` - заполнены ли все данные
   - `email` - email аккаунта

3. **Информация о бизнесе:**
   - `business_profile` - профиль бизнеса:
     - `name` - название
     - `url` - сайт
     - `mcc` - код категории бизнеса
   - `business_type` - тип бизнеса (individual/company)

4. **Информация о владельце:**
   - `individual` - данные физического лица:
     - `first_name`, `last_name` - имя, фамилия
     - `email`, `phone` - контакты
     - `dob` - дата рождения
     - `address` - адрес
     - `id_number` - ID номер (SSN для US)
   - `company` - данные компании (если business_type = company)

5. **Финансовая информация:**
   - `external_accounts` - банковские счета для выплат
   - `requirements` - требования для активации аккаунта
   - `capabilities` - возможности аккаунта

### Что уже хранится в БД (таблица `stripe_accounts`):
- `account_id` - ID из Stripe
- `user_id` - ID пользователя
- `charges_enabled` - может принимать платежи
- `payouts_enabled` - может получать выплаты
- `details_submitted` - заполнены данные

---

## 💰 Charges (Транзакции)

### Что можно получить через API:

```javascript
const charge = await stripe.charges.retrieve('ch_xxxxx');
// Или через PaymentIntent:
const paymentIntent = await stripe.paymentIntents.retrieve('pi_xxxxx');
const charge = paymentIntent.charges.data[0];
```

**Доступная информация:**

1. **Базовая информация:**
   - `id` - ID charge (ch_xxxxx)
   - `amount` - сумма в центах
   - `currency` - валюта
   - `status` - статус (succeeded, pending, failed)
   - `created` - timestamp создания

2. **Информация о платеже:**
   - `payment_method` - ID метода оплаты
   - `payment_method_details` - детали метода оплаты
   - `receipt_url` - URL чека
   - `receipt_email` - email для отправки чека

3. **Информация о карте:**
   - `payment_method_details.card` - данные карты (как в PaymentIntent)

4. **Информация о комиссиях:**
   - `balance_transaction` - ID транзакции баланса
   - Можно получить через `stripe.balanceTransactions.retrieve()`

---

## 📈 Balance Transactions (Транзакции баланса)

### Что можно получить через API:

```javascript
const balanceTransaction = await stripe.balanceTransactions.retrieve('txn_xxxxx');
```

**Доступная информация:**

1. **Базовая информация:**
   - `id` - ID транзакции (txn_xxxxx)
   - `amount` - сумма в центах
   - `currency` - валюта
   - `type` - тип (charge, payment, payout, refund, etc.)
   - `created` - timestamp создания

2. **Информация о комиссиях:**
   - `fee` - комиссия Stripe в центах
   - `fee_details` - детали комиссии:
     - `amount` - сумма комиссии
     - `type` - тип комиссии (application_fee, stripe_fee)
     - `description` - описание

3. **Информация о балансе:**
   - `net` - чистая сумма (amount - fee)
   - `status` - статус (available, pending)

---

## 🔔 Webhooks (События)

### Какие события можно получать:

1. **PaymentIntent события:**
   - `payment_intent.created` - создан
   - `payment_intent.succeeded` - успешно оплачен
   - `payment_intent.payment_failed` - платеж не прошел
   - `payment_intent.canceled` - отменен
   - `payment_intent.amount_capturable_updated` - обновлен холд

2. **Transfer события:**
   - `transfer.created` - создан
   - `transfer.paid` - выплачен
   - `transfer.failed` - не удался
   - `transfer.canceled` - отменен

3. **Account события:**
   - `account.updated` - аккаунт обновлен
   - `account.application.deauthorized` - приложение отключено

4. **Charge события:**
   - `charge.succeeded` - успешно
   - `charge.failed` - не удался
   - `charge.refunded` - возвращен

### Что уже обрабатывается в коде:

В `api/routes/stripe.js` обрабатываются:
- `payment_intent.succeeded` - обновляет статус в БД
- `account.updated` - обновляет статус аккаунта в БД
- `transfer.created`, `transfer.paid`, `transfer.failed` - обновляют статус transfer в БД

---

## 📋 Списки и фильтрация

### Получение списков:

```javascript
// Все PaymentIntent для заявки
const paymentIntents = await stripe.paymentIntents.list({
  metadata: { request_id: 'uuid-заявки' }
});

// Все Transfers для аккаунта
const transfers = await stripe.transfers.list({
  destination: 'acct_xxxxx'
});

// Все Charges для PaymentIntent
const charges = await stripe.charges.list({
  payment_intent: 'pi_xxxxx'
});

// Баланс аккаунта
const balance = await stripe.balance.retrieve({
  stripeAccount: 'acct_xxxxx' // для Connect аккаунта
});
```

---

## 🎯 Практические примеры использования

### 1. Узнать, кто захолдил средства:

```javascript
// Получить PaymentIntent
const paymentIntent = await stripe.paymentIntents.retrieve('pi_xxxxx');

// Из метаданных
const userId = paymentIntent.metadata.user_id;
const requestId = paymentIntent.metadata.request_id;

// Или из БД
const [payment] = await pool.execute(
  'SELECT user_id, request_id FROM payment_intents WHERE payment_intent_id = ?',
  [paymentIntent.id]
);
```

### 2. Узнать, кто должен получить выплату:

```javascript
// Из Transfer
const transfer = await stripe.transfers.retrieve('tr_xxxxx');
const destinationAccountId = transfer.destination; // acct_xxxxx

// Найти пользователя по account_id
const [account] = await pool.execute(
  'SELECT user_id FROM stripe_accounts WHERE account_id = ?',
  [destinationAccountId]
);
const userId = account[0].user_id;
```

### 3. Получить все платежи по заявке:

```javascript
// Из БД (быстрее)
const [payments] = await pool.execute(
  'SELECT * FROM payment_intents WHERE request_id = ?',
  [requestId]
);

// Или из Stripe API
const paymentIntents = await stripe.paymentIntents.list({
  metadata: { request_id: requestId }
});
```

### 4. Получить информацию о карте плательщика:

```javascript
const paymentIntent = await stripe.paymentIntents.retrieve('pi_xxxxx', {
  expand: ['charges.data.payment_method']
});

const card = paymentIntent.charges.data[0]?.payment_method_details?.card;
// card.brand - бренд (visa, mastercard)
// card.last4 - последние 4 цифры
// card.exp_month, card.exp_year - срок действия
```

### 5. Получить комиссии Stripe:

```javascript
const paymentIntent = await stripe.paymentIntents.retrieve('pi_xxxxx');
const chargeId = paymentIntent.charges.data[0]?.id;

if (chargeId) {
  const charge = await stripe.charges.retrieve(chargeId);
  const balanceTransactionId = charge.balance_transaction;
  
  const balanceTransaction = await stripe.balanceTransactions.retrieve(
    balanceTransactionId
  );
  
  const stripeFee = balanceTransaction.fee; // комиссия в центах
  const netAmount = balanceTransaction.net; // чистая сумма
}
```

---

## ⚠️ Важные замечания

1. **Метаданные** - используйте для связи Stripe объектов с вашими данными (request_id, user_id)
2. **Expand параметры** - используйте `expand` для получения связанных объектов без дополнительных запросов
3. **Лимиты API** - Stripe имеет лимиты на количество запросов (обычно 100/сек)
4. **Webhooks** - предпочтительнее использовать webhooks для обновлений, чем polling
5. **Безопасность** - никогда не передавайте `client_secret` на фронтенд после использования

---

## 📚 Полезные ссылки

- [Stripe API Reference](https://stripe.com/docs/api)
- [PaymentIntent API](https://stripe.com/docs/api/payment_intents)
- [Transfer API](https://stripe.com/docs/api/transfers)
- [Account API](https://stripe.com/docs/api/accounts)
- [Webhooks Guide](https://stripe.com/docs/webhooks)
