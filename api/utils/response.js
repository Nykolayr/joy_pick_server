/**
 * Успешный ответ
 */
function success(res, data = null, message = 'Успешно', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
}

/**
 * Ответ с ошибкой
 */
function error(res, message = 'Произошла ошибка', statusCode = 400, errors = null) {
  const response = {
    success: false,
    message,
    timestamp: new Date().toISOString()
  };
  
  // Если errors - это объект Error, извлекаем детали
  // ВСЕГДА возвращаем все детали ошибки в ответе API
  if (errors instanceof Error) {
    response.error = errors.message || 'Unknown error';
    response.errorName = errors.name || 'Error';
    
    // Детали ошибки базы данных
    if (errors.code) {
      response.errorCode = errors.code;
    }
    if (errors.sqlMessage) {
      response.sqlMessage = errors.sqlMessage;
    }
    if (errors.sql) {
      response.sql = errors.sql;
    }
    if (errors.errno) {
      response.errno = errors.errno;
    }
    if (errors.sqlState) {
      response.sqlState = errors.sqlState;
    }
    
    // ВСЕГДА добавляем stack trace (для диагностики)
    if (errors.stack) {
      response.stack = errors.stack;
    }
    
    // Формируем errorDetails со всеми деталями
    // Добавляем ВСЕ свойства Error объекта
    response.errorDetails = {
      message: errors.message || 'Unknown error',
      name: errors.name || 'Error',
      code: errors.code,
      sqlMessage: errors.sqlMessage,
      sql: errors.sql,
      errno: errors.errno,
      sqlState: errors.sqlState,
      stack: errors.stack
    };
    
    // Добавляем все дополнительные свойства из Error объекта
    for (const key in errors) {
      if (!['message', 'name', 'stack'].includes(key) && !response.errorDetails.hasOwnProperty(key)) {
        response.errorDetails[key] = errors[key];
      }
    }
  } else if (errors) {
    // Если errors - это массив (валидация), добавляем как есть
    if (Array.isArray(errors)) {
      response.errors = errors;
    } else {
      // Если errors - это объект с деталями ошибки, добавляем в errorDetails
      response.errorDetails = errors;
    }
  }

  // В режиме разработки добавляем больше информации
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev && errors && !Array.isArray(errors) && !(errors instanceof Error)) {
    response.debug = errors;
  }
  
  return res.status(statusCode).json(response);
}

module.exports = {
  success,
  error
};

