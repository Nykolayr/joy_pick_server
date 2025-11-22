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
  
  if (errors) {
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
  if (isDev && errors && !Array.isArray(errors)) {
    response.debug = errors;
  }
  
  return res.status(statusCode).json(response);
}

module.exports = {
  success,
  error
};

