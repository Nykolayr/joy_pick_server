# КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Денежные поля

## Проблема
Денежные поля хранились как `int`, что обрезало дробные суммы:
- $2.50 → $2 (потеря 50 центов!)
- Это приводило к неправильным расчетам комиссий и transfer

## Решение
Изменены все денежные поля на `decimal(10,2)` для точного хранения дробных сумм.

## Поля, которые изменены:

### Таблица `requests`:
- `cost` - int → decimal(10,2)
- `reward_amount` - int → decimal(10,2)
- `total_contributed` - int → decimal(10,2)
- `target_amount` - int → decimal(10,2)

### Таблица `donations`:
- `amount` - int → decimal(10,2)

## Как применить миграцию:

```sql
-- Выполнить SQL из файла migrations/005_fix_money_fields_to_decimal.sql
```

Или через MySQL клиент:
```bash
mysql -u username -p database_name < migrations/005_fix_money_fields_to_decimal.sql
```

## Изменения в коде:

1. **api/routes/payments.js** - добавлен `parseFloat()` для правильной обработки decimal значений из MySQL
2. **api/routes/requests.js** - добавлен `parseFloat()` во всех местах, где используются денежные поля
3. **api/routes/donations.js** - добавлен `parseFloat()` при обновлении total_contributed

## Важно:

- MySQL возвращает `decimal` как строки, поэтому везде используется `parseFloat()`
- При сохранении значений они автоматически конвертируются в decimal
- Все расчеты теперь работают с точными дробными значениями

## Проверка после миграции:

1. Создать заявку с cost = 2.50
2. Проверить в БД, что сохранено 2.50 (не 2)
3. Создать донат на 1.25
4. Проверить расчет transfer с комиссиями
