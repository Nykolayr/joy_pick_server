-- Новости: заголовок, текст, картинка (опционально), дата публикации, просмотры, лайки.

CREATE TABLE IF NOT EXISTS news (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  text TEXT NOT NULL,
  image_url VARCHAR(1000) DEFAULT NULL COMMENT 'Ссылка на картинку, может быть пустой',
  published_at DATETIME NOT NULL COMMENT 'Дата публикации',
  view_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_news_published_at (published_at),
  INDEX idx_news_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Лайки новостей (один пользователь — один лайк на новость).
CREATE TABLE IF NOT EXISTS news_likes (
  news_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (news_id, user_id),
  CONSTRAINT fk_news_likes_news FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE,
  CONSTRAINT fk_news_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_news_likes_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
