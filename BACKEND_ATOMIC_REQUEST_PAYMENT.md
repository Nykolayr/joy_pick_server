# Инструкция для бэкенда: Атомарное создание заявки с платежом

## Проблема

Текущая логика создания заявки с оплатой:
1. Клиент создает заявку через `POST /requests`
2. Клиент создает платеж через `POST /payments/create-request-payment`
3. Если оплата не прошла, клиент удаляет заявку через `DELETE /requests/:id`

**Проблемы:**
- Заявка создается в БД, даже если оплата не пройдет
- Возможны race conditions
- Лишние записи в БД, которые потом удаляются
- Не атомарная операция

## Решение

Создать новый endpoint, который атомарно создает заявку и платеж в одной транзакции.

---

## Новый Endpoint

### POST `/requests/create-with-payment`

**Требует аутентификации:** Да (Bearer token)

**Content-Type:** `multipart/form-data` (для поддержки загрузки фото)

**Описание:**
Создает заявку и PaymentIntent атомарно. Если `require_payment = true` и `amount_cents > 0`, создает заявку со статусом `"pending_payment"` и PaymentIntent. Если оплата не требуется (`require_payment = false` или `amount_cents = 0`), создает заявку со стандартным статусом (`"new"` для wasteLocation, `"inProgress"` для event).

---

## Request Body

### Поля формы (multipart/form-data):

**Все стандартные поля заявки:**
- `category` (string, required) - `"wasteLocation"`, `"event"`, `"speedCleanup"`
- `name` (string, required)
- `description` (string, required)
- `latitude` (number, required)
- `longitude` (number, required)
- `city` (string, required)
- `garbage_size` (number, optional) - для wasteLocation
- `only_foot` (boolean, optional)
- `possible_by_car` (boolean, optional)
- `cost` (number, optional) - сумма в центах
- `waste_types` (array[string], optional) - для wasteLocation
- `start_date` (datetime, optional) - для event
- `end_date` (datetime, optional) - для event
- `plant_tree` (boolean, optional) - для event
- `trash_pickup_only` (boolean, optional) - для wasteLocation
- `photos_before` (file[], optional) - массив файлов фотографий "до"
- `photos_after` (file[], optional) - массив файлов фотографий "после"

**Дополнительные поля для платежа:**
- `require_payment` (boolean, optional, default: `false`) - если `true`, создает платеж
- `amount_cents` (number, optional) - сумма в центах (если не указано, берется из `cost`)
- `request_category` (string, optional) - категория для Stripe metadata (`"waste_location"`, `"event"`, `"speed_cleanup"`)

**Важно:**
- Если `require_payment = true` и `amount_cents > 0` (или `cost > 0`), заявка создается со статусом `"pending_payment"`
- Если `require_payment = false` или `amount_cents = 0`, заявка создается со стандартным статусом
- `amount_cents` приоритетнее чем `cost` для создания платежа
- Если `amount_cents` не указано, используется `cost`

---

## Response

### Успешный ответ (200):

```json
{
  "success": true,
  "message": "Request created successfully",
  "data": {
    "request": {
      "id": "uuid-заявки",
      "category": "wasteLocation",
      "name": "Название заявки",
      "description": "Описание",
      "status": "pending_payment",  // или "new"/"inProgress" если оплата не требуется
      "cost": 1000,
      // ... все остальные поля заявки
    },
    "payment": {
      "payment_intent_id": "pi_xxxxx",
      "client_secret": "pi_xxxxx_secret_xxxxx"
    }
  }
}
```

**Если оплата не требуется** (`require_payment = false` или `amount_cents = 0`):
```json
{
  "success": true,
  "message": "Request created successfully",
  "data": {
    "request": {
      "id": "uuid-заявки",
      "status": "new",  // стандартный статус
      // ... все остальные поля заявки
    },
    "payment": null  // платеж не создан
  }
}
```

### Ошибка (400):

```json
{
  "success": false,
  "message": "Ошибка валидации",
  "errors": [
    {
      "field": "amount_cents",
      "message": "Минимум 50 центов (требование Stripe)"
    }
  ]
}
```

### Ошибка (500):

```json
{
  "success": false,
  "message": "Ошибка создания заявки или платежа"
}
```

---

## Логика на бэкенде

### Шаг 1: Валидация

1. Проверить все обязательные поля заявки (как в `POST /requests`)
2. Если `require_payment = true` или `amount_cents > 0`:
   - Проверить, что `amount_cents >= 50` (минимум Stripe)
   - Если `amount_cents` не указано, использовать `cost`
   - Если оба не указаны, вернуть ошибку

### Шаг 2: Начать транзакцию БД

```javascript
// Пример на Node.js/TypeScript
await db.transaction(async (trx) => {
  // Все операции внутри транзакции
});
```

### Шаг 3: Определить статус заявки

```javascript
let requestStatus;

if (require_payment && amount_cents > 0) {
  requestStatus = 'pending_payment';
} else {
  // Стандартная логика по категории
  if (category === 'wasteLocation' || category === 'speedCleanup') {
    requestStatus = 'new';
  } else if (category === 'event') {
    requestStatus = 'inProgress';
  }
}
```

### Шаг 4: Создать заявку в БД

```javascript
const request = await db('requests').insert({
  id: generateUUID(),
  category: category,
  name: name,
  description: description,
  latitude: latitude,
  longitude: longitude,
  city: city,
  cost: cost || amount_cents || 0,
  status: requestStatus,  // 'pending_payment' или стандартный
  // ... остальные поля
  created_at: new Date(),
  updated_at: new Date(),
}).returning('*');
```

### Шаг 5: Загрузить фото (если есть)

```javascript
if (photos_before && photos_before.length > 0) {
  const photoUrls = await uploadPhotos(photos_before);
  await db('requests').where('id', request.id).update({
    photos_before: photoUrls
  });
}
```

### Шаг 6: Создать PaymentIntent (если требуется)

```javascript
let paymentIntent = null;
let clientSecret = null;

if (require_payment && amount_cents > 0) {
  // Создать PaymentIntent через Stripe API
  const stripePaymentIntent = await stripe.paymentIntents.create({
    amount: amount_cents,
    currency: 'usd',
    payment_method_types: ['card'],
    capture_method: 'manual',  // Холдируем средства
    metadata: {
      request_id: request.id,
      user_id: currentUserId,
      request_category: request_category || category,
      type: 'request_payment'
    }
  });

  paymentIntent = {
    payment_intent_id: stripePaymentIntent.id,
    client_secret: stripePaymentIntent.client_secret
  };

  // Сохранить payment_intent_id в заявке
  await db('requests').where('id', request.id).update({
    payment_intent_id: stripePaymentIntent.id,
    updated_at: new Date()
  });
}
```

### Шаг 7: Зафиксировать транзакцию

```javascript
// Если все успешно, транзакция автоматически зафиксируется
// Если ошибка, транзакция откатится автоматически
```

### Шаг 8: Вернуть ответ

```javascript
return {
  success: true,
  message: 'Request created successfully',
  data: {
    request: request,
    payment: paymentIntent  // null если платеж не создан
  }
};
```

---

## Обработка ошибок

### Если ошибка при создании заявки:
- Транзакция откатывается автоматически
- Вернуть ошибку 500

### Если ошибка при создании PaymentIntent:
- **Вариант 1 (рекомендуется):** Откатить транзакцию, вернуть ошибку
- **Вариант 2:** Создать заявку без платежа, вернуть предупреждение

**Рекомендуется вариант 1** - если платеж обязателен, заявка не должна создаваться без него.

---

## Обновление статуса после оплаты

После успешной оплаты на клиенте, нужно обновить статус заявки:

### Вариант 1: Через webhook Stripe

Добавить обработчик webhook `payment_intent.succeeded`:

```javascript
// В webhook handler для payment_intent.succeeded
if (paymentIntent.metadata.type === 'request_payment') {
  const requestId = paymentIntent.metadata.request_id;
  
  // Обновить статус заявки на стандартный
  await db('requests').where('id', requestId).update({
    status: getDefaultStatusForCategory(category),  // 'new' или 'inProgress'
    updated_at: new Date()
  });
}
```

### Вариант 2: Через отдельный endpoint

**PATCH** `/requests/:id/confirm-payment`

```json
{
  "payment_intent_id": "pi_xxxxx"
}
```

**Логика:**
1. Проверить, что заявка существует и имеет статус `"pending_payment"`
2. Проверить, что `payment_intent_id` совпадает
3. Проверить статус PaymentIntent в Stripe (должен быть `succeeded`)
4. Обновить статус заявки на стандартный

---

## Очистка неоплаченных заявок

Добавить cron job или scheduled task для очистки заявок со статусом `"pending_payment"`, которые не были оплачены в течение 24 часов:

```javascript
// Пример cron job (каждые 6 часов)
async function cleanupUnpaidRequests() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const unpaidRequests = await db('requests')
    .where('status', 'pending_payment')
    .where('created_at', '<', twentyFourHoursAgo);
  
  for (const request of unpaidRequests) {
    // Проверить статус PaymentIntent в Stripe
    if (request.payment_intent_id) {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        request.payment_intent_id
      );
      
      // Если платеж не прошел, удалить заявку
      if (paymentIntent.status !== 'succeeded') {
        await db('requests').where('id', request.id).delete();
        // Также можно отменить PaymentIntent в Stripe
        await stripe.paymentIntents.cancel(request.payment_intent_id);
      }
    }
  }
}
```

---

## Миграция существующего кода

После реализации нового endpoint, можно:

1. **Оставить старые endpoints** (`POST /requests` и `POST /payments/create-request-payment`) для обратной совместимости
2. **Постепенно мигрировать** клиент на новый endpoint
3. **Добавить deprecation warning** в старые endpoints (через год можно будет удалить)

---

## Тестирование

### Тест 1: Создание заявки с оплатой
```bash
POST /requests/create-with-payment
{
  "category": "wasteLocation",
  "name": "Test",
  "description": "Test",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Moscow",
  "require_payment": true,
  "amount_cents": 1000
}

# Ожидаемый результат:
# - Заявка создана со статусом "pending_payment"
# - PaymentIntent создан в Stripe
# - Возвращен client_secret
```

### Тест 2: Создание заявки без оплаты
```bash
POST /requests/create-with-payment
{
  "category": "wasteLocation",
  "name": "Test",
  "description": "Test",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Moscow",
  "require_payment": false
}

# Ожидаемый результат:
# - Заявка создана со статусом "new"
# - PaymentIntent не создан
# - payment: null в ответе
```

### Тест 3: Ошибка при создании PaymentIntent
```bash
POST /requests/create-with-payment
{
  "category": "wasteLocation",
  "name": "Test",
  "description": "Test",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Moscow",
  "require_payment": true,
  "amount_cents": 1000
}

# Симуляция ошибки Stripe API

# Ожидаемый результат:
# - Транзакция откачена
# - Заявка не создана
# - Возвращена ошибка 500
```

### Тест 4: Валидация минимальной суммы
```bash
POST /requests/create-with-payment
{
  "require_payment": true,
  "amount_cents": 30  // Меньше минимума Stripe (50 центов)
}

# Ожидаемый результат:
# - Ошибка 400
# - Сообщение о минимуме 50 центов
```

---

## Пример полного запроса (cURL)

```bash
curl -X POST https://danilagames.ru/api/requests/create-with-payment \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: multipart/form-data" \
  -F "category=wasteLocation" \
  -F "name=Test Request" \
  -F "description=Test Description" \
  -F "latitude=55.7558" \
  -F "longitude=37.6173" \
  -F "city=Moscow" \
  -F "cost=1000" \
  -F "require_payment=true" \
  -F "amount_cents=1000" \
  -F "request_category=waste_location" \
  -F "photos_before=@photo1.jpg" \
  -F "photos_before=@photo2.jpg"
```

---

## Важные замечания

1. **Атомарность:** Все операции должны быть в одной транзакции БД
2. **Обработка ошибок:** Если любая операция не удалась, откатить всю транзакцию
3. **Валидация:** Проверить все поля перед началом транзакции
4. **Stripe:** Использовать `capture_method: manual` для холдинга средств
5. **Статусы:** Заявки с оплатой создаются со статусом `"pending_payment"`, остальные - со стандартными статусами
6. **Очистка:** Реализовать автоматическую очистку неоплаченных заявок через 24 часа

---

## Вопросы для уточнения

Если что-то неясно, уточните:
- Какой фреймворк используется на бэкенде? (Express, NestJS, FastAPI, etc.)
- Какая БД используется? (PostgreSQL, MySQL, MongoDB, etc.)
- Есть ли уже реализованные транзакции в коде?
- Как обрабатываются webhook'и от Stripe?

