# Stripe Admin API - Документация

## 🔐 Авторизация

**ВАЖНО:** Все endpoints требуют:
1. Аутентификации (Bearer token)
2. Прав суперадминистратора (`isSuperAdmin: true`)

**Базовый URL:** `/api/stripe-admin`

---

## 📋 Содержание

1. [PaymentIntents (Платежи)](#paymentintents-платежи)
2. [Transfers (Переводы волонтёрам)](#transfers-переводы-волонтёрам)
3. [Accounts (Stripe Express аккаунты)](#accounts-stripe-express-аккаунты)
4. [Charges (Транзакции)](#charges-транзакции)
5. [Balance Transactions (Транзакции баланса)](#balance-transactions-транзакции-баланса)
6. [Refunds (Возвраты)](#refunds-возвраты)
7. [Summary (Общая статистика)](#summary-общая-статистика)

---

## 💳 PaymentIntents (Платежи)

### GET `/api/stripe-admin/payment-intents`

Получение списка PaymentIntent с детальной информацией из Stripe.

**Query параметры:**
- `request_id` (string, optional) - фильтр по заявке
- `user_id` (string, optional) - фильтр по пользователю
- `type` (string, optional) - тип: `donation` или `request_payment`
- `status` (string, optional) - статус: `requires_capture`, `succeeded`, `canceled`, etc.
- `limit` (number, optional) - количество (по умолчанию 10, максимум 100)

**Пример запроса:**
```http
GET /api/stripe-admin/payment-intents?type=donation&status=succeeded&limit=20
Authorization: Bearer {token}
```

**Пример ответа:**
```json
{
  "success": true,
  "data": {
    "payment_intents": [
      {
        "id": "uuid-from-db",
        "payment_intent_id": "pi_xxxxx",
        "user_id": "user-uuid",
        "request_id": "request-uuid",
        "amount_cents": 1000,
        "currency": "usd",
        "status": "succeeded",
        "type": "donation",
        "stripe_data": {
          "id": "pi_xxxxx",
          "amount": 1000,
          "currency": "usd",
          "status": "succeeded",
          "created": 1234567890,
          "payment_method": "pm_xxxxx",
          "payment_method_types": ["card"],
          "capture_method": "manual",
          "amount_capturable": 0,
          "amount_received": 1000,
          "charges": [
            {
              "id": "ch_xxxxx",
              "amount": 1000,
              "status": "succeeded",
              "payment_method_details": {
                "card": {
                  "brand": "visa",
                  "last4": "4242",
                  "exp_month": 12,
                  "exp_year": 2025,
                  "country": "US"
                }
              },
              "billing_details": {
                "name": "John Doe",
                "email": "john@example.com"
              },
              "receipt_url": "https://pay.stripe.com/receipts/...",
              "balance_transaction": "txn_xxxxx"
            }
          ]
        }
      }
    ],
    "total": 1
  }
}
```

### GET `/api/stripe-admin/payment-intents/:payment_intent_id`

Получение детальной информации о конкретном PaymentIntent.

**Пример запроса:**
```http
GET /api/stripe-admin/payment-intents/pi_xxxxx
Authorization: Bearer {token}
```

**Пример ответа:**
```json
{
  "success": true,
  "data": {
    "db_data": {
      "id": "uuid-from-db",
      "payment_intent_id": "pi_xxxxx",
      "user_id": "user-uuid",
      "request_id": "request-uuid",
      "amount_cents": 1000,
      "currency": "usd",
      "status": "succeeded",
      "type": "donation"
    },
    "stripe_data": {
      "id": "pi_xxxxx",
      "amount": 1000,
      "currency": "usd",
      "status": "succeeded",
      "created": 1234567890,
      "payment_method": "pm_xxxxx",
      "charges": [...],
      "metadata": {
        "request_id": "request-uuid",
        "user_id": "user-uuid",
        "type": "donation"
      }
    },
    "related_data": {
      "request": {
        "id": "request-uuid",
        "name": "Cleanup request",
        "category": "wasteLocation",
        "cost": 10.00,
        "status": "new"
      },
      "user": {
        "id": "user-uuid",
        "email": "user@example.com",
        "display_name": "John Doe"
      }
    }
  }
}
```

---

## 💸 Transfers (Переводы волонтёрам)

### GET `/api/stripe-admin/transfers`

Получение списка Transfers с детальной информацией.

**Query параметры:**
- `request_id` (string, optional) - фильтр по заявке
- `performer_user_id` (string, optional) - фильтр по исполнителю
- `status` (string, optional) - статус: `pending`, `paid`, `failed`, `canceled`
- `limit` (number, optional) - количество (по умолчанию 10, максимум 100)

**Пример запроса:**
```http
GET /api/stripe-admin/transfers?status=paid&limit=50
Authorization: Bearer {token}
```

**Пример ответа:**
```json
{
  "success": true,
  "data": {
    "transfers": [
      {
        "id": "uuid-from-db",
        "transfer_id": "tr_xxxxx",
        "request_id": "request-uuid",
        "performer_user_id": "user-uuid",
        "amount_cents": 8500,
        "platform_fee_cents": 700,
        "stripe_fee_cents": 1093,
        "currency": "usd",
        "status": "paid",
        "stripe_data": {
          "id": "tr_xxxxx",
          "amount": 8500,
          "currency": "usd",
          "status": "paid",
          "created": 1234567890,
          "destination": "acct_xxxxx",
          "destination_payment": "py_xxxxx",
          "source_transaction": "ch_xxxxx"
        },
        "related_data": {
          "performer": {
            "id": "user-uuid",
            "email": "performer@example.com",
            "display_name": "Jane Doe"
          },
          "destination_account": {
            "id": "acct_xxxxx",
            "type": "express",
            "country": "US",
            "charges_enabled": true,
            "payouts_enabled": true,
            "email": "performer@example.com"
          }
        }
      }
    ],
    "total": 1
  }
}
```

### GET `/api/stripe-admin/transfers/:transfer_id`

Получение детальной информации о Transfer.

**Пример запроса:**
```http
GET /api/stripe-admin/transfers/tr_xxxxx
Authorization: Bearer {token}
```

---

## 👤 Accounts (Stripe Express аккаунты)

### GET `/api/stripe-admin/accounts`

Получение списка Stripe Express аккаунтов.

**Query параметры:**
- `user_id` (string, optional) - фильтр по пользователю
- `charges_enabled` (boolean, optional) - может принимать платежи
- `payouts_enabled` (boolean, optional) - может получать выплаты
- `limit` (number, optional) - количество (по умолчанию 10, максимум 100)

**Пример запроса:**
```http
GET /api/stripe-admin/accounts?payouts_enabled=true&limit=20
Authorization: Bearer {token}
```

**Пример ответа:**
```json
{
  "success": true,
  "data": {
    "accounts": [
      {
        "id": "uuid-from-db",
        "account_id": "acct_xxxxx",
        "user_id": "user-uuid",
        "charges_enabled": true,
        "payouts_enabled": true,
        "details_submitted": true,
        "stripe_data": {
          "id": "acct_xxxxx",
          "type": "express",
          "country": "US",
          "default_currency": "usd",
          "created": 1234567890,
          "charges_enabled": true,
          "payouts_enabled": true,
          "details_submitted": true,
          "email": "user@example.com",
          "business_profile": {
            "url": "https://joyvee.live/profile/user-uuid",
            "mcc": "8398"
          },
          "individual": {
            "first_name": "John",
            "last_name": "Doe",
            "email": "user@example.com",
            "phone": "+1234567890"
          },
          "requirements": {
            "currently_due": [],
            "eventually_due": []
          },
          "capabilities": {
            "card_payments": "active",
            "transfers": "active"
          }
        },
        "related_data": {
          "user": {
            "id": "user-uuid",
            "email": "user@example.com",
            "display_name": "John Doe"
          }
        }
      }
    ],
    "total": 1
  }
}
```

### GET `/api/stripe-admin/accounts/:account_id`

Получение детальной информации о Stripe аккаунте.

**Пример запроса:**
```http
GET /api/stripe-admin/accounts/acct_xxxxx
Authorization: Bearer {token}
```

---

## 💰 Charges (Транзакции)

### GET `/api/stripe-admin/charges`

Получение списка Charges (транзакций).

**Query параметры:**
- `payment_intent_id` (string, optional) - фильтр по PaymentIntent
- `limit` (number, optional) - количество (по умолчанию 10, максимум 100)

**Пример запроса:**
```http
GET /api/stripe-admin/charges?payment_intent_id=pi_xxxxx
Authorization: Bearer {token}
```

**Пример ответа:**
```json
{
  "success": true,
  "data": {
    "charges": [
      {
        "stripe_data": {
          "id": "ch_xxxxx",
          "amount": 1000,
          "currency": "usd",
          "status": "succeeded",
          "created": 1234567890,
          "payment_intent": "pi_xxxxx",
          "payment_method": "pm_xxxxx",
          "payment_method_details": {
            "card": {
              "brand": "visa",
              "last4": "4242",
              "exp_month": 12,
              "exp_year": 2025
            }
          },
          "billing_details": {
            "name": "John Doe",
            "email": "john@example.com"
          },
          "receipt_url": "https://pay.stripe.com/receipts/...",
          "balance_transaction": "txn_xxxxx"
        },
        "related_data": {
          "payment_intent": {
            "id": "uuid-from-db",
            "payment_intent_id": "pi_xxxxx",
            "user_id": "user-uuid",
            "request_id": "request-uuid",
            "type": "donation"
          },
          "user": {
            "id": "user-uuid",
            "email": "user@example.com",
            "display_name": "John Doe"
          }
        }
      }
    ],
    "total": 1
  }
}
```

### GET `/api/stripe-admin/charges/:charge_id`

Получение детальной информации о Charge.

**Пример запроса:**
```http
GET /api/stripe-admin/charges/ch_xxxxx
Authorization: Bearer {token}
```

---

## 📈 Balance Transactions (Транзакции баланса)

### GET `/api/stripe-admin/balance-transactions`

Получение списка Balance Transactions с информацией о комиссиях.

**Query параметры:**
- `payment_intent_id` (string, optional) - фильтр по PaymentIntent (через charge)
- `type` (string, optional) - тип: `charge`, `payment`, `payout`, `refund`, etc.
- `limit` (number, optional) - количество (по умолчанию 10, максимум 100)

**Пример запроса:**
```http
GET /api/stripe-admin/balance-transactions?type=charge&limit=20
Authorization: Bearer {token}
```

**Пример ответа:**
```json
{
  "success": true,
  "data": {
    "balance_transactions": [
      {
        "stripe_data": {
          "id": "txn_xxxxx",
          "amount": 1000,
          "currency": "usd",
          "fee": 109,
          "net": 891,
          "status": "available",
          "type": "charge",
          "created": 1234567890,
          "available_on": 1234567890,
          "fee_details": [
            {
              "amount": 109,
              "type": "stripe_fee",
              "description": "Stripe processing fee"
            }
          ],
          "source": "ch_xxxxx"
        },
        "related_data": {
          "payment_intent": {
            "id": "uuid-from-db",
            "payment_intent_id": "pi_xxxxx",
            "user_id": "user-uuid",
            "request_id": "request-uuid"
          },
          "user": {
            "id": "user-uuid",
            "email": "user@example.com",
            "display_name": "John Doe"
          },
          "request": {
            "id": "request-uuid",
            "name": "Cleanup request",
            "category": "wasteLocation"
          }
        }
      }
    ],
    "total": 1
  }
}
```

### GET `/api/stripe-admin/balance-transactions/:transaction_id`

Получение детальной информации о Balance Transaction.

**Пример запроса:**
```http
GET /api/stripe-admin/balance-transactions/txn_xxxxx
Authorization: Bearer {token}
```

---

## 🔄 Refunds (Возвраты)

### GET `/api/stripe-admin/refunds`

Получение списка Refunds (возвратов).

**Query параметры:**
- `payment_intent_id` (string, optional) - фильтр по PaymentIntent
- `limit` (number, optional) - количество (по умолчанию 10, максимум 100)

**Пример запроса:**
```http
GET /api/stripe-admin/refunds?payment_intent_id=pi_xxxxx
Authorization: Bearer {token}
```

**Пример ответа:**
```json
{
  "success": true,
  "data": {
    "refunds": [
      {
        "stripe_data": {
          "id": "re_xxxxx",
          "amount": 1000,
          "currency": "usd",
          "status": "succeeded",
          "created": 1234567890,
          "charge": "ch_xxxxx",
          "payment_intent": "pi_xxxxx",
          "reason": "requested_by_customer",
          "receipt_number": "refund_xxxxx",
          "balance_transaction": "txn_xxxxx"
        },
        "related_data": {
          "payment_intent": {
            "id": "uuid-from-db",
            "payment_intent_id": "pi_xxxxx",
            "user_id": "user-uuid",
            "request_id": "request-uuid"
          },
          "user": {
            "id": "user-uuid",
            "email": "user@example.com",
            "display_name": "John Doe"
          },
          "request": {
            "id": "request-uuid",
            "name": "Cleanup request",
            "category": "wasteLocation"
          }
        }
      }
    ],
    "total": 1
  }
}
```

---

## 📊 Summary (Общая статистика)

### GET `/api/stripe-admin/summary`

Получение общей статистики по Stripe.

**Пример запроса:**
```http
GET /api/stripe-admin/summary
Authorization: Bearer {token}
```

**Пример ответа:**
```json
{
  "success": true,
  "data": {
    "payment_intents": {
      "total": 150,
      "succeeded": 120,
      "pending_capture": 5,
      "canceled": 25,
      "donations": 80,
      "request_payments": 70
    },
    "transfers": {
      "total": 50,
      "paid": 45,
      "pending": 3,
      "failed": 2
    },
    "accounts": {
      "total": 30,
      "fully_enabled": 25,
      "charges_enabled_count": 28,
      "payouts_enabled_count": 26
    },
    "balance": {
      "available": [
        {
          "amount": 50000,
          "currency": "usd"
        }
      ],
      "pending": [
        {
          "amount": 5000,
          "currency": "usd"
        }
      ]
    }
  }
}
```

---

## ⚠️ Обработка ошибок

Все endpoints возвращают ошибки в едином формате:

```json
{
  "success": false,
  "message": "Описание ошибки",
  "timestamp": "2026-01-10T12:00:00.000Z",
  "error": "Детали ошибки",
  "errorName": "Error",
  "errorCode": "ERROR_CODE",
  "errorDetails": {
    "message": "Детали ошибки",
    "name": "Error",
    "code": "ERROR_CODE"
  }
}
```

**Коды ошибок:**
- `401` - Не авторизован
- `403` - Доступ запрещен (не суперадмин)
- `404` - Ресурс не найден
- `500` - Внутренняя ошибка сервера

---

## 🔗 Связанные данные

Все endpoints возвращают связанные данные из БД:
- **PaymentIntents** → связанные `request` и `user`
- **Transfers** → связанные `request`, `performer` (user), `destination_account`
- **Accounts** → связанный `user`
- **Charges** → связанные `payment_intent`, `user`, `request`
- **Balance Transactions** → связанные `payment_intent`, `user`, `request`
- **Refunds** → связанные `payment_intent`, `user`, `request`

---

## 📝 Примечания

1. Все суммы в Stripe API возвращаются в **центах** (целые числа)
2. Все суммы в БД хранятся в **долларах** (decimal)
3. Endpoints автоматически объединяют данные из БД и Stripe API
4. При ошибке получения данных из Stripe, endpoint возвращает данные из БД с полем `stripe_error`
5. Все запросы требуют прав суперадминистратора

---

## 🔐 Безопасность

- Все endpoints защищены middleware `requireSuperAdmin`
- Только пользователи с `super_admin = 1` могут получать доступ
- JWT токен должен содержать `isSuperAdmin: true`
- Все ошибки возвращаются в JSON формате (не логируются в файлы)
