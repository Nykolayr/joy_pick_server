const { verifyToken, extractToken } = require('../utils/jwt');

/**
 * Middleware для проверки аутентификации
 */
function authenticate(req, res, next) {
  const token = extractToken(req.headers.authorization);
  
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Токен авторизации не предоставлен'
    });
  }
  
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({
      success: false,
      message: 'Недействительный или истекший токен'
    });
  }
  
  // Добавляем данные пользователя в запрос
  req.user = decoded;
  next();
}

/**
 * Middleware для проверки прав администратора
 */
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Доступ запрещен. Требуются права администратора'
    });
  }
  next();
}

/**
 * Middleware для проверки прав суперадмина
 * Суперадмин может назначать админов и получать Stripe данные
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.isSuperAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Доступ запрещен. Требуются права суперадминистратора'
    });
  }
  next();
}

module.exports = {
  authenticate,
  requireAdmin,
  requireSuperAdmin
};

