# Структура таблицы users

**Всего колонок:** 30

## Колонки:

1. `id` - varchar(36) - PRIMARY KEY, NOT NULL
2. `email` - varchar(255) - NOT NULL
3. `email_verified` - tinyint(1) - NULL, DEFAULT 0
4. `password_hash` - varchar(255) - NOT NULL
5. `display_name` - varchar(255) - NULL
6. `photo_url` - text - NULL
7. `uid` - varchar(255) - NULL
8. `phone_number` - varchar(50) - NULL
9. `city` - varchar(100) - NULL
10. `first_name` - varchar(100) - NULL
11. `second_name` - varchar(100) - NULL
12. `country` - varchar(100) - NULL
13. `gender` - varchar(20) - NULL
14. `count_performed` - int - NULL, DEFAULT 0
15. `count_orders` - int - NULL, DEFAULT 0
16. `jcoins` - int - NULL, DEFAULT 0
17. `coins_from_created` - int - NULL, DEFAULT 0
18. `coins_from_participation` - int - NULL, DEFAULT 0
19. `stripe_id` - varchar(255) - NULL
20. `score` - int - NULL, DEFAULT 0
21. `admin` - tinyint(1) - NULL, DEFAULT 0
22. `super_admin` - tinyint(1) - NULL, DEFAULT 0
23. `fcm_token` - text - NULL
24. `auth_type` - varchar(50) - NULL, DEFAULT 'email'
25. `latitude` - decimal(10,8) - NULL
26. `longitude` - decimal(11,8) - NULL
27. `about` - text - NULL
28. `social_links` - JSON - NULL
29. `created_time` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP
30. `updated_at` - timestamp - NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

## Порядок колонок в INSERT запросе:

```sql
INSERT INTO users (
  id, email, email_verified, password_hash, display_name, photo_url, uid,
  phone_number, city, first_name, second_name, country, gender,
  count_performed, count_orders, jcoins, coins_from_created, coins_from_participation,
  stripe_id, score, admin, super_admin, fcm_token, auth_type, latitude, longitude,
  about, social_links, created_time, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
```

**Всего:** 30 колонок = 28 плейсхолдеров `?` + 2 автоматических значений для `created_time` и `updated_at`

