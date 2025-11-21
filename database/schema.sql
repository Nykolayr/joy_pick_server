-- ============================================
-- База данных для приложения Joy Pick
-- ============================================

-- Таблица пользователей
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(36) PRIMARY KEY,
  `email` VARCHAR(255) UNIQUE NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255),
  `photo_url` TEXT,
  `uid` VARCHAR(255) UNIQUE,
  `phone_number` VARCHAR(50),
  `city` VARCHAR(100),
  `first_name` VARCHAR(100),
  `second_name` VARCHAR(100),
  `country` VARCHAR(100),
  `gender` VARCHAR(20),
  `count_performed` INT DEFAULT 0,
  `count_orders` INT DEFAULT 0,
  `jcoins` INT DEFAULT 0,
  `coins_from_created` INT DEFAULT 0,
  `coins_from_participation` INT DEFAULT 0,
  `stripe_id` VARCHAR(255),
  `score` INT DEFAULT 0,
  `admin` BOOLEAN DEFAULT FALSE,
  `fcm_token` TEXT,
  `auth_type` VARCHAR(50) DEFAULT 'email',
  `latitude` DECIMAL(10, 8),
  `longitude` DECIMAL(11, 8),
  `created_time` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_email` (`email`),
  INDEX `idx_uid` (`uid`),
  INDEX `idx_city` (`city`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица заявок (requests)
CREATE TABLE IF NOT EXISTS `requests` (
  `id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36),
  `category` ENUM('wasteLocation', 'speedCleanup', 'event') NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `latitude` DECIMAL(10, 8),
  `longitude` DECIMAL(11, 8),
  `city` VARCHAR(100),
  `garbage_size` INT COMMENT '1=bag, 2=cart, 3=car',
  `only_foot` BOOLEAN DEFAULT FALSE,
  `possible_by_car` BOOLEAN DEFAULT FALSE,
  `cost` INT,
  `reward_amount` INT COMMENT 'Награда в Joycoin для Speed Clean-up',
  `is_open` BOOLEAN DEFAULT TRUE,
  `start_date` DATETIME,
  `end_date` DATETIME,
  `status` ENUM('pending', 'approved', 'rejected', 'completed') DEFAULT 'pending',
  `priority` ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
  `assigned_to` VARCHAR(36),
  `notes` TEXT,
  `created_by` VARCHAR(36),
  `taken_by` VARCHAR(36),
  `total_contributed` INT DEFAULT 0,
  `target_amount` INT,
  `joined_user_id` VARCHAR(36),
  `join_date` DATETIME,
  `payment_intent_id` VARCHAR(255),
  `completion_comment` TEXT,
  `plant_tree` BOOLEAN DEFAULT FALSE,
  `trash_pickup_only` BOOLEAN DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`taken_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`joined_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX `idx_category` (`category`),
  INDEX `idx_status` (`status`),
  INDEX `idx_city` (`city`),
  INDEX `idx_created_by` (`created_by`),
  INDEX `idx_location` (`latitude`, `longitude`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица фотографий заявок
CREATE TABLE IF NOT EXISTS `request_photos` (
  `id` VARCHAR(36) PRIMARY KEY,
  `request_id` VARCHAR(36) NOT NULL,
  `photo_url` TEXT NOT NULL,
  `photo_type` ENUM('photo', 'photo_before', 'photo_after') DEFAULT 'photo',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE,
  INDEX `idx_request_id` (`request_id`),
  INDEX `idx_photo_type` (`photo_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица типов отходов для заявок
CREATE TABLE IF NOT EXISTS `request_waste_types` (
  `id` VARCHAR(36) PRIMARY KEY,
  `request_id` VARCHAR(36) NOT NULL,
  `waste_type` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE,
  INDEX `idx_request_id` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица участников заявок (для events)
CREATE TABLE IF NOT EXISTS `request_participants` (
  `id` VARCHAR(36) PRIMARY KEY,
  `request_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_participant` (`request_id`, `user_id`),
  INDEX `idx_request_id` (`request_id`),
  INDEX `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица вкладчиков (contributors) для заявок
CREATE TABLE IF NOT EXISTS `request_contributors` (
  `id` VARCHAR(36) PRIMARY KEY,
  `request_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `amount` INT NOT NULL COMMENT 'Сумма вклада в центах',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_request_id` (`request_id`),
  INDEX `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица донатов
CREATE TABLE IF NOT EXISTS `donations` (
  `id` VARCHAR(36) PRIMARY KEY,
  `request_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `amount` INT NOT NULL COMMENT 'Сумма доната в центах',
  `payment_intent_id` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_request_id` (`request_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_payment_intent_id` (`payment_intent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица участников событий (members) - для совместимости со старой схемой
CREATE TABLE IF NOT EXISTS `members` (
  `id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `event_id` VARCHAR(36) NOT NULL COMMENT 'ID заявки типа event',
  `reason` TEXT,
  `status` ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`event_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_member` (`user_id`, `event_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_event_id` (`event_id`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица партнеров
CREATE TABLE IF NOT EXISTS `partners` (
  `id` VARCHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `latitude` DECIMAL(10, 8),
  `longitude` DECIMAL(11, 8),
  `city` VARCHAR(100),
  `rating` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_city` (`city`),
  INDEX `idx_location` (`latitude`, `longitude`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица фотографий партнеров
CREATE TABLE IF NOT EXISTS `partner_photos` (
  `id` VARCHAR(36) PRIMARY KEY,
  `partner_id` VARCHAR(36) NOT NULL,
  `photo_url` TEXT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON DELETE CASCADE,
  INDEX `idx_partner_id` (`partner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица типов партнеров
CREATE TABLE IF NOT EXISTS `partner_types` (
  `id` VARCHAR(36) PRIMARY KEY,
  `partner_id` VARCHAR(36) NOT NULL,
  `type_name` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON DELETE CASCADE,
  INDEX `idx_partner_id` (`partner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица завершенных заявок пользователей (для статистики)
CREATE TABLE IF NOT EXISTS `user_completed_requests` (
  `id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `request_id` VARCHAR(36) NOT NULL,
  `role` ENUM('creator', 'executor', 'participant', 'contributor') NOT NULL,
  `completed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_completion` (`user_id`, `request_id`, `role`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_request_id` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Таблица метаданных заявок (для дополнительных данных)
CREATE TABLE IF NOT EXISTS `request_metadata` (
  `id` VARCHAR(36) PRIMARY KEY,
  `request_id` VARCHAR(36) NOT NULL,
  `meta_key` VARCHAR(100) NOT NULL,
  `meta_value` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_metadata` (`request_id`, `meta_key`),
  INDEX `idx_request_id` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

