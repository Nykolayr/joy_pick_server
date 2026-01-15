-- Добавление полей about и social_links в таблицу users
-- Дата: 2026-01-15

-- Добавляем поле about (текст о себе)
ALTER TABLE users 
ADD COLUMN about TEXT NULL AFTER longitude;

-- Добавляем поле social_links (массив ссылок на соцсети, хранится как JSON)
ALTER TABLE users 
ADD COLUMN social_links JSON NULL AFTER about;

-- Комментарий к полям (если поддерживается)
-- about: Информация о пользователе (о себе)
-- social_links: Массив ссылок на социальные сети (хранится как JSON массив строк)
