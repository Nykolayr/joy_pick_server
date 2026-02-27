// Middleware для обработки ошибок
// ВСЕ ОШИБКИ ВОЗВРАЩАЮТСЯ В JSON - НЕ ЛОГИРУЕМ В ФАЙЛЫ
const errorHandler = (err, req, res, next) => {

  // Ошибки валидации Joi
  if (err.isJoi) {
    return res.status(400).json({
      success: false,
      message: 'Data validation error',
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
      message: 'A record with such data already exists'
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
      message: 'Reference to non-existent record'
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
      message: 'Cannot delete record: it is referenced by other records'
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
      message: err.sqlMessage || 'Database error'
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
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Общая ошибка сервера
  const errorResponse = {
    success: false,
    message: (isDev || isMigration) ? err.message : 'Internal server error',
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
      message: 'Error details are only available in development mode'
    };
  }

  // Все ошибки возвращаются в JSON ответе - не логируем в файлы
  res.status(500).json(errorResponse);
};

// Middleware для обработки 404
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
    path: req.path,
    originalUrl: req.originalUrl || req.url,
    baseUrl: req.baseUrl || ''
  });
};

module.exports = {
  errorHandler,
  notFound
};

