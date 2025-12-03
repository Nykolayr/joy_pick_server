# Обработка ошибок

## Критически важные правила

### НЕ предлагать проверку логов
- У пользователя **НЕТ** доступа к логам сервера
- **НИКОГДА** не предлагать проверить логи
- Все ошибки должны возвращаться в ответе API

### Использование функции error()

Всегда использовать функцию `error()` из `api/utils/response.js`:

```javascript
const { error } = require('../utils/response');

// Правильно - ВСЕГДА передавать err как 4-й параметр
try {
  // код
} catch (err) {
  return error(res, 'Ошибка при выполнении операции', 500, err);
}
```

### Структура ответа об ошибке

Все ошибки должны возвращаться в JSON ответе API с детальной информацией:

```json
{
  "success": false,
  "message": "Описание ошибки",
  "error": "Детальное сообщение об ошибке",
  "errorName": "Error",
  "errorCode": "ER_PARSE_ERROR",
  "sqlMessage": "You have an error in your SQL syntax...",
  "sql": "SELECT ...",
  "stack": "Error: ...\n    at ...",
  "errorDetails": {
    "message": "...",
    "name": "Error",
    "code": "...",
    "sqlMessage": "...",
    "sql": "...",
    "errno": 1064,
    "sqlState": "42000"
  },
  "timestamp": "2025-12-03T06:23:08.271Z"
}
```

### Поля ответа об ошибке

- `message` - понятное описание ошибки для пользователя
- `error` - детальное сообщение об ошибке
- `errorName` - тип ошибки (Error, TypeError, etc.)
- `errorCode` - код ошибки (если есть, например, SQL коды)
- `sqlMessage` - сообщение SQL ошибки (если SQL ошибка)
- `sql` - SQL запрос (если SQL ошибка)
- `stack` - stack trace (в development режиме)
- `errorDetails` - все детали ошибки в объекте

### Примеры

#### SQL ошибка
```javascript
try {
  const [results] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
} catch (err) {
  return error(res, 'Ошибка при получении пользователя', 500, err);
}
```

#### Валидация
```javascript
if (!userId || !userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
  return error(res, 'Невалидный ID пользователя. Должен быть UUID из базы данных.', 400);
}
```

#### Не найдено
```javascript
if (users.length === 0) {
  return error(res, 'Пользователь не найден', 404);
}
```

## Глобальная обработка ошибок

Глобальная обработка ошибок настроена в `api/index.js` и всегда возвращает детальную информацию об ошибке, независимо от режима (development/production).

## См. также

- [IMPORTANT_NOTES.md](../../IMPORTANT_NOTES.md)
- [.cursorrules](../../.cursorrules)

