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
  body('email').isEmail().withMessage('Некорректный email'),
  body('password').notEmpty().withMessage('Пароль обязателен')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { email, password } = req.body;

    const [partners] = await pool.execute(
      'SELECT id, name, admin_email, admin_password_hash FROM partners WHERE admin_email = ?',
      [email.trim().toLowerCase()]
    );

    if (partners.length === 0) {
      return error(res, 'Неверный email или пароль', 401);
    }

    const partner = partners[0];
    const hash = partner.admin_password_hash;

    if (!hash) {
      return error(res, 'Для этого партнёра не задан пароль. Обратитесь к администратору.', 403);
    }

    const result = await verifyPassword(password, hash);

    if (!result.valid) {
      return error(res, 'Неверный email или пароль', 401);
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
    }, 'Вход выполнен');
  } catch (err) {
    error(res, 'Ошибка при входе администратора партнёра', 500, err);
  }
});

/**
 * POST /api/partner-auth/seller/login
 * Вход продавца партнёра. Обязательны partner_id, login, password.
 * Ответ: JWT с type: 'partner_seller', partnerId, sellerId.
 */
router.post('/seller/login', [
  body('partner_id').notEmpty().withMessage('partner_id обязателен'),
  body('login').notEmpty().withMessage('Логин обязателен'),
  body('password').notEmpty().withMessage('Пароль обязателен')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { partner_id, login, password } = req.body;

    const [sellers] = await pool.execute(
      `SELECT ps.id, ps.partner_id, ps.full_name, ps.login, ps.password_hash, ps.job_title, p.name AS partner_name
       FROM partner_sellers ps
       JOIN partners p ON p.id = ps.partner_id
       WHERE ps.partner_id = ? AND ps.login = ?`,
      [partner_id.trim(), login.trim()]
    );

    if (sellers.length === 0) {
      return error(res, 'Неверный партнёр, логин или пароль', 401);
    }

    const seller = sellers[0];
    const result = await verifyPassword(password, seller.password_hash);

    if (!result.valid) {
      return error(res, 'Неверный партнёр, логин или пароль', 401);
    }

    const token = generateToken({
      type: 'partner_seller',
      partnerId: seller.partner_id,
      sellerId: seller.id
    });

    success(res, {
      token,
      seller: {
        id: seller.id,
        partnerId: seller.partner_id,
        partnerName: seller.partner_name,
        fullName: seller.full_name,
        login: seller.login,
        jobTitle: seller.job_title || null
      }
    }, 'Вход выполнен');
  } catch (err) {
    error(res, 'Ошибка при входе продавца', 500, err);
  }
});

module.exports = router;
