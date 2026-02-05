-- Партнёры: вход админа партнёра и настройки скидки за коины
-- Логин админа = admin_email, пароль хранится в admin_password_hash (bcrypt).
-- exchange_rate_cents_per_coin: 1 коин = N центов скидки (например 50 = 0.50 USD).

ALTER TABLE partners
  ADD COLUMN admin_email VARCHAR(255) NULL COMMENT 'Логин админа партнёра для входа в админку',
  ADD COLUMN admin_password_hash VARCHAR(255) NULL COMMENT 'bcrypt хеш пароля админа партнёра',
  ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'USD' COMMENT 'Валюта скидки (USD, RUB и т.д.)',
  ADD COLUMN exchange_rate_cents_per_coin INT NOT NULL DEFAULT 50 COMMENT 'Скидка в центах за 1 коин (50 = 0.50 USD)';
