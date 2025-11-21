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

---

## 🔐 Аутентификация

### Регистрация

**POST** `/auth/register`

**Тело запроса:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "Имя пользователя",
  "firstName": "Имя",
  "secondName": "Фамилия",
  "phoneNumber": "+1234567890",
  "city": "Москва",
  "country": "Россия",
  "gender": "male"
}
```

**Ответ (201):**
```json
{
  "success": true,
  "message": "Пользователь успешно зарегистрирован",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Имя пользователя",
      "uid": "uuid",
      "created_time": "2024-01-01T00:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Пример для Flutter:**
```dart
final response = await http.post(
  Uri.parse('$baseUrl/auth/register'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'email': email,
    'password': password,
    'displayName': displayName,
  }),
);
final data = jsonDecode(response.body);
final token = data['data']['token'];
// Сохраните токен в secure storage
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

## 👤 Пользователи

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

**Тело запроса:**
```json
{
  "displayName": "Новое имя",
  "firstName": "Имя",
  "secondName": "Фамилия",
  "phoneNumber": "+1234567890",
  "city": "Санкт-Петербург",
  "country": "Россия",
  "gender": "female",
  "photoUrl": "https://example.com/photo.jpg",
  "latitude": 59.9343,
  "longitude": 30.3351,
  "fcmToken": "fcm_token_here"
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
- `isOpen` (boolean) - фильтр по открытости
- `userId` (string) - фильтр по пользователю
- `createdBy` (string) - фильтр по создателю
- `takenBy` (string) - фильтр по исполнителю

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

**Тело запроса:**
```json
{
  "category": "wasteLocation",
  "name": "Название заявки",
  "description": "Описание заявки",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "garbageSize": 1,
  "onlyFoot": false,
  "possibleByCar": true,
  "cost": 1000,
  "rewardAmount": null,
  "startDate": null,
  "endDate": null,
  "status": "pending",
  "priority": "medium",
  "wasteTypes": ["plastic", "glass"],
  "photos": ["https://example.com/photo1.jpg", "https://example.com/photo2.jpg"],
  "photosBefore": [],
  "photosAfter": [],
  "targetAmount": null,
  "plantTree": false,
  "trashPickupOnly": false
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
  "garbageSize": 2,
  "rewardAmount": 50,
  "photosBefore": ["url1"],
  "photosAfter": ["url2"],
  "wasteTypes": ["plastic"]
}
```

**Для Event:**
```json
{
  "category": "event",
  "name": "Экологическое событие",
  "description": "Описание",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "startDate": "2024-02-01T10:00:00.000Z",
  "endDate": "2024-02-01T18:00:00.000Z",
  "plantTree": true,
  "photos": ["url1", "url2"]
}
```

**Ответ (201):**
```json
{
  "success": true,
  "message": "Заявка создана",
  "data": {
    "request": { /* созданная заявка */ }
  }
}
```

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
  "completionComment": "Заявка выполнена"
}
```

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
- `userId` - фильтр по пользователю

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
    String? displayName,
  }) async {
    final response = await _request('POST', '/auth/register', body: {
      'email': email,
      'password': password,
      'displayName': displayName,
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
    List<String>? wasteTypes,
  }) async {
    return await _request('POST', '/requests', body: {
      'category': category,
      'name': name,
      'description': description,
      'latitude': latitude,
      'longitude': longitude,
      'city': city,
      'photos': photos ?? [],
      'wasteTypes': wasteTypes ?? [],
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

```json
{
  "success": false,
  "message": "Сообщение об ошибке",
  "errors": [
    {
      "msg": "Ошибка валидации",
      "param": "email",
      "location": "body"
    }
  ]
}
```

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

## Примечания

1. Все даты в формате ISO 8601: `2024-01-01T00:00:00.000Z`
2. Суммы денег в центах (1000 = 10.00 USD)
3. Координаты: `latitude` (широта), `longitude` (долгота)
4. Радиус поиска в метрах
5. Токен JWT действителен 7 дней (по умолчанию)
6. При истечении токена получите новый через `/auth/refresh`
7. Базовый URL: `http://autogie1.bget.ru`

