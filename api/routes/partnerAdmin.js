const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticatePartnerAdmin } = require('../middleware/partnerAuth');
const { generateId } = require('../utils/uuid');
const { hashPassword } = require('../utils/password');

const router = express.Router();

router.use(authenticatePartnerAdmin);

// ——— Партнёр (текущий) и настройки ———

/**
 * GET /api/partner-admin/me
 * Текущий партнёр — те же данные, что и GET /api/partners/:id (включая branches, logo_url, photo_urls и т.д.), без admin_password_hash.
 */
router.get('/me', async (req, res) => {
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
 * PUT /api/partner-admin/settings
 * Обновление валюты и курса (1 коин = N центов).
 */
router.put('/settings', [
  body('currency').optional().isString().isLength({ max: 10 }),
  body('exchange_rate_cents_per_coin').optional().isInt({ min: 1 })
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }
    const { currency, exchange_rate_cents_per_coin } = req.body;
    const updates = [];
    const params = [];
    if (currency !== undefined) {
      updates.push('currency = ?');
      params.push(currency);
    }
    if (exchange_rate_cents_per_coin !== undefined) {
      updates.push('exchange_rate_cents_per_coin = ?');
      params.push(exchange_rate_cents_per_coin);
    }
    if (updates.length === 0) {
      return error(res, 'No data to update', 400);
    }
    params.push(req.partnerId);
    await pool.execute(`UPDATE partners SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
    success(res, null, 'Settings updated');
  } catch (err) {
    error(res, 'Error updating settings', 500, err);
  }
});

/**
 * PUT /api/partner-admin/settings/password
 * Смена пароля администратора партнёра.
 */
router.put('/settings/password', [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }
    const { current_password, new_password } = req.body;
    const [rows] = await pool.execute('SELECT admin_password_hash FROM partners WHERE id = ?', [req.partnerId]);
    if (rows.length === 0) {
      return error(res, 'Partner not found', 404);
    }
    const { verifyPassword } = require('../utils/password');
    const result = await verifyPassword(current_password, rows[0].admin_password_hash || '');
    if (!result.valid) {
      return error(res, 'Invalid current password', 401);
    }
    const newHash = await hashPassword(new_password);
    await pool.execute('UPDATE partners SET admin_password_hash = ?, updated_at = NOW() WHERE id = ?', [newHash, req.partnerId]);
    success(res, null, 'Password changed');
  } catch (err) {
    error(res, 'Error changing password', 500, err);
  }
});

// ——— Филиалы ———

/**
 * GET /api/partner-admin/branches
 */
router.get('/branches', async (req, res) => {
  try {
    const [branches] = await pool.execute(
      'SELECT id, partner_id, name, address, latitude, longitude, created_at, updated_at FROM partner_branches WHERE partner_id = ? ORDER BY name',
      [req.partnerId]
    );
    success(res, { branches });
  } catch (err) {
    error(res, 'Error fetching branches', 500, err);
  }
});

/**
 * POST /api/partner-admin/branches
 */
router.post('/branches', [
  body('name').notEmpty().withMessage('Branch name is required'),
  body('address').optional().isString(),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat()
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }
    const id = generateId();
    const { name, address, latitude, longitude } = req.body;
    await pool.execute(
      'INSERT INTO partner_branches (id, partner_id, name, address, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.partnerId, name, address || null, latitude ?? null, longitude ?? null]
    );
    const [rows] = await pool.execute('SELECT * FROM partner_branches WHERE id = ?', [id]);
    success(res, { branch: rows[0] }, 'Branch created', 201);
  } catch (err) {
    error(res, 'Error creating branch', 500, err);
  }
});

/**
 * GET /api/partner-admin/branches/:id
 */
router.get('/branches/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM partner_branches WHERE id = ? AND partner_id = ?',
      [req.params.id, req.partnerId]
    );
    if (rows.length === 0) return error(res, 'Branch not found', 404);
    success(res, { branch: rows[0] });
  } catch (err) {
    error(res, 'Error fetching branch', 500, err);
  }
});

/**
 * PUT /api/partner-admin/branches/:id
 */
router.put('/branches/:id', [
  body('name').optional().notEmpty().withMessage('Name cannot be empty'),
  body('address').optional().isString(),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat()
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }
    const [existing] = await pool.execute(
      'SELECT id FROM partner_branches WHERE id = ? AND partner_id = ?',
      [req.params.id, req.partnerId]
    );
    if (existing.length === 0) return error(res, 'Branch not found', 404);
    const { name, address, latitude, longitude } = req.body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (address !== undefined) { updates.push('address = ?'); params.push(address); }
    if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
    if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(req.params.id);
      await pool.execute(`UPDATE partner_branches SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    const [rows] = await pool.execute('SELECT * FROM partner_branches WHERE id = ?', [req.params.id]);
    success(res, { branch: rows[0] }, 'Branch updated');
  } catch (err) {
    error(res, 'Error updating branch', 500, err);
  }
});

/**
 * DELETE /api/partner-admin/branches/:id
 */
router.delete('/branches/:id', async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM partner_branches WHERE id = ? AND partner_id = ?',
      [req.params.id, req.partnerId]
    );
    if (result.affectedRows === 0) return error(res, 'Branch not found', 404);
    success(res, null, 'Branch deleted');
  } catch (err) {
    error(res, 'Error deleting branch', 500, err);
  }
});

// ——— Продавцы ———

/**
 * GET /api/partner-admin/sellers
 */
router.get('/sellers', async (req, res) => {
  try {
    const [sellers] = await pool.execute(
      'SELECT id, partner_id, full_name, login, job_title, created_at, updated_at FROM partner_sellers WHERE partner_id = ? ORDER BY full_name',
      [req.partnerId]
    );
    success(res, { sellers });
  } catch (err) {
    error(res, 'Error fetching sellers', 500, err);
  }
});

/**
 * POST /api/partner-admin/sellers
 */
router.post('/sellers', [
  body('full_name').notEmpty().withMessage('Full name is required'),
  body('login').notEmpty().withMessage('Login is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('job_title').optional().isString()
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }
    const { full_name, login, password, job_title } = req.body;
    const loginTrim = login.trim();
    const [existing] = await pool.execute(
      'SELECT id FROM partner_sellers WHERE partner_id = ? AND login = ?',
      [req.partnerId, loginTrim]
    );
    if (existing.length > 0) {
      return error(res, 'Seller with this login already exists', 409);
    }
    const id = generateId();
    const passwordHash = await hashPassword(password);
    await pool.execute(
      'INSERT INTO partner_sellers (id, partner_id, full_name, login, password_hash, job_title) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.partnerId, full_name, loginTrim, passwordHash, job_title || null]
    );
    const [rows] = await pool.execute(
      'SELECT id, partner_id, full_name, login, job_title, created_at, updated_at FROM partner_sellers WHERE id = ?',
      [id]
    );
    success(res, { seller: rows[0] }, 'Seller created', 201);
  } catch (err) {
    error(res, 'Error creating seller', 500, err);
  }
});

/**
 * GET /api/partner-admin/sellers/:id
 */
router.get('/sellers/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, partner_id, full_name, login, job_title, created_at, updated_at FROM partner_sellers WHERE id = ? AND partner_id = ?',
      [req.params.id, req.partnerId]
    );
    if (rows.length === 0) return error(res, 'Seller not found', 404);
    success(res, { seller: rows[0] });
  } catch (err) {
    error(res, 'Error fetching seller', 500, err);
  }
});

/**
 * PUT /api/partner-admin/sellers/:id
 * Можно обновить full_name, job_title, login; опционально новый password.
 */
router.put('/sellers/:id', [
  body('full_name').optional().notEmpty().withMessage('Full name cannot be empty'),
  body('login').optional().notEmpty().withMessage('Login cannot be empty'),
  body('password')
    .optional()
    .custom((val) => val === '' || val == null || (typeof val === 'string' && val.trim().length >= 6))
    .withMessage('Password must be at least 6 characters'),
  body('job_title').optional().isString()
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }
    const [existing] = await pool.execute(
      'SELECT id FROM partner_sellers WHERE id = ? AND partner_id = ?',
      [req.params.id, req.partnerId]
    );
    if (existing.length === 0) return error(res, 'Seller not found', 404);
    const { full_name, login, password, job_title } = req.body;
    const updates = [];
    const params = [];
    if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
    if (login !== undefined) {
      const loginTrim = login.trim();
      const [dup] = await pool.execute(
        'SELECT id FROM partner_sellers WHERE partner_id = ? AND login = ? AND id != ?',
        [req.partnerId, loginTrim, req.params.id]
      );
      if (dup.length > 0) return error(res, 'Seller with this login already exists', 409);
      updates.push('login = ?'); params.push(loginTrim);
    }
    // Пароль обновляем только если передан непустой строковый пароль; null, undefined или пустая строка — оставляем старый
    if (typeof password === 'string' && password.trim() !== '') {
      const passwordHash = await hashPassword(password);
      updates.push('password_hash = ?'); params.push(passwordHash);
    }
    if (job_title !== undefined) { updates.push('job_title = ?'); params.push(job_title); }
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(req.params.id);
      await pool.execute(`UPDATE partner_sellers SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    const [rows] = await pool.execute(
      'SELECT id, partner_id, full_name, login, job_title, created_at, updated_at FROM partner_sellers WHERE id = ?',
      [req.params.id]
    );
    success(res, { seller: rows[0] }, 'Seller updated');
  } catch (err) {
    error(res, 'Error updating seller', 500, err);
  }
});

/**
 * DELETE /api/partner-admin/sellers/:id
 */
router.delete('/sellers/:id', async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM partner_sellers WHERE id = ? AND partner_id = ?',
      [req.params.id, req.partnerId]
    );
    if (result.affectedRows === 0) return error(res, 'Seller not found', 404);
    success(res, null, 'Seller deleted');
  } catch (err) {
    error(res, 'Error deleting seller', 500, err);
  }
});

// ——— История погашений ———

/**
 * GET /api/partner-admin/redemptions
 * Список погашений по партнёру с пагинацией.
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
              ps.full_name AS seller_name,
              u.display_name AS user_display_name, u.first_name AS user_first_name, u.second_name AS user_second_name, u.email AS user_email
       FROM partner_coin_redemptions r
       LEFT JOIN partner_branches b ON b.id = r.branch_id
       LEFT JOIN partner_sellers ps ON ps.id = r.seller_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.partner_id = ?
       ORDER BY r.created_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      [req.partnerId]
    );

    const [countResult] = await pool.execute(
      'SELECT COUNT(*) AS total FROM partner_coin_redemptions WHERE partner_id = ?',
      [req.partnerId]
    );
    const total = countResult[0].total;

    const redemptions = rows.map((r) => ({
      id: r.id,
      partnerId: r.partner_id,
      branchId: r.branch_id,
      branchName: r.branch_name,
      sellerId: r.seller_id,
      sellerName: r.seller_name,
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
    error(res, 'Error fetching redemption history', 500, err);
  }
});

module.exports = router;
