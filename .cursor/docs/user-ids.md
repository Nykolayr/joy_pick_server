# ID пользователей

## Критически важное правило

**ВСЕГДА использовать UUID из базы данных** (поле `id` из таблицы `users`), **НИКОГДА не использовать Firebase UID**.

## Формат UUID

UUID должен соответствовать формату:
```
xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Пример: `550e8400-e29b-41d4-a716-446655440000`

## Валидация UUID

Перед использованием ID пользователя всегда проверять формат:

```javascript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!userId || !userId.match(UUID_REGEX)) {
  return error(res, 'ID пользователя должен быть UUID из базы данных. Firebase UID не поддерживается.', 400);
}
```

## Проверка существования пользователя

Перед использованием ID пользователя проверять его существование в БД:

```javascript
const [users] = await pool.execute(
  'SELECT id FROM users WHERE id = ?',
  [userId]
);

if (users.length === 0) {
  return error(res, 'Пользователь с указанным ID не найден в базе данных', 404);
}
```

## Где это важно

- `joined_user_id` - ID пользователя, присоединившегося к заявке
- `created_by` - ID создателя заявки
- `taken_by` - ID исполнителя
- `actual_participants` - массив ID реальных участников события
- `registered_participants` - массив ID зарегистрированных участников
- Все элементы в массивах участников

## Валидация массивов участников

При работе с массивами участников валидировать каждый ID:

```javascript
if (Array.isArray(actual_participants)) {
  for (const participantId of actual_participants) {
    if (participantId && !participantId.match(UUID_REGEX)) {
      return error(res, `actual_participants содержит невалидный ID: ${participantId}. Все ID должны быть UUID из базы данных.`, 400);
    }
  }
}
```

## Отсоединение от заявки

Для отсоединения от заявки установить `joined_user_id: null` и `join_date: null`:

```javascript
if (joined_user_id !== undefined) {
  // Валидация: должен быть UUID или null
  if (joined_user_id !== null && !joined_user_id.match(UUID_REGEX)) {
    return error(res, 'joined_user_id должен быть UUID из базы данных или null', 400);
  }
  
  updates.push('joined_user_id = ?');
  params.push(joined_user_id || null);
}
```

## См. также

- [API_DOCUMENTATION.md](../../API_DOCUMENTATION.md) - раздел "Важно: ID пользователей"
- [CURRENT_STAGE.md](../../CURRENT_STAGE.md)

