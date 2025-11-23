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
  if (errors instanceof Error) {
    response.error = errors.message;
    response.errorName = errors.name;
    
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
    
    // В режиме разработки добавляем stack trace
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      response.stack = errors.stack;
    }
    
    // Формируем errorDetails
    response.errorDetails = {
      message: errors.message,
      name: errors.name,
      code: errors.code,
      sqlMessage: errors.sqlMessage,
      sql: errors.sql
    };
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

