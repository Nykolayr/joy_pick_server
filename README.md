# Joy Pick Server API

API сервер для приложения Joy Pick на Node.js с MySQL базой данных.

## 📋 Содержание

- [Установка](#установка)
- [Настройка](#настройка)
- [База данных](#база-данных)
- [Запуск](#запуск)
- [API Эндпоинты](#api-эндпоинты)
- [Аутентификация](#аутентификация)

## 🚀 Установка

### Локальная разработка

1. Установите зависимости:
```bash
npm install
```

2. Скопируйте файл `.env.example` в `.env`:
```bash
cp .env.example .env
```

3. Настройте переменные окружения в файле `.env`

4. Запустите сервер:
```bash
npm start
# или для разработки с автоперезагрузкой
npm run dev
```

### Развертывание на Beget

См. подробную инструкцию в файле [DEPLOYMENT.md](DEPLOYMENT.md)

## ⚙️ Настройка

Отредактируйте файл `.env`:

```env
# Настройки сервера
PORT=3000
NODE_ENV=development

# Настройки базы данных MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=autogie1_joypick
DB_PASSWORD=tvU29B%rm%VC
DB_NAME=autogie1_joypick

# JWT секретный ключ (обязательно измените!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# CORS настройки
CORS_ORIGIN=*
```

## 🗄️ База данных

### Создание таблиц

1. Откройте phpMyAdmin на вашем сервере Beget
2. Выберите базу данных `autogie1_joypick`
3. Перейдите на вкладку "SQL"
4. Скопируйте содержимое файла `database/schema.sql`
5. Вставьте SQL скрипт и выполните его

Или выполните через командную строку:
```bash
mysql -u autogie1_joypick -p autogie1_joypick < database/schema.sql
```

### Структура базы данных

База данных включает следующие таблицы:
- `users` - Пользователи
- `requests` - Заявки (wasteLocation, speedCleanup, event)
- `request_photos` - Фотографии заявок
- `request_participants` - Участники событий
- `request_contributors` - Вкладчики
- `donations` - Донаты
- `members` - Участники (для совместимости)
- `partners` - Партнеры
- `partner_photos` - Фотографии партнеров
- `partner_types` - Типы партнеров
- `user_completed_requests` - Завершенные заявки
- `request_metadata` - Метаданные заявок

## 🏃 Запуск

### Режим разработки
```bash
npm run dev
```

### Продакшн режим
```bash
npm start
```

Сервер будет доступен по адресу: `http://localhost:3000`

## 📡 API Эндпоинты

### Аутентификация

#### POST `/api/auth/register`
Регистрация нового пользователя

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

**Ответ:**
```json
{
  "success": true,
  "message": "Пользователь успешно зарегистрирован",
  "data": {
    "user": { ... },
    "token": "jwt_token_here"
  }
}
```

#### POST `/api/auth/login`
Вход пользователя

**Тело запроса:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### GET `/api/auth/me`
Получение данных текущего пользователя (требует аутентификации)

#### POST `/api/auth/refresh`
Обновление токена (требует аутентификации)

### Пользователи

#### GET `/api/users`
Получение списка пользователей (только для админов)

**Query параметры:**
- `page` - номер страницы (по умолчанию 1)
- `limit` - количество на странице (по умолчанию 20)
- `search` - поиск по email, имени

#### GET `/api/users/:id`
Получение пользователя по ID

#### PUT `/api/users/:id`
Обновление данных пользователя

#### PUT `/api/users/:id/jcoins`
Обновление Joycoins (только для админов)

#### DELETE `/api/users/:id`
Удаление пользователя (только для админов)

### Заявки (Requests)

#### GET `/api/requests`
Получение списка заявок

**Query параметры:**
- `page`, `limit` - пагинация
- `category` - фильтр по категории (wasteLocation, speedCleanup, event)
- `status` - фильтр по статусу (pending, approved, rejected, archived)
- `city` - фильтр по городу
- `latitude`, `longitude`, `radius` - фильтр по радиусу
- `isOpen` - фильтр по открытости
- `userId`, `createdBy`, `takenBy` - фильтры по пользователям

#### GET `/api/requests/:id`
Получение заявки по ID

#### POST `/api/requests`
Создание новой заявки (требует аутентификации)

**Тело запроса:**
```json
{
  "category": "wasteLocation",
  "name": "Название заявки",
  "description": "Описание",
  "latitude": 55.7558,
  "longitude": 37.6173,
  "city": "Москва",
  "garbageSize": 1,
  "onlyFoot": false,
  "possibleByCar": true,
  "cost": 1000,
  "wasteTypes": ["plastic", "glass"],
  "photos": ["url1", "url2"],
  "photosBefore": ["url1"],
  "photosAfter": ["url2"]
}
```

#### PUT `/api/requests/:id`
Обновление заявки (только создатель или админ)

#### DELETE `/api/requests/:id`
Удаление заявки (только создатель или админ)

#### POST `/api/requests/:id/join`
Присоединение к заявке типа wasteLocation (требует аутентификации)

#### POST `/api/requests/:id/participate`
Участие в событии (event) (требует аутентификации)

#### DELETE `/api/requests/:id/participate`
Отмена участия в событии (требует аутентификации)

### Донаты

#### GET `/api/donations`
Получение списка донатов (требует аутентификации)

**Query параметры:**
- `page`, `limit` - пагинация
- `requestId` - фильтр по заявке
- `userId` - фильтр по пользователю

#### GET `/api/donations/:id`
Получение доната по ID (требует аутентификации)

#### POST `/api/donations`
Создание доната (требует аутентификации)

**Тело запроса:**
```json
{
  "requestId": "request_id",
  "amount": 1000,
  "paymentIntentId": "pi_xxx"
}
```

### Участники

#### GET `/api/participants`
Получение списка участников заявки

**Query параметры:**
- `requestId` - ID заявки (обязательно)

#### GET `/api/participants/contributors`
Получение списка вкладчиков заявки

**Query параметры:**
- `requestId` - ID заявки (обязательно)

### Партнеры

#### GET `/api/partners`
Получение списка партнеров

**Query параметры:**
- `page`, `limit` - пагинация
- `city` - фильтр по городу
- `latitude`, `longitude`, `radius` - фильтр по радиусу

#### GET `/api/partners/:id`
Получение партнера по ID

#### POST `/api/partners`
Создание партнера (только для админов)

#### PUT `/api/partners/:id`
Обновление партнера (только для админов)

#### DELETE `/api/partners/:id`
Удаление партнера (только для админов)

## 🔐 Аутентификация

API использует JWT (JSON Web Tokens) для аутентификации.

### Использование токена

Добавьте заголовок `Authorization` в запросы:
```
Authorization: Bearer <your_jwt_token>
```

### Формат токена

Токен содержит следующую информацию:
```json
{
  "userId": "user_id",
  "email": "user@example.com",
  "uid": "unique_uid",
  "isAdmin": false
}
```

## 📝 Формат ответов

### Успешный ответ
```json
{
  "success": true,
  "message": "Сообщение",
  "data": { ... }
}
```

### Ответ с ошибкой
```json
{
  "success": false,
  "message": "Сообщение об ошибке",
  "errors": [ ... ] // опционально
}
```

## 🛠️ Разработка

### Структура проекта

```
joy_pick_server/
├── server.js               # Главный файл сервера (точка входа)
├── .htaccess              # Конфигурация Phusion Passenger (для Beget)
├── .env                   # Настройки (не коммитить!)
├── .env.example           # Пример конфигурации
├── package.json           # Зависимости
├── database/
│   └── schema.sql         # SQL скрипт для создания таблиц
├── src/
│   ├── config/
│   │   └── database.js    # Конфигурация БД
│   ├── middleware/
│   │   └── auth.js       # Middleware аутентификации
│   ├── routes/
│   │   ├── auth.js       # Роуты аутентификации
│   │   ├── users.js      # Роуты пользователей
│   │   ├── requests.js   # Роуты заявок
│   │   ├── donations.js  # Роуты донатов
│   │   ├── participants.js # Роуты участников
│   │   └── partners.js   # Роуты партнеров
│   └── utils/
│       ├── jwt.js        # Утилиты JWT
│       ├── uuid.js       # Генерация UUID
│       └── response.js   # Форматирование ответов
├── tmp/                   # Папка для перезапуска сервера
│   └── restart.txt       # Файл для перезапуска через Passenger
└── README.md             # Документация
```

### Развертывание

Проект развертывается на Beget через FTP с использованием Phusion Passenger. Подробная инструкция в [DEPLOYMENT.md](DEPLOYMENT.md).

## 🔒 Безопасность

- Все пароли хешируются с помощью bcrypt
- JWT токены имеют срок действия
- Валидация всех входящих данных
- Проверка прав доступа для операций

## 📞 Поддержка

Если у вас возникли вопросы или проблемы, создайте issue в репозитории проекта.

