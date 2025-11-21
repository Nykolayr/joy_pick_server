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
    message
  };
  
  if (errors) {
    response.errors = errors;
  }
  
  return res.status(statusCode).json(response);
}

module.exports = {
  success,
  error
};

