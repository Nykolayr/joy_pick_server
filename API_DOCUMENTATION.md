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
      "email_verified": false,
      "created_time": "2024-01-01T00:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "verificationCodeSent": true,
    "message": "Пользователь успешно зарегистрирован. Код верификации отправлен на email."
  }
}
```

**Важно:**
- После регистрации автоматически отправляется код верификации на email (6 цифр)
- Код действителен в течение 10 минут
- Для подтверждения email используйте эндпоинт `POST /auth/verify-email`
- Если код не пришел, используйте `POST /auth/resend-verification` для повторной отправки

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

### Верификация email

**POST** `/auth/verify-email`

**Описание:**  
Проверка кода верификации, отправленного на email при регистрации.

**Тело запроса:**
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Ответ (200):**
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
Повторная отправка кода верификации на email. Используйте, если код не пришел или истек.

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
    "message": "Код верификации отправлен на email"
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
  "firstName": "Иван",      // опционально, рекомендуется для Apple Sign In при первом входе
  "secondName": "Иванов"    // опционально, рекомендуется для Apple Sign In при первом входе
}
```

**Примечание:**  
Поля `firstName` и `secondName` особенно полезны для Apple Sign In, так как Apple предоставляет `givenName` и `familyName` только при первом входе и они не сохраняются в Firebase User. Рекомендуется передавать их с фронта при первой авторизации через Apple.

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
  /// [firstName] и [secondName] - опциональны, рекомендуется для Apple Sign In
  /// при первом входе, так как Apple предоставляет эти данные только один раз
  Future<Map<String, dynamic>?> signInWithFirebase({
    String? firstName,
    String? secondName,
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
      if (firstName != null && firstName.isNotEmpty) {
        requestBody['firstName'] = firstName;
      }
      if (secondName != null && secondName.isNotEmpty) {
        requestBody['secondName'] = secondName;
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
  // Для Google firstName и secondName не обязательны - они будут распарсены из displayName
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
  firstName: appleFirstName,  // Передаем имя из Apple
  secondName: appleSecondName, // Передаем фамилию из Apple
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
- Передайте их в `signInWithFirebase(firstName: ..., secondName: ...)`
- Если не передать, сервер попытается распарсить `display_name`, но это менее надежно

**Важно для Apple Sign In:**
- Apple может не предоставить email при первом входе (пользователь может скрыть email)
- В этом случае сервер создаст пользователя с `email = null` или использует скрытый email от Apple
- При последующих входах email может быть предоставлен
- Сервер автоматически обновит email, если он станет доступен
- **`givenName` и `familyName` доступны только при первом входе** - передайте их в `firstName` и `secondName` для сохранения в базе данных

**Какие данные получаются автоматически:**

При первой авторизации сервер автоматически получает и сохраняет следующие данные:

**Из Firebase ID Token:**
- ✅ `uid` - Firebase UID (сохраняется как `uid` в базе)
- ✅ `email` - Email пользователя (может быть null для Apple)
- ✅ `name` - Полное имя (сохраняется как `display_name`)
- ✅ `picture` - URL фото (сохраняется как `photo_url`)
- ✅ `email_verified` - Подтвержден ли email

**Через Firebase Admin SDK (дополнительно):**
- ✅ `phoneNumber` - Номер телефона (если есть, сохраняется как `phone_number`)

**Автоматический парсинг:**
- ✅ `first_name` - Первое слово из `display_name` (если не передано с фронта)
- ✅ `second_name` - Остальные слова из `display_name` (если не передано с фронта)

**Рекомендуется передавать с фронта (особенно для Apple):**
- ✅ `firstName` - Имя пользователя (для Apple - из `appleCredential.givenName`)
- ✅ `secondName` - Фамилия пользователя (для Apple - из `appleCredential.familyName`)

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

**Способ 2: multipart/form-data с файлом**

**Content-Type:** `multipart/form-data`

**Поля формы:**
- `displayName` (string, опционально)
- `firstName` (string, опционально)
- `secondName` (string, опционально)
- `phoneNumber` (string, опционально)
- `city` (string, опционально)
- `country` (string, опционально)
- `gender` (string, опционально)
- `photo` (file, опционально) - файл аватара пользователя
- `latitude` (float, опционально)
- `longitude` (float, опционально)
- `fcmToken` (string, опционально)

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

**Способ 2: multipart/form-data с файлами (рекомендуется)**

**Content-Type:** `multipart/form-data`

**Поля формы:**
- `category` (string, обязательное) - категория заявки
- `name` (string, обязательное) - название заявки
- `description` (string, опционально) - описание
- `latitude` (float, опционально) - широта
- `longitude` (float, опционально) - долгота
- `city` (string, опционально) - город
- `garbageSize` (integer, опционально) - размер мусора
- `onlyFoot` (boolean, опционально) - только пешком
- `possibleByCar` (boolean, опционально) - доступно на машине
- `cost` (integer, опционально) - стоимость
- `rewardAmount` (integer, опционально) - размер награды
- `startDate` (string, опционально) - дата начала
- `endDate` (string, опционально) - дата окончания
- `status` (string, опционально) - статус (по умолчанию: "pending")
- `priority` (string, опционально) - приоритет (по умолчанию: "medium")
- `wasteTypes` (string, опционально) - типы отходов через запятую (например: "plastic,glass")
- `targetAmount` (integer, опционально) - целевая сумма
- `plantTree` (boolean, опционально) - посадить дерево
- `trashPickupOnly` (boolean, опционально) - только сбор мусора
- `photos` (file[], опционально) - массив файлов для основных фото
- `photosBefore` (file[], опционально) - массив файлов для фото "до"
- `photosAfter` (file[], опционально) - массив файлов для фото "после"

**Ограничения:**
- Максимальный размер файла: 10MB
- Разрешенные форматы: JPEG, PNG, GIF, WebP
- Максимум 10 файлов в каждом поле (photos, photosBefore, photosAfter)

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
  List<File>? photosBefore,
  List<File>? photosAfter,
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
  if (photosBefore != null) {
    for (var photo in photosBefore) {
      final fileStream = http.ByteStream(photo.openRead());
      final length = await photo.length();
      final multipartFile = http.MultipartFile(
        'photosBefore',
        fileStream,
        length,
        filename: path.basename(photo.path),
      );
      request.files.add(multipartFile);
    }
  }
  
  // Файлы - фото "после"
  if (photosAfter != null) {
    for (var photo in photosAfter) {
      final fileStream = http.ByteStream(photo.openRead());
      final length = await photo.length();
      final multipartFile = http.MultipartFile(
        'photosAfter',
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
  "partnerTypes": ["recycling", "store"]
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
- `partnerTypes` (string, опционально) - типы партнера через запятую

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
  "partnerTypes": ["recycling", "store"]
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
- `partnerTypes` (string, опционально) - типы партнера через запятую

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

