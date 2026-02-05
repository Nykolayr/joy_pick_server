const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticatePartnerSeller } = require('../middleware/partnerAuth');
const { generateId } = require('../utils/uuid');

const router = express.Router();

router.use(authenticatePartnerSeller);

/**
 * GET /api/partner-seller/me
 * Профиль текущего продавца и партнёра.
 */
router.get('/me', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ps.id, ps.partner_id, ps.full_name, ps.login, ps.job_title, p.name AS partner_name, p.currency, p.exchange_rate_cents_per_coin
       FROM partner_sellers ps
       JOIN partners p ON p.id = ps.partner_id
       WHERE ps.id = ? AND ps.partner_id = ?`,
      [req.sellerId, req.partnerId]
    );
    if (rows.length === 0) {
      return error(res, 'Продавец не найден', 404);
    }
    const s = rows[0];
    success(res, {
      seller: {
        id: s.id,
        partnerId: s.partner_id,
        partnerName: s.partner_name,
        fullName: s.full_name,
        login: s.login,
        jobTitle: s.job_title,
        currency: s.currency,
        exchangeRateCentsPerCoin: s.exchange_rate_cents_per_coin
      }
    });
  } catch (err) {
    error(res, 'Ошибка при получении профиля', 500, err);
  }
});

/**
 * GET /api/partner-seller/branches
 * Список филиалов партнёра (для выбора при списании).
 */
router.get('/branches', async (req, res) => {
  try {
    const [branches] = await pool.execute(
      'SELECT id, name, address, latitude, longitude FROM partner_branches WHERE partner_id = ? ORDER BY name',
      [req.partnerId]
    );
    success(res, { branches });
  } catch (err) {
    error(res, 'Ошибка при получении филиалов', 500, err);
  }
});

/**
 * POST /api/partner-seller/scan-qr
 * Проверка QR-токена волонтёра. Возвращает данные волонтёра для отображения и ввода суммы списания.
 * Body: { qr_token }
 */
router.post('/scan-qr', [
  body('qr_token').notEmpty().withMessage('qr_token обязателен')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }
    const { qr_token } = req.body;

    const [tokens] = await pool.execute(
      'SELECT id, user_id, used_at, expires_at FROM volunteer_qr_tokens WHERE token = ?',
      [qr_token.trim()]
    );

    if (tokens.length === 0) {
      return error(res, 'Недействительный или неизвестный QR-код', 400);
    }
    const row = tokens[0];
    if (row.used_at) {
      return error(res, 'Этот QR-код уже был использован', 400);
    }
    if (new Date() > new Date(row.expires_at)) {
      return error(res, 'Срок действия QR-кода истёк. Попросите волонтёра обновить экран.', 400);
    }

    const [users] = await pool.execute(
      'SELECT id, display_name, first_name, second_name, email, COALESCE(jcoins, 0) AS jcoins FROM users WHERE id = ?',
      [row.user_id]
    );
    if (users.length === 0) {
      return error(res, 'Пользователь не найден', 404);
    }
    const u = users[0];
    const displayName = u.display_name || [u.first_name, u.second_name].filter(Boolean).join(' ') || u.email || u.id;

    success(res, {
      qrTokenId: row.id,
      volunteer: {
        userId: u.id,
        displayName,
        email: u.email,
        jcoins: Number(u.jcoins)
      }
    });
  } catch (err) {
    error(res, 'Ошибка при проверке QR-кода', 500, err);
  }
});

/**
 * POST /api/partner-seller/redeem
 * Списание коинов волонтёра. Требуется актуальный qr_token, branch_id и coins_spent.
 * Body: { qr_token, branch_id, coins_spent }
 */
router.post('/redeem', [
  body('qr_token').notEmpty().withMessage('qr_token обязателен'),
  body('branch_id').notEmpty().withMessage('branch_id обязателен'),
  body('coins_spent').isInt({ min: 1 }).withMessage('coins_spent должно быть положительным числом')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }
    const { qr_token, branch_id, coins_spent } = req.body;

    const [tokens] = await pool.execute(
      'SELECT id, user_id, used_at, expires_at FROM volunteer_qr_tokens WHERE token = ?',
      [qr_token.trim()]
    );
    if (tokens.length === 0) {
      return error(res, 'Недействительный или неизвестный QR-код', 400);
    }
    const tokenRow = tokens[0];
    if (tokenRow.used_at) {
      return error(res, 'Этот QR-код уже был использован', 400);
    }
    if (new Date() > new Date(tokenRow.expires_at)) {
      return error(res, 'Срок действия QR-кода истёк', 400);
    }

    const userId = tokenRow.user_id;

    const [branch] = await pool.execute(
      'SELECT id FROM partner_branches WHERE id = ? AND partner_id = ?',
      [branch_id, req.partnerId]
    );
    if (branch.length === 0) {
      return error(res, 'Филиал не найден или не принадлежит вашему партнёру', 404);
    }

    const [partnerRow] = await pool.execute(
      'SELECT currency, exchange_rate_cents_per_coin FROM partners WHERE id = ?',
      [req.partnerId]
    );
    const rate = partnerRow[0].exchange_rate_cents_per_coin;
    const currency = partnerRow[0].currency;
    const amount_cents = coins_spent * rate;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [userRows] = await connection.execute(
        'SELECT COALESCE(jcoins, 0) AS jcoins FROM users WHERE id = ? FOR UPDATE',
        [userId]
      );
      if (userRows.length === 0) {
        await connection.rollback();
        return error(res, 'Пользователь не найден', 404);
      }
      const currentJcoins = Number(userRows[0].jcoins);
      if (currentJcoins < coins_spent) {
        await connection.rollback();
        return error(res, `Недостаточно коинов у волонтёра. Доступно: ${currentJcoins}`, 400);
      }

      await connection.execute(
        'UPDATE users SET jcoins = COALESCE(jcoins, 0) - ?, updated_at = NOW() WHERE id = ?',
        [coins_spent, userId]
      );

      const redemptionId = generateId();
      await connection.execute(
        `INSERT INTO partner_coin_redemptions (id, partner_id, branch_id, seller_id, user_id, coins_spent, amount_cents, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [redemptionId, req.partnerId, branch_id, req.sellerId, userId, coins_spent, amount_cents, currency]
      );

      await connection.execute(
        'UPDATE volunteer_qr_tokens SET used_at = NOW() WHERE id = ?',
        [tokenRow.id]
      );

      await connection.commit();

      success(res, {
        redemption: {
          id: redemptionId,
          coinsSpent: coins_spent,
          amountCents: amount_cents,
          currency
        }
      }, `Списано ${coins_spent} коинов. Скидка: ${(amount_cents / 100).toFixed(2)} ${currency}`);
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }
  } catch (err) {
    error(res, 'Ошибка при списании коинов', 500, err);
  }
});

module.exports = router;
