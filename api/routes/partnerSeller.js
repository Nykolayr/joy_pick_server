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
      return error(res, 'Seller not found', 404);
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
    error(res, 'Error fetching profile', 500, err);
  }
});

/**
 * GET /api/partner-seller/partner
 * Данные партнёра, к которому привязан продавец (аналогично GET /api/partners/:id, без admin_password_hash).
 */
router.get('/partner', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, logo_url, photo_urls, activity, website_url, admin_email, currency, exchange_rate_cents_per_coin, created_at, updated_at FROM partners WHERE id = ?',
      [req.partnerId]
    );
    if (rows.length === 0) {
      return error(res, 'Partner not found', 404);
    }
    const partner = rows[0];
    if (partner.photo_urls) {
      try {
        partner.photo_urls = typeof partner.photo_urls === 'string' ? JSON.parse(partner.photo_urls) : partner.photo_urls;
      } catch (e) {
        partner.photo_urls = [];
      }
    } else {
      partner.photo_urls = [];
    }
    const [branchRows] = await pool.execute(
      'SELECT id, partner_id, name, address, latitude, longitude, created_at, updated_at FROM partner_branches WHERE partner_id = ? ORDER BY name',
      [req.partnerId]
    );
    partner.branches = branchRows;

    success(res, { partner });
  } catch (err) {
    error(res, 'Error fetching partner data', 500, err);
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
    error(res, 'Error fetching branches', 500, err);
  }
});

/**
 * POST /api/partner-seller/scan-qr
 * Проверка QR-токена волонтёра. Возвращает данные волонтёра для отображения и ввода суммы списания.
 * Body: { qr_token }
 */
router.post('/scan-qr', [
  body('qr_token').notEmpty().withMessage('qr_token is required')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }
    const { qr_token } = req.body;

    const [tokens] = await pool.execute(
      'SELECT id, user_id, used_at, expires_at FROM volunteer_qr_tokens WHERE token = ?',
      [qr_token.trim()]
    );

    if (tokens.length === 0) {
      return error(res, 'Invalid or unknown QR code', 400);
    }
    const row = tokens[0];
    if (row.used_at) {
      return error(res, 'This QR code has already been used', 400);
    }
    if (new Date() > new Date(row.expires_at)) {
      return error(res, 'QR code has expired. Ask the volunteer to refresh the screen.', 400);
    }

    const [users] = await pool.execute(
      'SELECT id, display_name, first_name, second_name, email, COALESCE(jcoins, 0) AS jcoins FROM users WHERE id = ?',
      [row.user_id]
    );
    if (users.length === 0) {
      return error(res, 'User not found', 404);
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
    error(res, 'Error verifying QR code', 500, err);
  }
});

/**
 * POST /api/partner-seller/redeem
 * Списание коинов волонтёра. Требуется актуальный qr_token, branch_id и coins_spent.
 * Body: { qr_token, branch_id, coins_spent }
 */
router.post('/redeem', [
  body('qr_token').notEmpty().withMessage('qr_token is required'),
  body('branch_id').notEmpty().withMessage('branch_id is required'),
  body('coins_spent').isInt({ min: 1 }).withMessage('coins_spent must be a positive number')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }
    const { qr_token, branch_id, coins_spent } = req.body;

    const [tokens] = await pool.execute(
      'SELECT id, user_id, used_at, expires_at FROM volunteer_qr_tokens WHERE token = ?',
      [qr_token.trim()]
    );
    if (tokens.length === 0) {
      return error(res, 'Invalid or unknown QR code', 400);
    }
    const tokenRow = tokens[0];
    if (tokenRow.used_at) {
      return error(res, 'This QR code has already been used', 400);
    }
    if (new Date() > new Date(tokenRow.expires_at)) {
      return error(res, 'QR code has expired', 400);
    }

    const userId = tokenRow.user_id;

    const [branch] = await pool.execute(
      'SELECT id FROM partner_branches WHERE id = ? AND partner_id = ?',
      [branch_id, req.partnerId]
    );
    if (branch.length === 0) {
      return error(res, 'Branch not found or does not belong to your partner', 404);
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
        return error(res, 'User not found', 404);
      }
      const currentJcoins = Number(userRows[0].jcoins);
      if (currentJcoins < coins_spent) {
        await connection.rollback();
        return error(res, `Insufficient coins for volunteer. Available: ${currentJcoins}`, 400);
      }

      const newJcoins = currentJcoins - coins_spent;
      const [updateResult] = await connection.execute(
        'UPDATE users SET jcoins = ?, updated_at = NOW() WHERE id = ?',
        [newJcoins, userId]
      );
      if (updateResult.affectedRows !== 1) {
        await connection.rollback();
        return error(res, 'Failed to update volunteer balance', 500);
      }

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
          currency,
          volunteerNewBalance: newJcoins
        }
      }, `Redeemed ${coins_spent} coins. Discount: ${(amount_cents / 100).toFixed(2)} ${currency}`);
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }
  } catch (err) {
    error(res, 'Error redeeming coins', 500, err);
  }
});

/**
 * GET /api/partner-seller/redemptions
 * Все транзакции (погашения), проведённые этим продавцом. По JWT продавца, с пагинацией.
 */
router.get('/redemptions', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await pool.execute(
      `SELECT r.id, r.partner_id, r.branch_id, r.seller_id, r.user_id, r.coins_spent, r.amount_cents, r.currency, r.created_at,
              b.name AS branch_name,
              p.name AS partner_name,
              u.display_name AS user_display_name, u.first_name AS user_first_name, u.second_name AS user_second_name, u.email AS user_email
       FROM partner_coin_redemptions r
       LEFT JOIN partner_branches b ON b.id = r.branch_id
       LEFT JOIN partners p ON p.id = r.partner_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.seller_id = ?
       ORDER BY r.created_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      [req.sellerId]
    );

    const [countResult] = await pool.execute(
      'SELECT COUNT(*) AS total FROM partner_coin_redemptions WHERE seller_id = ?',
      [req.sellerId]
    );
    const total = countResult[0].total;

    const redemptions = rows.map((r) => ({
      id: r.id,
      partnerId: r.partner_id,
      partnerName: r.partner_name,
      branchId: r.branch_id,
      branchName: r.branch_name,
      sellerId: r.seller_id,
      userId: r.user_id,
      userDisplayName: r.user_display_name || [r.user_first_name, r.user_second_name].filter(Boolean).join(' ') || r.user_email || r.user_id,
      coinsSpent: r.coins_spent,
      amountCents: r.amount_cents,
      currency: r.currency,
      createdAt: r.created_at
    }));

    success(res, {
      redemptions,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
    });
  } catch (err) {
    error(res, 'Error fetching seller transactions', 500, err);
  }
});

module.exports = router;
