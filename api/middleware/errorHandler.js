// Middleware для обработки ошибок
// ВСЕ ОШИБКИ ВОЗВРАЩАЮТСЯ В JSON - НЕ ЛОГИРУЕМ В ФАЙЛЫ
const errorHandler = (err, req, res, next) => {

  // Ошибки валидации Joi
  if (err.isJoi) {
    return res.status(400).json({
      success: false,
      message: 'Ошибка валидации данных',
      errors: err.details.map(detail => detail.message)
    });
  }

  // Проверяем, используется ли миграция (для детальных ошибок)
  const migrationSecret = process.env.MIGRATION_SECRET || 'migration-secret-key-change-in-production';
  const providedSecret = req.headers['x-migration-secret'] || req.query.secret;
  const isMigration = providedSecret && providedSecret === migrationSecret;
  const isDev = process.env.NODE_ENV !== 'production';

  // Ошибки базы данных

  if (err.code === 'ER_DUP_ENTRY') {
    const response = {
      success: false,
      message: 'Запись с такими данными уже существует'
    };
    if (isDev || isMigration) {
      response.sqlMessage = err.sqlMessage;
      response.sql = err.sql;
    }
    return res.status(409).json(response);
  }

  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    const response = {
      success: false,
      message: 'Ссылка на несуществующую запись'
    };
    if (isDev || isMigration) {
      response.sqlMessage = err.sqlMessage;
      response.sql = err.sql;
    }
    return res.status(400).json(response);
  }

  if (err.code === 'ER_ROW_IS_REFERENCED_2') {
    const response = {
      success: false,
      message: 'Невозможно удалить запись, так как на неё есть ссылки'
    };
    if (isDev || isMigration) {
      response.sqlMessage = err.sqlMessage;
      response.sql = err.sql;
    }
    return res.status(400).json(response);
  }

  // Другие ошибки БД
  if (err.code && err.code.startsWith('ER_')) {
    const response = {
      success: false,
      message: err.sqlMessage || 'Ошибка базы данных'
    };
    if (isDev || isMigration) {
      response.code = err.code;
      response.sqlMessage = err.sqlMessage;
      response.sql = err.sql;
    }
    return res.status(400).json(response);
  }

  // Ошибки JWT
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Недействительный токен'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Токен истёк'
    });
  }

  // Общая ошибка сервера
  const errorResponse = {
    success: false,
    message: (isDev || isMigration) ? err.message : 'Внутренняя ошибка сервера',
    timestamp: new Date().toISOString()
  };

  // Всегда добавляем базовую информацию об ошибке
  errorResponse.error = err.message;
  errorResponse.name = err.name || 'Error';

  // Добавляем детали для миграции или разработки
  if (isDev || isMigration) {
    errorResponse.errorDetails = {
      code: err.code,
      name: err.name,
      sql: err.sql,
      sqlMessage: err.sqlMessage,
      message: err.message
    };
    if (isDev) {
      errorResponse.stack = err.stack;
    }
  } else {
    // В продакшене показываем только безопасную информацию
    errorResponse.errorDetails = {
      message: 'Детали ошибки доступны только в режиме разработки'
    };
  }

  // Все ошибки возвращаются в JSON ответе - не логируем в файлы
  res.status(500).json(errorResponse);
};

// Middleware для обработки 404
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Маршрут ${req.method} ${req.path} не найден`
  });
};

module.exports = {
  errorHandler,
  notFound
};

