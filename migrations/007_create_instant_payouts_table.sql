-- ============================================================================
-- СОЗДАНИЕ ТАБЛИЦЫ ДЛЯ INSTANT PAYOUTS
-- ============================================================================
-- Дата: 2025-01-22
-- Описание: Таблица для отслеживания мгновенных выплат через Stripe
-- ============================================================================

CREATE TABLE IF NOT EXISTS instant_payouts (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  stripe_account_id VARCHAR(255) NOT NULL,
  payout_id VARCHAR(255) NOT NULL UNIQUE,
  amount_cents INT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  external_account_id VARCHAR(255) NULL,
  failure_code VARCHAR(100) NULL,
  failure_message TEXT NULL,
  arrival_date TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_user_id (user_id),
  INDEX idx_payout_id (payout_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);

-- ============================================================================
-- ПРОВЕРКА ПОСЛЕ СОЗДАНИЯ:
-- ============================================================================
-- 1. Проверить, что таблица создана:
--    SHOW TABLES LIKE 'instant_payouts';
--
-- 2. Проверить структуру:
--    DESCRIBE instant_payouts;
--
-- 3. Проверить индексы:
--    SHOW INDEX FROM instant_payouts;
--
-- ПРИМЕЧАНИЕ: Foreign key constraint убран из-за возможных проблем совместимости
-- типов данных между instant_payouts.user_id и users.id. Связь поддерживается
-- на уровне приложения.
-- ============================================================================