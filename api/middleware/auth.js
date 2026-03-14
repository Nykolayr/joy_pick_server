const { verifyToken, extractToken } = require('../utils/jwt');

/**
 * Middleware для проверки аутентификации
 */
function authenticate(req, res, next) {
  const token = extractToken(req.headers.authorization);
  
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authorization token not provided'
    });
  }
  
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
  
  // Добавляем данные пользователя в запрос
  req.user = decoded;
  next();
}

/**
 * Опциональная аутентификация: если токен передан и валиден — заполняет req.user, иначе просто next().
 * Не возвращает 401 при отсутствии токена.
 */
function optionalAuthenticate(req, res, next) {
  const token = extractToken(req.headers.authorization);
  if (!token) {
    return next();
  }
  const decoded = verifyToken(token);
  if (decoded) {
    req.user = decoded;
  }
  next();
}

/**
 * Middleware для проверки прав администратора
 */
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin rights required'
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
      message: 'Access denied. Super admin rights required'
    });
  }
  next();
}

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireAdmin,
  requireSuperAdmin
};

