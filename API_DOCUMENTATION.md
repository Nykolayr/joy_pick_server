# API Документация для Flutter приложения Joy Pick

## Базовый URL

```
http://autogie1.bget.ru/api
```

**Или для локальной разработки:**
```
http://localhost:3000/api
```

## Аутентификация

Все защищенные эндпоинты требуют заголовок `Authorization`:

```
Authorization: Bearer <jwt_token>
```

### Способы авторизации

API поддерживает два способа авторизации:

1. **Email/Password** - стандартная регистрация и вход через email и пароль
   - `POST /api/auth/register` - регистрация
   - `POST /api/auth/login` - вход

2. **Firebase (Google, Apple, GitHub, Phone)** - авторизация через Firebase
   - `POST /api/auth/firebase` - обмен Firebase токена на серверный JWT

**Важно:** После авторизации через Firebase на клиенте, необходимо отправить Firebase ID Token на сервер для получения серверного JWT токена, который используется для всех последующих API запросов.

### Настройка Email для верификации

Для работы верификации email при регистрации необходимо настроить отправку email. Подробные инструкции см. в разделе [Настройка Email](#настройка-email) ниже.

---

## 📋 Модели данных

### Модель User (Пользователь)

**Важно:** Все поля в API используют **snake_case** (как в базе данных). При отправке и получении данных используйте `snake_case` формат.

#### Поля модели:

| Поле (snake_case) | Тип | Обязательное | Описание |
|------------------|-----|--------------|----------|
| `id` | string (UUID) | Нет (автогенерация) | Уникальный идентификатор пользователя |
| `email` | string | Да (при регистрации) | Email адрес пользователя |
| `password` | string | Да (при регистрации) | Пароль (только при регистрации, не хранится) |
| `display_name` | string | Нет | Отображаемое имя пользователя |
| `first_name` | string | Нет | Имя |
| `second_name` | string | Нет | Фамилия |
| `phone_number` | string | Нет | Номер телефона |
| `city` | string | Нет | Город |
| `country` | string | Нет | Страна |
| `gender` | string | Нет | Пол (male/female/other) |
| `photo_url` | string | Нет | URL фотографии профиля |
| `latitude` | float | Нет | Широта местоположения |
| `longitude` | float | Нет | Долгота местоположения |
| `fcm_token` | string | Нет | FCM токен для push-уведомлений |
| `uid` | string | Нет | Firebase UID (для Firebase авторизации) |
| `auth_type` | string | Нет | Тип авторизации (email/google/apple/github/phone) |
| `email_verified` | boolean | Нет | Статус верификации email (только чтение) |
| `count_performed` | integer | Нет | Количество выполненных заявок (только чтение) |
| `count_orders` | integer | Нет | Количество созданных заявок (только чтение) |
| `jcoins` | integer | Нет | Количество Joycoins (только чтение, обновление через отдельный эндпоинт) |
| `coins_from_created` | integer | Нет | Монеты за созданные заявки (только чтение) |
| `coins_from_participation` | integer | Нет | Монеты за участие (только чтение) |
| `stripe_id` | string | Нет | Stripe ID (только чтение) |
| `score` | integer | Нет | Рейтинг пользователя (только чтение) |
| `admin` | boolean | Нет | Статус администратора (только чтение) |
| `created_time` | datetime | Нет | Дата создания (только чтение) |

#### Пример полной модели User (ответ от сервера):

```json
{
  "id": "353f958d-8796-44c7-a877-3e376eca6784",
  "email": "user@example.com",
  "display_name": "Иван Иванов",
  "first_name": "Иван",
  "second_name": "Иванов",
  "phone_number": "+1234567890",
  "city": "Москва",
  "country": "Россия",
  "gender": "male",
  "photo_url": "http://autogie1.bget.ru/uploads/avatars/uuid.jpg",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "fcm_token": "cqMv5gx6SKWXpMxFdRX8_3:APA91b...",
  "uid": "firebase_uid_here",
  "auth_type": "google",
  "email_verified": true,
  "count_performed": 5,
  "count_orders": 10,
  "jcoins": 150,
  "coins_from_created": 50,
  "coins_from_participation": 100,
  "stripe_id": null,
  "score": 85,
  "admin": false,
  "created_time": "2024-01-01T00:00:00.000Z"
}
```

---

### Модель Request (Заявка)

**Важно:** Все поля в API используют **snake_case** (как в базе данных). При отправке и получении данных используйте `snake_case` формат.

#### Поля модели:

| Поле (snake_case) | Тип | Обязательное | Описание |
|------------------|-----|--------------|----------|
| `id` | string (UUID) | Нет (автогенерация) | Уникальный идентификатор заявки |
| `user_id` | string | Нет (из токена) | ID пользователя (автоматически из токена) |
| `category` | string | Да | Тип заявки: `wasteLocation`, `speedCleanup`, `event` |
| `name` | string | Да | Название заявки |
| `description` | string | Нет | Описание заявки |
| `latitude` | float | Нет | Широта местоположения |
| `longitude` | float | Нет | Долгота местоположения |
| `city` | string | Нет | Город |
| `photos` | array[string] | Нет | Массив URL фотографий мусора (для всех типов) |
| `photos_before` | array[string] | Нет | Массив URL фотографий "до" (только для Speed Clean-up) |
| `photos_after` | array[string] | Нет | Массив URL фотографий "после" (только для Speed Clean-up) |
| `garbage_size` | integer | Нет | Размер мусора: `1` (bag), `2` (cart), `3` (car) |
| `waste_types` | array[string] | Нет | Массив названий типов отходов (например: `["plastic", "glass"]`) |
| `only_foot` | boolean | Нет | Доступ только пешком (по умолчанию: `false`) |
| `possible_by_car` | boolean | Нет | Доступ на машине (по умолчанию: `false`) |
| `cost` | integer | Нет | Стоимость заявки |
| `reward_amount` | integer | Нет | Награда в Joycoin (для Speed Clean-up) |
| `start_date` | datetime | **Да (для speedCleanup)** | Дата начала работы. **Обязательно для `speedCleanup`**, опционально для `event` |
| `end_date` | datetime | **Да (для speedCleanup)** | Дата окончания работы. **Обязательно для `speedCleanup`**, опционально для `event` |
| `status` | string | Нет | Статус: `pending`, `approved`, `rejected`, `completed` (по умолчанию: `pending`). **Важно:** Для заявок типа `speedCleanup` при установке статуса `approved` проверяется разница между `start_date` и `end_date`. Если разница >= 20 минут, начисляется коин создателю. Через 24 часа после `end_date` заявка автоматически переводится в `completed` и начисляются коины донатерам. |
| `priority` | string | Нет | Приоритет: `low`, `medium`, `high`, `urgent` (по умолчанию: `medium`) |
| `target_amount` | integer | Нет | Целевая сумма для выполнения заявки |
| `plant_tree` | boolean | Нет | Флаг "посадить дерево" (для Event, по умолчанию: `false`) |
| `trash_pickup_only` | boolean | Нет | Флаг "только вывоз мусора" (для Waste Location, по умолчанию: `false`) |
| `is_open` | boolean | Нет | Открыта ли заявка (только чтение, по умолчанию: `true`) |
| `created_by` | string | Нет | ID создателя (автоматически, только чтение) |
| `taken_by` | string | Нет | ID исполнителя (только чтение) |
| `contributors` | array[string] | Нет | Массив ID вкладчиков (только чтение) |
| `contributions` | object | Нет | Объект вкладов {user_id: amount} (только чтение) |
| `total_contributed` | integer | Нет | Общая сумма собранных средств (только чтение) |
| `participants` | array[string] | Нет | Массив ID участников события (только чтение) |
| `joined_user_id` | string | Нет | ID пользователя, присоединившегося к заявке (только чтение) |
| `join_date` | datetime | Нет | Дата присоединения (только чтение) |
| `completion_comment` | string | Нет | Комментарий при завершении (только чтение) |
| `created_at` | datetime | Нет | Дата создания (только чтение) |
| `updated_at` | datetime | Нет | Дата обновления (только чтение) |

#### Пример полной модели Request (ответ от сервера):

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "353f958d-8796-44c7-a877-3e376eca6784",
  "category": "wasteLocation",
  "name": "Мусор в парке",
  "description": "Большая куча мусора возле входа в парк",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "photos": [
    "http://autogie1.bget.ru/uploads/photos/uuid1.jpg",
    "http://autogie1.bget.ru/uploads/photos/uuid2.jpg"
  ],
  "photos_before": [],
  "photos_after": [],
  "garbage_size": 2,
  "waste_types": ["plastic", "paper"],
  "only_foot": false,
  "possible_by_car": true,
  "cost": 500,
  "reward_amount": null,
  "start_date": null,
  "end_date": null,
  "status": "pending",
  "priority": "medium",
  "target_amount": null,
  "plant_tree": false,
  "trash_pickup_only": false,
  "is_open": true,
  "created_by": "353f958d-8796-44c7-a877-3e376eca6784",
  "taken_by": null,
  "contributors": [],
  "contributions": {},
  "total_contributed": 0,
  "participants": [],
  "joined_user_id": null,
  "join_date": null,
  "completion_comment": null,
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

---

### Модель Partner (Партнер)

**Важно:** Все поля в API используют **snake_case** (как в базе данных). При отправке и получении данных используйте `snake_case` формат.

#### Поля модели:

| Поле (snake_case) | Тип | Обязательное | Описание |
|------------------|-----|--------------|----------|
| `id` | string (UUID) | Нет (автогенерация) | Уникальный идентификатор партнера |
| `name` | string | Да | Название партнера |
| `description` | string | Нет | Описание партнера |
| `latitude` | float | Нет | Широта местоположения |
| `longitude` | float | Нет | Долгота местоположения |
| `city` | string | Нет | Город |
| `photos` | array[string] | Нет | Массив URL фотографий партнера |
| `rating` | integer | Нет | Рейтинг партнера (0-5) |
| `partner_types` | array[string] | Нет | Массив типов партнера (например: `["recycling", "store"]`) |
| `created_at` | datetime | Нет | Дата создания (только чтение) |
| `updated_at` | datetime | Нет | Дата обновления (только чтение) |

#### Пример полной модели Partner (ответ от сервера):

```json
{
  "id": "660e8400-e29b-41d4-a716-446655440000",
  "name": "Эко-Магазин",
  "description": "Магазин экологически чистых товаров",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "photos": [
    "http://autogie1.bget.ru/uploads/photos/uuid1.jpg",
    "http://autogie1.bget.ru/uploads/photos/uuid2.jpg"
  ],
  "rating": 5,
  "partner_types": ["recycling", "store"],
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

---

## 🔐 Аутентификация

### Регистрация

**POST** `/auth/register`

**Описание:**  
Отправка кода верификации на email. Пользователь создается только после успешной верификации кода через `/auth/verify-email`.

**Тело запроса:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "display_name": "Имя пользователя",
  "first_name": "Имя",
  "second_name": "Фамилия",
  "phone_number": "+1234567890",
  "city": "Москва",
  "country": "Россия",
  "gender": "male"
}
```

**Ответ (200) - успешная отправка кода:**
```json
{
  "success": true,
  "message": "Код верификации отправлен на email",
  "data": {
    "message": "Код верификации отправлен на email",
    "email": "user@example.com",
    "verificationExpiresAt": "2024-01-01T00:10:00.000Z"
  }
}
```

**Ответ (500) - ошибка отправки email:**
```json
{
  "success": false,
  "message": "Не удалось отправить код верификации на email",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "errorDetails": {
    "emailError": {
      "message": "Неверный пароль приложения Gmail...",
      "code": "EAUTH_GMAIL_PASSWORD",
      "response": "...",
      "details": "..."
    }
  }
}
```

**Важно:**
- Пользователь НЕ создается на этом этапе
- Код верификации (6 цифр) отправляется на email
- Код действителен в течение 10 минут
- Данные регистрации сохраняются временно до верификации
- После успешной верификации кода через `/auth/verify-email` создается пользователь и возвращается токен
- Если код не пришел, используйте `POST /auth/resend-verification` для повторной отправки

**Пример для Flutter:**
```dart
// Шаг 1: Регистрация - отправка кода на email
final registerResponse = await http.post(
  Uri.parse('$baseUrl/auth/register'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'email': email,
    'password': password,
    'display_name': displayName,
    'first_name': firstName,
    'second_name': secondName,
  }),
);

if (registerResponse.statusCode == 200) {
  // Код отправлен, переходим к верификации
  // Пользователь вводит код из email
  final code = '123456'; // Код, введенный пользователем
  
  // Шаг 2: Верификация кода и создание пользователя
  final verifyResponse = await http.post(
    Uri.parse('$baseUrl/auth/verify-email'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'email': email,
      'code': code,
    }),
  );
  
  final verifyData = jsonDecode(verifyResponse.body);
  if (verifyResponse.statusCode == 200) {
    final token = verifyData['data']['token'];
    final user = verifyData['data']['user'];
    // Сохраните токен и данные пользователя
  }
}
```

---

### Вход

**POST** `/auth/login`

**Тело запроса:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Ответ (200):**
```json
{
  "success": true,
  "message": "Вход выполнен успешно",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      "photo_url": null,
      "uid": "uuid",
      "phone_number": "+1234567890",
      "city": "Москва",
      "first_name": "Имя",
      "second_name": "Фамилия",
      "country": "Россия",
      "gender": "male",
      "count_performed": 0,
      "count_orders": 0,
      "jcoins": 0,
      "coins_from_created": 0,
      "coins_from_participation": 0,
      "stripe_id": null,
      "score": 0,
      "admin": false,
      "fcm_token": null,
      "auth_type": "email",
      "latitude": null,
      "longitude": null,
      "created_time": "2024-01-01T00:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Ошибка (401):**
```json
{
  "success": false,
  "message": "Неверный email или пароль"
}
```

---

### Верификация email

**POST** `/auth/verify-email`

**Описание:**  
Проверка кода верификации и создание пользователя. После успешной верификации создается пользователь в базе данных и возвращается токен для авторизации.

**Тело запроса:**
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Ответ (200) - для новой регистрации:**
```json
{
  "success": true,
  "message": "Email успешно подтвержден. Пользователь создан.",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      "uid": "uuid",
      "email_verified": true,
      "created_time": "2024-01-01T00:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "verified": true
  }
}
```

**Ответ (200) - для существующего пользователя:**
```json
{
  "success": true,
  "message": "Email успешно подтвержден",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "email_verified": true
    },
    "verified": true
  }
}
```

**Ошибка (400):**
```json
{
  "success": false,
  "message": "Неверный код верификации"
}
```

**Ошибка (400):**
```json
{
  "success": false,
  "message": "Код верификации истек. Запросите новый код."
}
```

---

### Повторная отправка кода верификации

**POST** `/auth/resend-verification`

**Описание:**  
Повторная отправка кода верификации на email. Используйте, если код не пришел или истек. Работает как для новых регистраций (когда пользователь еще не создан), так и для существующих пользователей.

**Тело запроса:**
```json
{
  "email": "user@example.com"
}
```

**Ответ (200):**
```json
{
  "success": true,
  "message": "Код верификации отправлен",
  "data": {
    "message": "Код верификации отправлен на email",
    "verificationExpiresAt": "2024-01-01T00:10:00.000Z"
  }
}
```

**Ошибка (400):**
```json
{
  "success": false,
  "message": "Email уже подтвержден"
}
```

**Ошибка (404):**
```json
{
  "success": false,
  "message": "Пользователь с таким email не найден"
}
```

---

### Получение текущего пользователя

**GET** `/auth/me`

**Требует аутентификации**

**Ответ (200):**
```json
{
  "success": true,
  "message": "Успешно",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      // ... все поля пользователя
    }
  }
}
```

---

### Обновление токена

**POST** `/auth/refresh`

**Требует аутентификации**

**Ответ (200):**
```json
{
  "success": true,
  "message": "Токен обновлен",
  "data": {
    "token": "новый_jwt_token"
  }
}
```

---

### Авторизация через Firebase (Google Sign In, Apple Sign In и другие провайдеры)

**POST** `/auth/firebase`

**Описание:**  
Этот эндпоинт позволяет авторизоваться через Firebase с различными провайдерами:
- **Google Sign In** - авторизация через Google аккаунт
- **Apple Sign In** - авторизация через Apple ID
- **GitHub Sign In** - авторизация через GitHub
- **Phone Authentication** - авторизация по номеру телефона
- **Email/Password** - стандартная авторизация через email и пароль

После успешной авторизации в Firebase на клиенте, отправьте Firebase ID Token на сервер, и получите серверный JWT токен для дальнейшей работы с API.

**Поддерживаемые типы авторизации (`auth_type`):**
- `google` - Google Sign In
- `apple` - Apple Sign In
- `github` - GitHub Sign In
- `phone` - Phone Authentication
- `email` - Email/Password

**Настройка на сервере:**  
Перед использованием этого эндпоинта необходимо настроить Firebase Admin SDK на сервере.  
Подробные инструкции см. в файле [FIREBASE_SETUP.md](./FIREBASE_SETUP.md)

**Тело запроса:**
```json
{
  "idToken": "firebase_id_token_here",
  "first_name": "Иван",      // опционально, рекомендуется для Apple Sign In при первом входе
  "second_name": "Иванов"    // опционально, рекомендуется для Apple Sign In при первом входе
}
```

**Примечание:**  
Поля `first_name` и `second_name` особенно полезны для Apple Sign In, так как Apple предоставляет `givenName` и `familyName` только при первом входе и они не сохраняются в Firebase User. Рекомендуется передавать их с фронта при первой авторизации через Apple.

**Ответ (200):**
```json
{
  "success": true,
  "message": "Авторизация через Firebase выполнена успешно",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      "photo_url": "https://example.com/photo.jpg",
      "uid": "firebase_uid",
      "auth_type": "google",
      // ... все остальные поля пользователя
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Ошибка (401):**
```json
{
  "success": false,
  "message": "Недействительный Firebase токен"
}
```

**Ошибка (400):**
```json
{
  "success": false,
  "message": "Ошибка валидации",
  "errors": [
    {
      "msg": "Firebase ID Token обязателен",
      "param": "idToken"
    }
  ]
}
```

**Пример для Flutter:**

```dart
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String baseUrl = 'http://autogie1.bget.ru/api';
  final FlutterSecureStorage _storage = FlutterSecureStorage();

  /// Авторизация через Firebase (Google Sign In, Apple Sign In и др.)
  /// Вызывайте этот метод после успешной авторизации в Firebase
  /// 
  /// [first_name] и [second_name] - опциональны, рекомендуется для Apple Sign In
  /// при первом входе, так как Apple предоставляет эти данные только один раз
  Future<Map<String, dynamic>?> signInWithFirebase({
    String? first_name,
    String? second_name,
  }) async {
    try {
      // Получаем Firebase ID Token
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) {
        throw Exception('Пользователь не авторизован в Firebase');
      }

      // Получаем свежий токен (forceRefresh: true для получения нового токена)
      final idToken = await user.getIdToken(true);
      
      // Формируем тело запроса
      final requestBody = {'idToken': idToken};
      if (first_name != null && first_name.isNotEmpty) {
        requestBody['first_name'] = first_name;
      }
      if (second_name != null && second_name.isNotEmpty) {
        requestBody['second_name'] = second_name;
      }
      
      // Отправляем токен на сервер
      final response = await http.post(
        Uri.parse('$baseUrl/auth/firebase'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(requestBody),
      );

      final data = jsonDecode(response.body);

      if (data['success'] == true) {
        // Сохраняем серверный JWT токен
        final serverToken = data['data']['token'];
        await _storage.write(key: 'auth_token', value: serverToken);
        
        return data['data'];
      } else {
        throw Exception(data['message'] ?? 'Ошибка авторизации');
      }
    } catch (e) {
      print('Ошибка авторизации через Firebase: $e');
      return null;
    }
  }

  /// Получение сохраненного токена
  Future<String?> getToken() async {
    return await _storage.read(key: 'auth_token');
  }

  /// Использование токена в API запросах
  Future<Map<String, dynamic>> makeAuthenticatedRequest(
    String method,
    String endpoint, {
    Map<String, dynamic>? body,
  }) async {
    final token = await getToken();
    if (token == null) {
      throw Exception('Токен не найден. Требуется авторизация.');
    }

    final headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };

    final uri = Uri.parse('$baseUrl$endpoint');
    http.Response response;

    switch (method.toUpperCase()) {
      case 'GET':
        response = await http.get(uri, headers: headers);
        break;
      case 'POST':
        response = await http.post(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      case 'PUT':
        response = await http.put(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      case 'DELETE':
        response = await http.delete(uri, headers: headers);
        break;
      default:
        throw Exception('Неподдерживаемый метод: $method');
    }

    return jsonDecode(response.body);
  }
}
```

**Интеграция с существующим кодом авторизации:**

**Для Google Sign In:**
```dart
// В вашем коде авторизации через Google (например, в authorization_widget.dart)
// После успешной авторизации в Firebase:

final user = await authManager.signInWithGoogle(context);
if (user != null) {
  // Ждем пока currentUserDocument будет создан
  int attempts = 0;
  while (currentUserDocument == null && attempts < 20) {
    await Future.delayed(const Duration(milliseconds: 100));
    attempts++;
  }

  // ВАЖНО: Теперь отправляем Firebase токен на сервер
  // Для Google first_name и second_name не обязательны - они будут распарсены из display_name
  final authService = AuthService();
  final serverAuthResult = await authService.signInWithFirebase();
  
  if (serverAuthResult != null) {
    // Авторизация успешна, серверный токен сохранен
    // auth_type будет автоматически установлен в 'google'
    // first_name и second_name будут распарсены из display_name
    print('✅ Авторизация через сервер выполнена успешно');
    print('📱 Auth type: ${serverAuthResult['user']['auth_type']}'); // 'google'
  } else {
    print('❌ Ошибка авторизации на сервере');
  }
}
```

**Для Apple Sign In:**
```dart
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

// В вашем коде авторизации через Apple (например, в authorization_widget.dart)
// После успешной авторизации в Firebase:

// ВАЖНО: Для Apple нужно сохранить givenName и familyName ДО авторизации в Firebase,
// так как они доступны только при первом входе
String? appleFirstName;
String? appleSecondName;

// Генерируем nonce для безопасности
final rawNonce = generateNonce();
final nonce = sha256ofString(rawNonce);

// Запрашиваем credential от Apple
final appleCredential = await SignInWithApple.getAppleIDCredential(
  scopes: [
    AppleIDAuthorizationScopes.email,
    AppleIDAuthorizationScopes.fullName, // ВАЖНО: запрашиваем fullName
  ],
  nonce: nonce,
);

// Сохраняем имя и фамилию ДО авторизации в Firebase
// (они доступны только при первом входе!)
appleFirstName = appleCredential.givenName;
appleSecondName = appleCredential.familyName;

// Создаем OAuth credential для Firebase
final oauthCredential = OAuthProvider("apple.com").credential(
  idToken: appleCredential.identityToken,
  rawNonce: rawNonce,
  accessToken: appleCredential.authorizationCode,
);

// Авторизуемся в Firebase
final userCredential = await FirebaseAuth.instance.signInWithCredential(oauthCredential);

// Обновляем displayName в Firebase (если есть)
if (appleFirstName != null || appleSecondName != null) {
  final displayName = [appleFirstName, appleSecondName]
      .where((name) => name != null && name.isNotEmpty)
      .join(' ');
  if (displayName.isNotEmpty) {
    await userCredential.user?.updateDisplayName(displayName);
  }
}

// Ждем пока currentUserDocument будет создан
int attempts = 0;
while (currentUserDocument == null && attempts < 20) {
  await Future.delayed(const Duration(milliseconds: 100));
  attempts++;
}

// ВАЖНО: Отправляем Firebase токен на сервер С именами из Apple
final authService = AuthService();
final serverAuthResult = await authService.signInWithFirebase(
  first_name: appleFirstName,  // Передаем имя из Apple
  second_name: appleSecondName, // Передаем фамилию из Apple
);

if (serverAuthResult != null) {
  // Авторизация успешна, серверный токен сохранен
  // auth_type будет автоматически установлен в 'apple'
  // first_name и second_name будут сохранены в базе данных
  print('✅ Авторизация через Apple выполнена успешно');
  print('📱 Auth type: ${serverAuthResult['user']['auth_type']}'); // 'apple'
  print('👤 Имя: ${serverAuthResult['user']['first_name']}');
  print('👤 Фамилия: ${serverAuthResult['user']['second_name']}');
} else {
  print('❌ Ошибка авторизации на сервере');
}
```

**Важно для Apple Sign In:**
- `givenName` и `familyName` доступны **только при первом входе** через Apple
- Их нужно сохранить **ДО** авторизации в Firebase
- Передайте их в `signInWithFirebase(first_name: ..., second_name: ...)`
- Если не передать, сервер попытается распарсить `display_name`, но это менее надежно

**Важно для Apple Sign In:**
- Apple может не предоставить email при первом входе (пользователь может скрыть email)
- В этом случае сервер создаст пользователя с `email = null` или использует скрытый email от Apple
- При последующих входах email может быть предоставлен
- Сервер автоматически обновит email, если он станет доступен
- **`givenName` и `familyName` доступны только при первом входе** - передайте их в `first_name` и `second_name` для сохранения в базе данных

**Какие данные получаются автоматически:**

При первой авторизации сервер автоматически получает и сохраняет следующие данные:

**Из Firebase ID Token:**
- ✅ `uid` - Firebase UID (сохраняется как `uid` в базе)
- ✅ `email` - Email пользователя (может быть null для Apple)
- ✅ `name` - Полное имя (сохраняется как `display_name`)
- ✅ `picture` - URL фото (сохраняется как `photo_url`)
- ✅ `email_verified` - Подтвержден ли email

**Через Firebase Admin SDK (дополнительно):**
- ✅ `phone_number` - Номер телефона (если есть, сохраняется как `phone_number`)

**Автоматический парсинг:**
- ✅ `first_name` - Первое слово из `display_name` (если не передано с фронта)
- ✅ `second_name` - Остальные слова из `display_name` (если не передано с фронта)

**Рекомендуется передавать с фронта (особенно для Apple):**
- ✅ `first_name` - Имя пользователя (для Apple - из `appleCredential.givenName`)
- ✅ `second_name` - Фамилия пользователя (для Apple - из `appleCredential.familyName`)

**Автоматически определяется:**
- ✅ `auth_type` - Тип авторизации (`google`, `apple`, `github`, `phone`, `email`)

**Важные замечания:**

1. **Firebase ID Token** получается через `FirebaseAuth.instance.currentUser?.getIdToken(true)`
   - Параметр `true` означает принудительное обновление токена
   - Firebase токены обновляются автоматически каждые час

2. **Серверный JWT токен** используется для всех последующих API запросов
   - Сохраняйте его в `flutter_secure_storage`
   - Добавляйте в заголовок `Authorization: Bearer <token>`

3. **Синхронизация пользователей:**
   - Если пользователь уже существует в базе (по `uid` или `email`), данные обновляются
   - Если пользователь новый, создается запись в базе данных
   - Поле `uid` в базе данных соответствует Firebase UID

4. **Типы авторизации (`auth_type`):**
   - `google` - Google Sign In
   - `apple` - Apple Sign In
   - `github` - GitHub Sign In
   - `phone` - Phone Authentication
   - `email` - Email/Password (стандартная регистрация)

5. **Обработка ошибок:**
   - Если Firebase токен недействителен, вернется 401
   - Если токен истек, получите новый через `getIdToken(true)`
   - При ошибках сети обрабатывайте исключения

---

## 👤 Пользователи

### Получение списка пользователей (только для админов)

**GET** `/users`

**Требует аутентификации и прав администратора**

**Query параметры:**
- `page` (integer, опционально) - номер страницы (по умолчанию: 1)
- `limit` (integer, опционально) - количество записей на странице (по умолчанию: 20)
- `search` (string, опционально) - поиск по email, display_name, first_name, second_name

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "display_name": "Имя пользователя",
        "photo_url": "https://...",
        "uid": "firebase-uid",
        "phone_number": "+79001234567",
        "city": "Москва",
        "first_name": "Имя",
        "second_name": "Фамилия",
        "country": "Россия",
        "gender": "male",
        "count_performed": 5,
        "count_orders": 3,
        "jcoins": 1000,
        "coins_from_created": 500,
        "coins_from_participation": 500,
        "stripe_id": null,
        "score": 4.5,
        "admin": 0,
        "fcm_token": "token",
        "auth_type": "email",
        "latitude": 55.7558,
        "longitude": 37.6173,
        "created_time": "2025-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

**Ошибки:**
- `401` - Не авторизован
- `403` - Нет прав администратора
- `500` - Ошибка сервера (с детальной информацией об ошибке)

**Пример использования в Flutter:**
```dart
Future<Map<String, dynamic>> getUsersList({
  required String token,
  int page = 1,
  int limit = 20,
  String? search,
}) async {
  final queryParams = <String, String>{
    'page': page.toString(),
    'limit': limit.toString(),
  };
  
  if (search != null && search.isNotEmpty) {
    queryParams['search'] = search;
  }
  
  final uri = Uri.parse('http://autogie1.bget.ru/api/users')
      .replace(queryParameters: queryParams);
  
  final response = await http.get(
    uri,
    headers: {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  );
  
  if (response.statusCode == 200) {
    return json.decode(response.body);
  } else {
    throw Exception('Ошибка получения списка пользователей: ${response.body}');
  }
}
```

---

### Получение пользователя по ID

**GET** `/users/:id`

**Требует аутентификации** (можно получить только свои данные или админ)

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      // ... все поля
    }
  }
}
```

---

### Обновление пользователя

**PUT** `/users/:id`

**Требует аутентификации**

**Поддерживает два способа отправки:**

1. **JSON с URL фотографии** (для обратной совместимости)
2. **multipart/form-data с файлом** (рекомендуется)

**Способ 1: JSON с URL**

**Content-Type:** `application/json`

**Тело запроса:**
```json
{
  "display_name": "Новое имя",
  "first_name": "Имя",
  "second_name": "Фамилия",
  "phone_number": "+1234567890",
  "city": "Санкт-Петербург",
  "country": "Россия",
  "gender": "female",
  "photo_url": "https://example.com/photo.jpg",
  "latitude": 59.9343,
  "longitude": 30.3351,
  "fcm_token": "fcm_token_here"
}
```

**Способ 2: multipart/form-data с файлом**

**Content-Type:** `multipart/form-data`

**Поля формы:**
- `display_name` (string, опционально)
- `first_name` (string, опционально)
- `second_name` (string, опционально)
- `phone_number` (string, опционально)
- `city` (string, опционально)
- `country` (string, опционально)
- `gender` (string, опционально)
- `photo` (file, опционально) - файл аватара пользователя
- `latitude` (float, опционально)
- `longitude` (float, опционально)
- `fcm_token` (string, опционально)

**Ограничения для файла:**
- Максимальный размер: 10MB
- Разрешенные форматы: JPEG, PNG, GIF, WebP

**Пример для Flutter:**

```dart
Future<void> updateUserAvatar({
  required String token,
  required String userId,
  required File avatarFile,
}) async {
  final uri = Uri.parse('http://autogie1.bget.ru/api/users/$userId');
  final request = http.MultipartRequest('PUT', uri);
  
  request.headers['Authorization'] = 'Bearer $token';
  
  // Добавляем файл
  final fileStream = http.ByteStream(avatarFile.openRead());
  final length = await avatarFile.length();
  final multipartFile = http.MultipartFile(
    'photo',
    fileStream,
    length,
    filename: path.basename(avatarFile.path),
  );
  request.files.add(multipartFile);
  
  // Отправка
  final streamedResponse = await request.send();
  final response = await http.Response.fromStream(streamedResponse);
  
  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    print('Аватар обновлен: ${data['data']['user']['photo_url']}');
  }
}
```

**Ответ (200):**
```json
{
  "success": true,
  "message": "Данные пользователя обновлены",
  "data": {
    "user": { /* обновленные данные */ }
  }
}
```

---

### Обновление Joycoins (только админ)

**PUT** `/users/:id/jcoins`

**Требует аутентификации и прав администратора**

**Тело запроса:**
```json
{
  "jcoins": 100,
  "operation": "add"  // "set", "add", "subtract"
}
```

---

## 📋 Заявки (Requests)

### Получение списка заявок

**GET** `/requests`

**Query параметры:**
- `page` (int, default: 1) - номер страницы
- `limit` (int, default: 20) - количество на странице
- `category` (string) - фильтр: `wasteLocation`, `speedCleanup`, `event`
- `status` (string) - фильтр: `pending`, `approved`, `rejected`, `completed`
- `city` (string) - фильтр по городу
- `latitude` (float) - широта для поиска по радиусу
- `longitude` (float) - долгота для поиска по радиусу
- `radius` (int, default: 10000) - радиус в метрах
- `is_open` (boolean) - фильтр по открытости
- `user_id` (string) - фильтр по пользователю
- `created_by` (string) - фильтр по создателю
- `taken_by` (string) - фильтр по исполнителю

**Пример запроса:**
```
GET /api/requests?category=wasteLocation&city=Москва&page=1&limit=20
```

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "id": "uuid",
        "user_id": "uuid",
        "category": "wasteLocation",
        "name": "Название заявки",
        "description": "Описание",
        "latitude": 55.7558,
        "longitude": 37.6173,
        "city": "Москва",
        "garbage_size": 1,
        "only_foot": false,
        "possible_by_car": true,
        "cost": 1000,
        "reward_amount": null,
        "is_open": true,
        "start_date": null,
        "end_date": null,
        "status": "pending",
        "priority": "medium",
        "assigned_to": null,
        "created_by": "uuid",
        "taken_by": null,
        "total_contributed": 0,
        "target_amount": null,
        "joined_user_id": null,
        "join_date": null,
        "payment_intent_id": null,
        "completion_comment": null,
        "plant_tree": false,
        "trash_pickup_only": false,
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z",
        "photos": ["url1", "url2"],
        "photos_before": [],
        "photos_after": [],
        "waste_types": ["plastic", "glass"]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

---

### Получение заявки по ID

**GET** `/requests/:id`

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "request": {
      "id": "uuid",
      // ... все поля заявки
      "participants": ["user_id1", "user_id2"],
      "contributors": ["user_id1"],
      "contributions": {
        "user_id1": 1000
      },
      "donations": [
        {
          "id": "uuid",
          "request_id": "uuid",
          "user_id": "uuid",
          "amount": 1000,
          "payment_intent_id": "pi_xxx",
          "created_at": "2024-01-01T00:00:00.000Z"
        }
      ]
    }
  }
}
```

---

### Создание заявки

**POST** `/requests`

**Требует аутентификации**

**Поддерживает два способа отправки:**

1. **JSON с URL фотографий** (для обратной совместимости)
2. **multipart/form-data с файлами** (рекомендуется)

**Способ 1: JSON с URL фотографий**

**Content-Type:** `application/json`

**Тело запроса:**
```json
{
  "category": "wasteLocation",
  "name": "Название заявки",
  "description": "Описание заявки",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "garbage_size": 1,
  "only_foot": false,
  "possible_by_car": true,
  "cost": 1000,
  "reward_amount": null,
  "start_date": null,
  "end_date": null,
  "status": "pending",
  "priority": "medium",
  "waste_types": ["plastic", "glass"],
  "photos": ["https://example.com/photo1.jpg", "https://example.com/photo2.jpg"],
  "photos_before": [],
  "photos_after": [],
  "target_amount": null,
  "plant_tree": false,
  "trash_pickup_only": false
}
```

**Для Speed Cleanup:**
```json
{
  "category": "speedCleanup",
  "name": "Быстрая уборка",
  "description": "Описание",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "garbage_size": 2,
  "reward_amount": 50,
  "start_date": "2024-02-01T10:00:00.000Z",
  "end_date": "2024-02-01T10:25:00.000Z",
  "photos_before": ["url1"],
  "photos_after": ["url2"],
  "waste_types": ["plastic"]
}
```

**Важно для Speed Cleanup:**
- Поля `start_date` и `end_date` **обязательны** для заявок типа `speedCleanup`
- Разница между `start_date` и `end_date` должна быть минимум 20 минут для начисления коина создателю при одобрении
- Формат дат: ISO 8601 (например: `"2024-02-01T10:00:00.000Z"`)

**Для Event:**
```json
{
  "category": "event",
  "name": "Экологическое событие",
  "description": "Описание",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "start_date": "2024-02-01T10:00:00.000Z",
  "end_date": "2024-02-01T18:00:00.000Z",
  "plant_tree": true,
  "photos": ["url1", "url2"]
}
```

**Способ 2: multipart/form-data с файлами (рекомендуется)**

**Content-Type:** `multipart/form-data`

**Поля формы:**
- `category` (string, обязательное) - категория заявки
- `name` (string, обязательное) - название заявки
- `description` (string, опционально) - описание
- `latitude` (float, опционально) - широта
- `longitude` (float, опционально) - долгота
- `city` (string, опционально) - город
- `garbage_size` (integer, опционально) - размер мусора
- `only_foot` (boolean, опционально) - только пешком
- `possible_by_car` (boolean, опционально) - доступно на машине
- `cost` (integer, опционально) - стоимость
- `reward_amount` (integer, опционально) - размер награды
- `start_date` (string, **обязательно для speedCleanup**, опционально для event) - дата начала работы
- `end_date` (string, **обязательно для speedCleanup**, опционально для event) - дата окончания работы
- `status` (string, опционально) - статус (по умолчанию: "pending"). **Важно:** Для заявок типа `speedCleanup` при установке статуса `approved` автоматически переводится в `completed` и начисляются коины.
- `priority` (string, опционально) - приоритет (по умолчанию: "medium")
- `waste_types` (array[string], опционально) - массив названий типов отходов (например: `["plastic", "glass"]`)
- `target_amount` (integer, опционально) - целевая сумма
- `plant_tree` (boolean, опционально) - посадить дерево
- `trash_pickup_only` (boolean, опционально) - только сбор мусора
- `photos` (file[], опционально) - массив файлов для основных фото
- `photos_before` (file[], опционально) - массив файлов для фото "до"
- `photos_after` (file[], опционально) - массив файлов для фото "после"

**Ограничения:**
- Максимальный размер файла: 10MB
- Разрешенные форматы: JPEG, PNG, GIF, WebP
- Максимум 10 файлов в каждом поле (photos, photos_before, photos_after)

**Пример для Flutter (multipart/form-data):**

```dart
import 'package:http/http.dart' as http;
import 'dart:io';
import 'package:path/path.dart' as path;

Future<void> createRequestWithPhotos({
  required String token,
  required String name,
  required String category,
  required List<File> photos,
  List<File>? photos_before,
  List<File>? photos_after,
}) async {
  final uri = Uri.parse('http://autogie1.bget.ru/api/requests');
  final request = http.MultipartRequest('POST', uri);
  
  // Заголовок авторизации
  request.headers['Authorization'] = 'Bearer $token';
  
  // Текстовые поля
  request.fields['name'] = name;
  request.fields['category'] = category;
  request.fields['description'] = 'Описание заявки';
  request.fields['city'] = 'Москва';
  request.fields['latitude'] = '55.7558';
  request.fields['longitude'] = '37.6173';
  
  // Файлы - основные фото
  for (var photo in photos) {
    final fileStream = http.ByteStream(photo.openRead());
    final length = await photo.length();
    final multipartFile = http.MultipartFile(
      'photos',
      fileStream,
      length,
      filename: path.basename(photo.path),
    );
    request.files.add(multipartFile);
  }
  
  // Файлы - фото "до"
  if (photos_before != null) {
    for (var photo in photos_before) {
      final fileStream = http.ByteStream(photo.openRead());
      final length = await photo.length();
      final multipartFile = http.MultipartFile(
        'photos_before',
        fileStream,
        length,
        filename: path.basename(photo.path),
      );
      request.files.add(multipartFile);
    }
  }
  
  // Файлы - фото "после"
  if (photos_after != null) {
    for (var photo in photos_after) {
      final fileStream = http.ByteStream(photo.openRead());
      final length = await photo.length();
      final multipartFile = http.MultipartFile(
        'photos_after',
        fileStream,
        length,
        filename: path.basename(photo.path),
      );
      request.files.add(multipartFile);
    }
  }
  
  // Отправка запроса
  final streamedResponse = await request.send();
  final response = await http.Response.fromStream(streamedResponse);
  
  if (response.statusCode == 201) {
    final data = jsonDecode(response.body);
    print('Заявка создана: ${data['data']['request']['id']}');
  }
}
```

**Ответ (201):**
```json
{
  "success": true,
  "message": "Заявка создана",
  "data": {
    "request": {
      "id": "uuid",
      "name": "Название заявки",
      "photos": ["http://autogie1.bget.ru/uploads/photos/uuid1.jpg", "http://autogie1.bget.ru/uploads/photos/uuid2.jpg"],
      "photos_before": ["http://autogie1.bget.ru/uploads/photos/uuid3.jpg"],
      "photos_after": ["http://autogie1.bget.ru/uploads/photos/uuid4.jpg"],
      // ... остальные поля
    }
  }
}
```

**Важно:**
- Файлы автоматически сохраняются на сервере в папке `uploads/photos/`
- Сервер генерирует уникальные имена файлов
- URL файлов автоматически подставляются в соответствующие поля заявки
- Файлы доступны по URL: `http://autogie1.bget.ru/uploads/photos/{filename}`

---

### Обновление заявки

**PUT** `/requests/:id`

**Требует аутентификации** (только создатель или админ)

**Тело запроса:** (все поля опциональны)
```json
{
  "name": "Обновленное название",
  "description": "Обновленное описание",
  "status": "completed",
  "completion_comment": "Заявка выполнена"
}
```

**Важно о начислении коинов:**

1. **Для заявок типа `speedCleanup`:**
   - **При установке статуса `approved`:**
     - Проверяется разница между `start_date` и `end_date`
     - Если разница >= 20 минут:
       - Начисляется 1 коин **только создателю** заявки
       - Отправляется push-уведомление создателю: "Thank you! You've earned a coin for your cleanup work!"
     - Если разница < 20 минут:
       - Коин не начисляется
       - Отправляется push-уведомление создателю: "Thank you! Try to work a bit longer next time to earn a coin."
     - Заявка **НЕ переводится** в статус `completed` автоматически
   - **Через 24 часа после `end_date`:**
     - Заявка автоматически переводится в статус `completed` (при следующем обновлении заявки или запросе)
     - Начисляется по 1 коину **всем донатерам** (если они есть)
     - Отправляется push-уведомление донатерам: "Thank you! You've earned a coin for your cleanup work!"
     - Донатеры из таблицы `request_contributors` автоматически переносятся в таблицу `donations`
   - Коины начисляются в поля `jcoins`, `coins_from_created` (создателю) и `coins_from_participation` (донатерам)
   - **Автоматический перевод в `completed` через 24 часа:**
     - В текущей реализации проверка происходит при каждом обновлении заявки (PUT `/api/requests/:id`)
     - Если прошло 24 часа с момента `end_date` и статус `approved`, заявка автоматически переводится в `completed`
     - Для более точного и своевременного перевода рекомендуется настроить cron job или scheduled task на сервере, который будет периодически проверять все заявки типа `speedCleanup` со статусом `approved` и переводить их в `completed` при необходимости

2. **Для всех остальных типов заявок (`wasteLocation`, `event`):**
   - При установке статуса `completed` начисляется по 1 коину:
     - Создателю заявки
     - Всем донатерам (если есть)
     - Всем участникам (для `wasteLocation` - присоединившемуся пользователю, для `event` - всем участникам события)
   - Коины начисляются в поля `jcoins`, `coins_from_created` (создателю) и `coins_from_participation` (участникам и донатерам)

---

### Удаление заявки

**DELETE** `/requests/:id`

**Требует аутентификации** (только создатель или админ)

**Ответ (200):**
```json
{
  "success": true,
  "message": "Заявка удалена"
}
```

---

### Присоединение к заявке (wasteLocation)

**POST** `/requests/:id/join`

**Требует аутентификации**

**Ответ (200):**
```json
{
  "success": true,
  "message": "Вы присоединились к заявке"
}
```

**Ошибка (409):**
```json
{
  "success": false,
  "message": "К заявке уже присоединился другой пользователь"
}
```

---

### Участие в событии (event)

**POST** `/requests/:id/participate`

**Требует аутентификации**

**Ответ (200):**
```json
{
  "success": true,
  "message": "Вы присоединились к событию"
}
```

**Отмена участия:**

**DELETE** `/requests/:id/participate`

**Требует аутентификации**

---

## 💰 Донаты

### Получение списка донатов

**GET** `/donations`

**Требует аутентификации**

**Query параметры:**
- `page`, `limit` - пагинация
- `requestId` - фильтр по заявке
- `user_id` - фильтр по пользователю

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "donations": [
      {
        "id": "uuid",
        "request_id": "uuid",
        "user_id": "uuid",
        "amount": 1000,
        "payment_intent_id": "pi_xxx",
        "created_at": "2024-01-01T00:00:00.000Z",
        "user_name": "Имя пользователя",
        "user_email": "user@example.com",
        "request_name": "Название заявки"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

---

### Создание доната

**POST** `/donations`

**Требует аутентификации**

**Тело запроса:**
```json
{
  "requestId": "uuid",
  "amount": 1000,
  "paymentIntentId": "pi_xxx"
}
```

**Ответ (201):**
```json
{
  "success": true,
  "message": "Донат создан",
  "data": {
    "donation": {
      "id": "uuid",
      "request_id": "uuid",
      "user_id": "uuid",
      "amount": 1000,
      "payment_intent_id": "pi_xxx",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

## 👥 Участники

### Получение участников заявки

**GET** `/participants?requestId=uuid`

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "participants": [
      {
        "id": "uuid",
        "request_id": "uuid",
        "user_id": "uuid",
        "created_at": "2024-01-01T00:00:00.000Z",
        "display_name": "Имя пользователя",
        "photo_url": "url",
        "email": "user@example.com"
      }
    ]
  }
}
```

---

### Получение вкладчиков заявки

**GET** `/participants/contributors?requestId=uuid`

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "contributors": [
      {
        "id": "uuid",
        "request_id": "uuid",
        "user_id": "uuid",
        "amount": 1000,
        "created_at": "2024-01-01T00:00:00.000Z",
        "display_name": "Имя пользователя",
        "photo_url": "url",
        "email": "user@example.com"
      }
    ]
  }
}
```

---

## 🏢 Партнеры

### Создание партнера

**POST** `/partners`

**Требует аутентификации и прав администратора**

**Поддерживает два способа отправки:**

1. **JSON с URL фотографий** (для обратной совместимости)
2. **multipart/form-data с файлами** (рекомендуется)

**Способ 1: JSON с URL**

**Content-Type:** `application/json`

**Тело запроса:**
```json
{
  "name": "Название партнера",
  "description": "Описание",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "rating": 4.5,
  "photos": ["https://example.com/photo1.jpg"],
  "partner_types": ["recycling", "store"]
}
```

**Способ 2: multipart/form-data с файлами**

**Content-Type:** `multipart/form-data`

**Поля формы:**
- `name` (string, обязательное) - название партнера
- `description` (string, опционально) - описание
- `latitude` (float, опционально) - широта
- `longitude` (float, опционально) - долгота
- `city` (string, опционально) - город
- `rating` (float, опционально) - рейтинг
- `photos` (file[], опционально) - массив файлов для фото партнера
- `partner_types` (string, опционально) - типы партнера через запятую

**Ограничения для файлов:**
- Максимальный размер файла: 10MB
- Разрешенные форматы: JPEG, PNG, GIF, WebP
- Максимум 10 файлов

**Ответ (201):**
```json
{
  "success": true,
  "message": "Партнер создан",
  "data": {
    "partner": {
      "id": "uuid",
      "name": "Название партнера",
      "photos": ["http://autogie1.bget.ru/uploads/photos/uuid1.jpg"],
      // ... остальные поля
    }
  }
}
```

---

### Получение списка партнеров

**GET** `/partners`

**Query параметры:**
- `page`, `limit` - пагинация
- `city` - фильтр по городу
- `latitude`, `longitude`, `radius` - поиск по радиусу

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "partners": [
      {
        "id": "uuid",
        "name": "Название партнера",
        "description": "Описание",
        "latitude": 55.7558,
        "longitude": 37.6173,
        "city": "Москва",
        "rating": 5,
        "photos": ["url1", "url2"],
        "partner_types": ["recycling", "shop"],
        "created_at": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

### Создание партнера

**POST** `/partners`

**Требует аутентификации и прав администратора**

**Поддерживает два способа отправки:**

1. **JSON с URL фотографий** (для обратной совместимости)
2. **multipart/form-data с файлами** (рекомендуется)

**Способ 1: JSON с URL**

**Content-Type:** `application/json`

**Тело запроса:**
```json
{
  "name": "Название партнера",
  "description": "Описание",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "rating": 4.5,
  "photos": ["https://example.com/photo1.jpg"],
  "partner_types": ["recycling", "store"]
}
```

**Способ 2: multipart/form-data с файлами**

**Content-Type:** `multipart/form-data`

**Поля формы:**
- `name` (string, обязательное) - название партнера
- `description` (string, опционально) - описание
- `latitude` (float, опционально) - широта
- `longitude` (float, опционально) - долгота
- `city` (string, опционально) - город
- `rating` (float, опционально) - рейтинг
- `photos` (file[], опционально) - массив файлов для фото партнера
- `partner_types` (string, опционально) - типы партнера через запятую

**Ограничения для файлов:**
- Максимальный размер файла: 10MB
- Разрешенные форматы: JPEG, PNG, GIF, WebP
- Максимум 10 файлов

**Ответ (201):**
```json
{
  "success": true,
  "message": "Партнер создан",
  "data": {
    "partner": {
      "id": "uuid",
      "name": "Название партнера",
      "photos": ["http://autogie1.bget.ru/uploads/photos/uuid1.jpg"],
      // ... остальные поля
    }
  }
}
```

---

## 🗑️ Типы отходов (Waste Types)

API для управления типами отходов. Типы отходов используются в заявках для указания категории мусора.

**Важно:** В заявках поле `waste_types` хранится как JSON-массив названий типов отходов (например: `["plastic", "glass"]`). Таблица `waste_types` используется только как справочник для CRUD операций и не связана с заявками через внешние ключи.

### Модель WasteType

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `id` | string (UUID) | Нет (автогенерация) | Уникальный идентификатор типа отходов |
| `name` | string | Да | Название типа отходов (в нижнем регистре, уникальное) |
| `danger` | boolean | Нет | Флаг опасности (true - опасный, false - обычный, по умолчанию false) |
| `created_at` | datetime | Нет (автогенерация) | Дата создания |
| `updated_at` | datetime | Нет (автогенерация) | Дата обновления |

### Получение списка всех типов отходов

**GET** `/waste-types`

**Авторизация:** Не требуется (публичный эндпоинт)

**Параметры запроса:** Нет

**Успешный ответ (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-1",
      "name": "plastic",
      "danger": false,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "uuid-2",
      "name": "toxic",
      "danger": true,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**Пример запроса (Flutter):**

```dart
Future<List<Map<String, dynamic>>> getWasteTypes() async {
  final response = await http.get(
    Uri.parse('$baseUrl/waste-types'),
    headers: {'Content-Type': 'application/json'},
  );

  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(data['data']);
  } else {
    throw Exception('Ошибка получения типов отходов: ${response.body}');
  }
}
```

### Получение типа отходов по ID

**GET** `/waste-types/:id`

**Авторизация:** Не требуется

**Параметры пути:**
- `id` (UUID) - ID типа отходов

**Успешный ответ (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "plastic",
    "danger": false,
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**Ошибка (404):**

```json
{
  "success": false,
  "message": "Тип отходов не найден",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Создание типа отходов

**POST** `/waste-types`

**Авторизация:** Требуется (только для администраторов)

**Тело запроса:**

```json
{
  "name": "plastic",
  "danger": false
}
```

**Параметры:**

| Параметр | Тип | Обязательное | Описание |
|----------|-----|--------------|----------|
| `name` | string | Да | Название типа отходов (будет автоматически преобразовано в нижний регистр) |
| `danger` | boolean | Нет | Флаг опасности (по умолчанию false) |

**Успешный ответ (201):**

```json
{
  "success": true,
  "message": "Тип отходов успешно создан",
  "data": {
    "id": "uuid",
    "name": "plastic",
    "danger": false,
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**Ошибка (400):**

```json
{
  "success": false,
  "message": "Ошибка валидации",
  "errors": [
    {
      "field": "name",
      "message": "Название обязательно"
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Ошибка (409):**

```json
{
  "success": false,
  "message": "Тип отходов с таким названием уже существует",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Пример запроса (Flutter):**

```dart
Future<Map<String, dynamic>> createWasteType({
  required String name,
  bool danger = false,
}) async {
  final token = await getToken();
  final response = await http.post(
    Uri.parse('$baseUrl/waste-types'),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    },
    body: jsonEncode({
      'name': name,
      'danger': danger,
    }),
  );

  if (response.statusCode == 201) {
    final data = jsonDecode(response.body);
    return data['data'];
  } else {
    throw Exception('Ошибка создания типа отходов: ${response.body}');
  }
}
```

### Обновление типа отходов

**PUT** `/waste-types/:id`

**Авторизация:** Требуется (только для администраторов)

**Параметры пути:**
- `id` (UUID) - ID типа отходов

**Тело запроса:**

```json
{
  "name": "plastic",
  "danger": true
}
```

**Параметры:**

| Параметр | Тип | Обязательное | Описание |
|----------|-----|--------------|----------|
| `name` | string | Нет | Название типа отходов (будет автоматически преобразовано в нижний регистр) |
| `danger` | boolean | Нет | Флаг опасности |

**Успешный ответ (200):**

```json
{
  "success": true,
  "message": "Тип отходов успешно обновлен",
  "data": {
    "id": "uuid",
    "name": "plastic",
    "danger": true,
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:01:00.000Z"
  }
}
```

**Ошибка (404):**

```json
{
  "success": false,
  "message": "Тип отходов не найден",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Ошибка (409):**

```json
{
  "success": false,
  "message": "Тип отходов с таким названием уже существует",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Удаление типа отходов

**DELETE** `/waste-types/:id`

**Авторизация:** Требуется (только для администраторов)

**Параметры пути:**
- `id` (UUID) - ID типа отходов

**Успешный ответ (200):**

```json
{
  "success": true,
  "message": "Тип отходов успешно удален"
}
```

**Ошибка (400):**

```json
{
  "success": false,
  "message": "Невозможно удалить тип отходов, так как он используется в заявках",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Ошибка (404):**

```json
{
  "success": false,
  "message": "Тип отходов не найден",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Пример запроса (Flutter):**

```dart
Future<void> deleteWasteType(String id) async {
  final token = await getToken();
  final response = await http.delete(
    Uri.parse('$baseUrl/waste-types/$id'),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    },
  );

  if (response.statusCode != 200) {
    throw Exception('Ошибка удаления типа отходов: ${response.body}');
  }
}
```

### Начальные типы отходов

После создания таблицы в базе данных автоматически добавляются следующие типы отходов:

**Обычные типы (danger: false):**
- `plastic` - Пластик
- `glass` - Стекло
- `paper` - Бумага
- `cardboard` - Картон
- `metal` - Металл
- `organic` - Органические отходы
- `tires` - Шины
- `liquid` - Жидкие отходы
- `furniture` - Мебель
- `construction` - Строительные отходы
- `household waste` - Бытовые отходы
- `bottles and cans` - Бутылки и банки

**Опасные типы (danger: true):**
- `electronic` - Электроника
- `toxic` - Токсичные отходы
- `dead animals` - Мертвые животные

### Важные замечания

1. **Публичный доступ:** GET эндпоинты доступны без авторизации, так как типы отходов используются в публичных формах создания заявок.

2. **Административный доступ:** POST, PUT, DELETE эндпоинты доступны только администраторам.

3. **Валидация:** 
   - `name` обязателен и должен быть уникальным
   - `name` автоматически преобразуется в нижний регистр
   - `danger` по умолчанию false

4. **Безопасность удаления:** При удалении типа отходов проверяется, не используется ли он в существующих заявках. Если используется - удаление запрещено.

5. **Формат дат:** Все даты в формате ISO 8601: `2024-01-01T00:00:00.000Z`

---

## 🔔 Push-уведомления

Сервер автоматически отправляет push-уведомления пользователям через Firebase Cloud Messaging (FCM) при различных событиях в приложении. Все уведомления отправляются асинхронно и не блокируют ответы API.

### Автоматические уведомления

#### 1. При создании заявки

Когда пользователь создает новую заявку с координатами, сервер автоматически отправляет push-уведомления всем пользователям в радиусе **10 км** от места заявки.

**Триггер:** `POST /api/requests` (создание заявки с `latitude` и `longitude`)

**Получатели:** Все пользователи в радиусе 10 км (кроме создателя заявки)

**Формат уведомления:**
- **Заголовок:** `New {Category}` (например, "New Waste Location", "New Speed Clean-up", "New Event")
- **Текст:** `{Название заявки}\nCreated by: {Имя создателя}`
- **Изображение:** Первое фото заявки (если есть)
- **Deeplink:** Переход на страницу деталей заявки

**Пример:**
```
Title: New Waste Location
Body: Уборка парка
Created by: Иван Иванов
```

#### 2. При присоединении к заявке

Когда пользователь присоединяется к заявке типа `wasteLocation`, создатель заявки получает уведомление.

**Триггер:** `POST /api/requests/:id/join`

**Получатель:** Создатель заявки (если это не тот же пользователь)

**Формат уведомления:**
- **Заголовок:** `Someone joined your request`
- **Текст:** `{Имя пользователя} joined your request "{Название заявки}"`
- **Deeplink:** Переход на страницу деталей заявки

**Пример:**
```
Title: Someone joined your request
Body: Петр Петров joined your request "Уборка парка"
```

#### 3. При участии в событии

Когда пользователь присоединяется к событию (event), создатель события получает уведомление.

**Триггер:** `POST /api/requests/:id/participate`

**Получатель:** Создатель события (если это не тот же пользователь)

**Формат уведомления:**
- **Заголовок:** `Someone joined your event`
- **Текст:** `{Имя пользователя} joined your event "{Название события}"`
- **Deeplink:** Переход на страницу деталей события

**Пример:**
```
Title: Someone joined your event
Body: Мария Сидорова joined your event "Экологический субботник"
```

#### 4. При донате

Когда пользователь делает донат на заявку, создатель заявки получает уведомление с информацией о сумме и донаторе.

**Триггер:** `POST /api/donations`

**Получатель:** Создатель заявки (если это не тот же пользователь)

**Формат уведомления:**
- **Заголовок:** `Someone donated to your request`
- **Текст:** `{Имя донатора} donated ${Сумма} to your request "{Название заявки}"`
- **Deeplink:** Переход на страницу деталей заявки

**Пример:**
```
Title: Someone donated to your request
Body: Алексей Смирнов donated $25.00 to your request "Уборка парка"
```

### Ручная отправка уведомлений (только для админов)

Администраторы могут отправлять push-уведомления конкретным пользователям через специальный эндпоинт.

#### Отправка уведомлений пользователям

**Эндпоинт:** `POST /api/notifications/send`

**Требования:**
- Аутентификация: Да (только админы)
- Метод: `POST`
- Content-Type: `application/json`

**Тело запроса:**

```json
{
  "title": "Заголовок уведомления",
  "body": "Текст уведомления",
  "user_ids": [
    "353f958d-8796-44c7-a877-3e376eca6784",
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  ],
  "image_url": "https://example.com/image.jpg",  // Опционально
  "sound": "default",  // Опционально, по умолчанию "default"
  "data": {  // Опционально, дополнительные данные для навигации
    "initialPageName": "SomePage",
    "parameterData": "{\"key\":\"value\"}",
    "deeplink": "https://garbagedev-9c240.web.app/some/page"
  }
}
```

**Параметры:**

| Параметр | Тип | Обязательное | Описание |
|----------|-----|--------------|----------|
| `title` | string | Да | Заголовок уведомления |
| `body` | string | Да | Текст уведомления |
| `user_ids` | array[string] | Да | Массив UUID пользователей-получателей (минимум 1) |
| `image_url` | string | Нет | URL изображения для уведомления |
| `sound` | string | Нет | Звук уведомления (по умолчанию "default") |
| `data` | object | Нет | Дополнительные данные для навигации в приложении |

**Успешный ответ (200):**

```json
{
  "success": true,
  "message": "Отправлено 2 из 2 уведомлений",
  "data": {
    "sent": 2,
    "failed": 0,
    "total": 2
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Ответ с частичной отправкой (200):**

Если хотя бы одно уведомление отправилось успешно, возвращается `200`:

```json
{
  "success": true,
  "message": "Отправлено 1 из 2 уведомлений",
  "data": {
    "sent": 1,
    "failed": 1,
    "total": 2
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Ошибка отправки (400):**

Если **ни одно** уведомление не отправилось, возвращается ошибка `400`:

```json
{
  "success": false,
  "message": "Не удалось отправить уведомления: у пользователей нет FCM токенов",
  "data": {
    "sent": 0,
    "failed": 1,
    "total": 1,
    "reason": "У пользователей отсутствуют FCM токены. Пользователи без токенов: user@example.com"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Примеры причин ошибок в поле `reason`:**

- `"У пользователей отсутствуют FCM токены. Пользователи без токенов: user@example.com"` - у указанных пользователей нет FCM токенов
- `"У пользователей отсутствуют FCM токены. Пользователи не найдены: uuid1, uuid2"` - указанные пользователи не найдены в БД
- `"Токен abc123...: messaging/invalid-registration-token - Invalid registration token"` - токен невалиден
- `"Ошибка при отправке через FCM: Network error"` - ошибка сети при отправке

**Ошибки:**

- `400` - Ошибка валидации (неверные параметры) или ошибка отправки уведомлений
  - Если у пользователей нет FCM токенов или все уведомления не отправились, возвращается `400` с детальной информацией:
  ```json
  {
    "success": false,
    "message": "Не удалось отправить уведомления: у пользователей нет FCM токенов",
    "data": {
      "sent": 0,
      "failed": 1,
      "total": 1,
      "reason": "У пользователей отсутствуют FCM токены. Пользователи без токенов: user@example.com"
    }
  }
  ```
- `401` - Не авторизован
- `403` - Доступ запрещен (не админ)
- `500` - Ошибка сервера

**Важно:**
- Если **ни одно** уведомление не отправилось (`sent: 0`), API возвращает ошибку **400** (не 200)
- В поле `reason` содержится детальная информация о причине ошибки:
  - Если пользователи не найдены в БД
  - Если у пользователей отсутствуют FCM токены (с указанием email пользователей)
  - Если токены невалидны (с кодами ошибок FCM)
- Если хотя бы одно уведомление отправилось успешно, возвращается `200` с информацией о количестве отправленных и неудачных уведомлений

**Пример запроса (Flutter):**

```dart
Future<Map<String, dynamic>> sendNotificationToUsers({
  required String title,
  required String body,
  required List<String> userIds,
  String? imageUrl,
  Map<String, dynamic>? data,
}) async {
  final token = await getToken();
  final response = await http.post(
    Uri.parse('$baseUrl/notifications/send'),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    },
    body: jsonEncode({
      'title': title,
      'body': body,
      'user_ids': userIds,
      if (imageUrl != null) 'image_url': imageUrl,
      if (data != null) 'data': data,
    }),
  );

  final data = jsonDecode(response.body);
  
  if (response.statusCode == 200) {
    return data;
  } else if (response.statusCode == 400) {
    // Детальная информация об ошибке
    final reason = data['data']?['reason'] ?? 'Неизвестная ошибка';
    throw Exception('Ошибка отправки уведомлений: ${data['message']}. Причина: $reason');
  } else {
    throw Exception('Ошибка отправки уведомлений: ${response.body}');
  }
}
```

### Технические детали

#### FCM токены

- FCM токены хранятся в поле `fcm_token` таблицы `users`
- Токены обновляются при обновлении профиля пользователя через `PUT /api/users/:id`
- Невалидные токены автоматически логируются (в будущем можно добавить автоматическое удаление)

#### Отправка батчами

- Уведомления отправляются батчами по **500 токенов** (лимит FCM)
- При большом количестве получателей уведомления отправляются параллельно

#### Обработка ошибок

- **Для ручной отправки (`POST /api/notifications/send`):**
  - Если **ни одно** уведомление не отправилось, возвращается ошибка **400** (не 200)
  - В ответе содержится детальная информация о причине ошибки в поле `reason`:
    - Если пользователи не найдены в БД - указываются их ID
    - Если у пользователей нет FCM токенов - указываются email пользователей без токенов
    - Если токены невалидны - указываются коды ошибок FCM (например: `messaging/invalid-registration-token`)
  - Если хотя бы одно уведомление отправилось успешно, возвращается `200` с информацией о количестве отправленных и неудачных уведомлений

- **Для автоматических уведомлений:**
  - Все ошибки отправки логируются, но не прерывают основной процесс
  - Если у пользователя нет FCM токена, уведомление просто пропускается
  - Невалидные токены логируются для последующей очистки

#### Проверка наличия токенов

При ручной отправке уведомлений сервер автоматически проверяет:
1. Существуют ли указанные пользователи в БД
2. Есть ли у них FCM токены
3. Валидны ли токены при отправке через FCM

Если токены отсутствуют или невалидны, в ответе указывается конкретная причина для каждого случая.

#### Deeplink формат

Все автоматические уведомления содержат deeplink для перехода на соответствующую страницу:

```
https://garbagedev-9c240.web.app/request/{category_path}/{request_id}
```

Где `category_path`:
- `waste_location` - для заявок типа `wasteLocation`
- `speed_cleanup` - для заявок типа `speedCleanup`
- `event` - для заявок типа `event`

#### Радиус уведомлений

- При создании заявки уведомления отправляются пользователям в радиусе **10 км**
- Радиус рассчитывается по формуле Haversine (расстояние по поверхности Земли)
- Учитываются только пользователи с заполненными координатами (`latitude`, `longitude`)

### Примечания

1. **Асинхронная отправка:** Все push-уведомления отправляются асинхронно и не блокируют ответы API
2. **Проверка на дубликаты:** Уведомления не отправляются самому себе (создатель заявки не получит уведомление о своем донате/присоединении)
3. **Отсутствие токенов:** Если у пользователя нет FCM токена, уведомление просто пропускается
4. **Логирование:** Все операции отправки логируются для отладки
5. **Масштабируемость:** Система поддерживает отправку уведомлений тысячам пользователей одновременно

---

## 📱 Примеры для Flutter

### Класс для работы с API

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class ApiService {
  final String baseUrl = 'http://autogie1.bget.ru/api';
  final FlutterSecureStorage _storage = FlutterSecureStorage();

  // Получение токена
  Future<String?> getToken() async {
    return await _storage.read(key: 'auth_token');
  }

  // Сохранение токена
  Future<void> saveToken(String token) async {
    await _storage.write(key: 'auth_token', value: token);
  }

  // Удаление токена
  Future<void> deleteToken() async {
    await _storage.delete(key: 'auth_token');
  }

  // Базовый метод для запросов
  Future<Map<String, dynamic>> _request(
    String method,
    String endpoint, {
    Map<String, dynamic>? body,
    bool requiresAuth = false,
  }) async {
    final uri = Uri.parse('$baseUrl$endpoint');
    final headers = {
      'Content-Type': 'application/json',
    };

    if (requiresAuth) {
      final token = await getToken();
      if (token != null) {
        headers['Authorization'] = 'Bearer $token';
      }
    }

    http.Response response;
    switch (method.toUpperCase()) {
      case 'GET':
        response = await http.get(uri, headers: headers);
        break;
      case 'POST':
        response = await http.post(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      case 'PUT':
        response = await http.put(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      case 'DELETE':
        response = await http.delete(uri, headers: headers);
        break;
      default:
        throw Exception('Unsupported method: $method');
    }

    final data = jsonDecode(response.body);
    
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return data;
    } else {
      throw Exception(data['message'] ?? 'Ошибка запроса');
    }
  }

  // Регистрация
  Future<Map<String, dynamic>> register({
    required String email,
    required String password,
    String? display_name,
  }) async {
    final response = await _request('POST', '/auth/register', body: {
      'email': email,
      'password': password,
      'display_name': display_name,
    });
    
    if (response['success'] == true) {
      final token = response['data']['token'];
      await saveToken(token);
    }
    
    return response;
  }

  // Вход
  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    final response = await _request('POST', '/auth/login', body: {
      'email': email,
      'password': password,
    });
    
    if (response['success'] == true) {
      final token = response['data']['token'];
      await saveToken(token);
    }
    
    return response;
  }

  // Получение текущего пользователя
  Future<Map<String, dynamic>> getCurrentUser() async {
    return await _request('GET', '/auth/me', requiresAuth: true);
  }

  // Получение списка заявок
  Future<Map<String, dynamic>> getRequests({
    int page = 1,
    int limit = 20,
    String? category,
    String? city,
    double? latitude,
    double? longitude,
    int? radius,
  }) async {
    final queryParams = <String, String>{
      'page': page.toString(),
      'limit': limit.toString(),
    };
    
    if (category != null) queryParams['category'] = category;
    if (city != null) queryParams['city'] = city;
    if (latitude != null) queryParams['latitude'] = latitude.toString();
    if (longitude != null) queryParams['longitude'] = longitude.toString();
    if (radius != null) queryParams['radius'] = radius.toString();

    final queryString = Uri(queryParameters: queryParams).query;
    return await _request('GET', '/requests?$queryString');
  }

  // Создание заявки
  Future<Map<String, dynamic>> createRequest({
    required String category,
    required String name,
    String? description,
    double? latitude,
    double? longitude,
    String? city,
    List<String>? photos,
    List<String>? waste_types,
  }) async {
    return await _request('POST', '/requests', body: {
      'category': category,
      'name': name,
      'description': description,
      'latitude': latitude,
      'longitude': longitude,
      'city': city,
      'photos': photos ?? [],
      'waste_types': waste_types ?? [],
    }, requiresAuth: true);
  }

  // Присоединение к заявке
  Future<Map<String, dynamic>> joinRequest(String requestId) async {
    return await _request('POST', '/requests/$requestId/join', requiresAuth: true);
  }

  // Участие в событии
  Future<Map<String, dynamic>> participateInEvent(String requestId) async {
    return await _request('POST', '/requests/$requestId/participate', requiresAuth: true);
  }

  // Создание доната
  Future<Map<String, dynamic>> createDonation({
    required String requestId,
    required int amount,
    required String paymentIntentId,
  }) async {
    return await _request('POST', '/donations', body: {
      'requestId': requestId,
      'amount': amount,
      'paymentIntentId': paymentIntentId,
    }, requiresAuth: true);
  }
}
```

---

## ⏰ Cron задачи (только для админов)

Cron задачи выполняются автоматически через `node-cron` при запуске сервера. Администраторы могут проверять статус и запускать задачи вручную через API.

### Проверка статуса cron задач

**GET** `/api/cron/status`

**Требует аутентификации и прав администратора**

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "status": "running",
    "isRunning": true,
    "lastRun": "2025-11-28T14:11:20.278Z",
    "hoursSinceLastRun": 0.5,
    "lastRunInfo": {
      "lastRun": "2025-11-28T14:11:20.278Z",
      "results": {
        "autoCompleteSpeedCleanup": {
          "processed": 0,
          "errors": 0
        }
      },
      "status": "success"
    },
    "fileExists": true,
    "message": "Cron задачи работают нормально"
  }
}
```

**Статусы:**
- `running` - последний запуск был менее 2 часов назад (cron работает нормально)
- `warning` - последний запуск был 2-24 часа назад (возможно, cron не работает)
- `stopped` - последний запуск был более 24 часов назад (cron не работает)
- `never_run` - cron задачи еще не запускались

**Ошибка (403):**
```json
{
  "success": false,
  "message": "Доступ запрещен"
}
```

---

### Ручной запуск cron задач

**POST** `/api/cron/run`

**Требует аутентификации и прав администратора**

**Ответ (200):**
```json
{
  "success": true,
  "data": {
    "message": "Cron задачи запущены",
    "note": "Задачи выполняются в фоновом режиме. Проверьте статус через /api/cron/status"
  }
}
```

**Примечание:** Задачи запускаются асинхронно в фоновом режиме. Для проверки результатов используйте `/api/cron/status`.

---

### Текущие cron задачи

1. **autoCompleteSpeedCleanup** - автоматический перевод `speedCleanup` заявок в `completed` через 24 часа после `end_date`
   - Начисление коинов донатерам
   - Отправка push-уведомлений донатерам
   - Перенос донатеров из `request_contributors` в `donations`

**Расписание:** По умолчанию каждые 5 минут (для тестирования). Для продакшена измените в `.env`:
```env
CRON_SCHEDULE=0 * * * *  # Каждый час
```

---

## Коды ошибок

- `200` - Успешно
- `201` - Создано
- `400` - Ошибка валидации
- `401` - Не авторизован
- `403` - Доступ запрещен
- `404` - Не найдено
- `409` - Конфликт (например, уже существует)
- `500` - Ошибка сервера

---

## Формат ошибок

Все ошибки возвращаются в формате JSON с детальной информацией для локализации проблемы.

### Ошибка валидации (400)

```json
{
  "success": false,
  "message": "Ошибка валидации",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "errors": [
    {
      "msg": "Некорректный email",
      "param": "email",
      "location": "body"
    },
    {
      "msg": "Пароль должен быть не менее 6 символов",
      "param": "password",
      "location": "body"
    }
  ]
}
```

### Ошибка базы данных (400/500)

```json
{
  "success": false,
  "message": "Ошибка базы данных: Duplicate entry 'user@example.com' for key 'email'",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "errorDetails": {
    "code": "ER_DUP_ENTRY",
    "sqlMessage": "Duplicate entry 'user@example.com' for key 'email'",
    "sql": "INSERT INTO users ...",
    "message": "Запись с такими данными уже существует"
  }
}
```

### Общая ошибка сервера (500)

**В режиме разработки (NODE_ENV !== 'production'):**
```json
{
  "success": false,
  "message": "Внутренняя ошибка сервера: Cannot read property 'id' of undefined",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "error": "Cannot read property 'id' of undefined",
  "name": "TypeError",
  "errorDetails": {
    "code": undefined,
    "name": "TypeError",
    "sql": null,
    "sqlMessage": null,
    "message": "Cannot read property 'id' of undefined"
  },
  "stack": "TypeError: Cannot read property 'id' of undefined\n    at ..."
}
```

**В продакшене:**
```json
{
  "success": false,
  "message": "Внутренняя ошибка сервера",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "error": "Cannot read property 'id' of undefined",
  "name": "TypeError",
  "errorDetails": {
    "message": "Детали ошибки доступны только в режиме разработки"
  }
}
```

### Ошибка авторизации (401)

```json
{
  "success": false,
  "message": "Неверный email или пароль",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Ошибка JWT токена (401)

```json
{
  "success": false,
  "message": "Недействительный токен",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

или

```json
{
  "success": false,
  "message": "Токен истёк",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Ошибка 404 (Маршрут не найден)

```json
{
  "success": false,
  "message": "Маршрут POST /api/auth/invalid не найден",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Структура полей ошибки

| Поле | Тип | Описание |
|------|-----|----------|
| `success` | boolean | Всегда `false` для ошибок |
| `message` | string | Понятное сообщение об ошибке на русском языке |
| `timestamp` | string | ISO 8601 формат времени ошибки |
| `errors` | array | Массив ошибок валидации (только для 400) |
| `errorDetails` | object | Детальная информация об ошибке (код, SQL и т.д.) |
| `error` | string | Текст ошибки (для разработки) |
| `name` | string | Тип ошибки (TypeError, Error и т.д.) |
| `stack` | string | Stack trace (только в режиме разработки) |

### Коды ошибок базы данных

| Код | Описание | HTTP код |
|-----|----------|----------|
| `ER_DUP_ENTRY` | Дублирующаяся запись (уникальное поле) | 409 |
| `ER_NO_REFERENCED_ROW_2` | Ссылка на несуществующую запись (FOREIGN KEY) | 400 |
| `ER_ROW_IS_REFERENCED_2` | Невозможно удалить, есть ссылки | 400 |
| `ER_BAD_FIELD_ERROR` | Неизвестное поле в таблице | 400 |
| `ER_NO_SUCH_TABLE` | Таблица не существует | 500 |
| `ER_PARSE_ERROR` | Ошибка синтаксиса SQL | 500 |

### Примеры обработки ошибок на Flutter

```dart
try {
  final response = await dio.post(
    '$baseUrl/auth/register',
    data: {'email': email, 'password': password},
  );
  
  if (response.data['success'] == true) {
    // Успех
    return response.data['data'];
  } else {
    // Ошибка
    throw Exception(response.data['message']);
  }
} on DioException catch (e) {
  if (e.response != null) {
    final errorData = e.response!.data;
    
    // Ошибка валидации
    if (e.response!.statusCode == 400 && errorData['errors'] != null) {
      final errors = errorData['errors'] as List;
      final errorMessages = errors.map((e) => e['msg']).join(', ');
      throw Exception('Ошибка валидации: $errorMessages');
    }
    
    // Ошибка базы данных
    if (errorData['errorDetails'] != null) {
      final details = errorData['errorDetails'];
      final code = details['code'];
      final sqlMessage = details['sqlMessage'];
      
      if (code == 'ER_DUP_ENTRY') {
        throw Exception('Пользователь с таким email уже существует');
      }
      
      // Логируем детали для отладки
      print('❌ DB Error: $code - $sqlMessage');
      throw Exception(errorData['message'] ?? 'Ошибка базы данных');
    }
    
    // Общая ошибка
    throw Exception(errorData['message'] ?? 'Произошла ошибка');
  } else {
    throw Exception('Ошибка сети: ${e.message}');
  }
}
```

### Логирование ошибок на сервере

Все ошибки логируются на сервере с полной информацией:

```
❌ Ошибка регистрации: ER_BAD_FIELD_ERROR: Unknown column 'email_verified' in 'field list'
❌ Stack trace: Error: ER_BAD_FIELD_ERROR: Unknown column 'email_verified' in 'field list'
    at PoolConnection.query ...
```

Это помогает быстро локализовать проблему при разработке.

---

## 🏥 Проверка здоровья сервера

### Статус сервера

**GET** `/health`

**Ответ (200):**
```json
{
  "success": true,
  "message": "Сервер работает",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Статус базы данных

**GET** `/api/health/db`

**Ответ (200):**
```json
{
  "success": true,
  "database": "connected",
  "databaseVersion": "8.0.0"
}
```

**Ошибка (500):**
```json
{
  "success": false,
  "database": "disconnected",
  "error": "Error message"
}
```

---

## Настройка Email

Для работы верификации email необходимо настроить отправку email. Поддерживаются следующие способы:

### Способ 1: SMTP (Gmail, Outlook, Yandex и т.д.)

Добавьте в `.env`:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=your-email@gmail.com
APP_NAME=Joy Pick
```

**Для Gmail:**
- Используйте "Пароль приложения" вместо обычного пароля
- Включите двухфакторную аутентификацию
- Создайте пароль приложения: https://myaccount.google.com/apppasswords

### Способ 2: Gmail OAuth2

```env
GMAIL_USER=your-email@gmail.com
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token
EMAIL_FROM=your-email@gmail.com
APP_NAME=Joy Pick
```

### Способ 3: SendGrid

```env
SENDGRID_API_KEY=your-sendgrid-api-key
EMAIL_FROM=noreply@yourdomain.com
APP_NAME=Joy Pick
```

### Способ 4: Mailgun

```env
MAILGUN_SMTP_USER=your-mailgun-smtp-user
MAILGUN_SMTP_PASS=your-mailgun-smtp-password
EMAIL_FROM=noreply@yourdomain.com
APP_NAME=Joy Pick
```

**Примечание:** Если email не настроен, регистрация будет работать, но код верификации не будет отправляться. Пользователь все равно сможет зарегистрироваться, но `email_verified` останется `false`.

---

## Примечания

1. Все даты в формате ISO 8601: `2024-01-01T00:00:00.000Z`
2. Суммы денег в центах (1000 = 10.00 USD)
3. Координаты: `latitude` (широта), `longitude` (долгота)
4. Радиус поиска в метрах
5. Токен JWT действителен 7 дней (по умолчанию)
6. При истечении токена получите новый через `/auth/refresh`
7. Базовый URL: `http://autogie1.bget.ru`
8. **Верификация email:** После регистрации автоматически отправляется код верификации (6 цифр), действителен 10 минут

