const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { generateToken } = require('../utils/jwt');
const { success, error } = require('../utils/response');
const { verifyPassword, hashPassword } = require('../utils/password');

const router = express.Router();

/**
 * POST /api/partner-auth/admin/login
 * Вход администратора партнёра. Логин = admin_email партнёра, пароль.
 * Ответ: JWT с type: 'partner_admin', partnerId.
 */
router.post('/admin/login', [
  body('email').isEmail().withMessage('Invalid email'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }

    const { email, password } = req.body;

    const [partners] = await pool.execute(
      'SELECT id, name, admin_email, admin_password_hash FROM partners WHERE admin_email = ?',
      [email.trim().toLowerCase()]
    );

    if (partners.length === 0) {
      return error(res, 'Invalid email or password', 401);
    }

    const partner = partners[0];
    const hash = partner.admin_password_hash;

    if (!hash) {
      return error(res, 'Password not set for this partner. Contact administrator.', 403);
    }

    const result = await verifyPassword(password, hash);

    if (!result.valid) {
      return error(res, 'Invalid email or password', 401);
    }

    const token = generateToken({
      type: 'partner_admin',
      partnerId: partner.id,
      email: partner.admin_email
    });

    success(res, {
      token,
      partner: {
        id: partner.id,
        name: partner.name,
        email: partner.admin_email
      }
    }, 'Login successful');
  } catch (err) {
    error(res, 'Partner admin login error', 500, err);
  }
});

// Вход продавца перенесён в единый роут: POST /api/auth/app-login (логин + пароль, в ответе role: 'volunteer' | 'seller' и соответствующие данные).

module.exports = router;
