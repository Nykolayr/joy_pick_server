const { verifyToken, extractToken } = require('../utils/jwt');

/**
 * Middleware: проверка JWT администратора партнёра.
 * Ожидает токен с payload: { type: 'partner_admin', partnerId, ... }
 */
function authenticatePartnerAdmin(req, res, next) {
  const token = extractToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Токен авторизации не предоставлен'
    });
  }

  const decoded = verifyToken(token);

  if (!decoded || decoded.type !== 'partner_admin') {
    return res.status(401).json({
      success: false,
      message: 'Недействительный или истекший токен. Требуется вход как администратор партнёра.'
    });
  }

  req.partnerAdmin = decoded;
  req.partnerId = decoded.partnerId;
  next();
}

/**
 * Middleware: проверка JWT продавца партнёра.
 * Ожидает токен с payload: { type: 'partner_seller', partnerId, sellerId, ... }
 */
function authenticatePartnerSeller(req, res, next) {
  const token = extractToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Токен авторизации не предоставлен'
    });
  }

  const decoded = verifyToken(token);

  if (!decoded || decoded.type !== 'partner_seller') {
    return res.status(401).json({
      success: false,
      message: 'Недействительный или истекший токен. Требуется вход как продавец партнёра.'
    });
  }

  req.partnerSeller = decoded;
  req.partnerId = decoded.partnerId;
  req.sellerId = decoded.sellerId;
  next();
}

module.exports = {
  authenticatePartnerAdmin,
  authenticatePartnerSeller
};
