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
      message: 'Authorization token not provided'
    });
  }

  const decoded = verifyToken(token);

  if (!decoded || decoded.type !== 'partner_admin') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token. Sign in as partner admin required.'
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
      message: 'Authorization token not provided'
    });
  }

  const decoded = verifyToken(token);

  if (!decoded || decoded.type !== 'partner_seller') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token. Sign in as partner seller required.'
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
