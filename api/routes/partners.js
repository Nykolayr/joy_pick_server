const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { uploadPartnerWithLogo } = require('../middleware/upload');
const { hashPassword } = require('../utils/password');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_BASE = process.env.BASE_URL || 'https://danilagames.ru';

/** Срок действия QR-кода волонтёра в секундах (одно место для бэка и ответа фронту). */
const VOLUNTEER_QR_VALID_SECONDS = 2 * 60; // 120 секунд = 2 минуты

const router = express.Router();

/**
 * GET /api/partners/volunteer-qr
 * Для волонтёра (JWT): создаёт одноразовый QR-токен для предъявления в филиале партнёра.
 * Срок жизни токена задаётся VOLUNTEER_QR_VALID_SECONDS. После списания токен помечается использованным.
 */
router.get('/volunteer-qr', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    if (!userId) {
      return error(res, 'Token is missing user identifier', 401);
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + VOLUNTEER_QR_VALID_SECONDS * 1000);
    const id = generateId();

    await pool.execute(
      'INSERT INTO volunteer_qr_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
      [id, userId, token, expiresAt]
    );

    success(res, {
      token,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: VOLUNTEER_QR_VALID_SECONDS
    }, 'QR token created');
  } catch (err) {
    error(res, 'Error creating QR token', 500, err);
  }
});

/**
 * GET /api/partners/my-redemptions
 * Для волонтёра (JWT): история погашений коинов у партнёров.
 */
router.get('/my-redemptions', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    if (!userId) {
      return error(res, 'Token is missing user identifier', 401);
    }
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await pool.execute(
      `SELECT r.id, r.partner_id, r.branch_id, r.coins_spent, r.amount_cents, r.currency, r.created_at,
              p.name AS partner_name,
              b.name AS branch_name
       FROM partner_coin_redemptions r
       LEFT JOIN partners p ON p.id = r.partner_id
       LEFT JOIN partner_branches b ON b.id = r.branch_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limitNum, offset]
    );

    const [countResult] = await pool.execute(
      'SELECT COUNT(*) AS total FROM partner_coin_redemptions WHERE user_id = ?',
      [userId]
    );
    const total = countResult[0].total;

    const redemptions = rows.map((r) => ({
      id: r.id,
      partnerId: r.partner_id,
      partnerName: r.partner_name,
      branchId: r.branch_id,
      branchName: r.branch_name,
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

/**
 * GET /api/partners
 * Получение списка партнеров
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, latitude, longitude, radius = 10000 } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query;
    let countQuery;
    const params = [];
    const lat = latitude != null && longitude != null ? parseFloat(latitude) : null;
    const lng = longitude != null && latitude != null ? parseFloat(longitude) : null;
    const rad = parseInt(radius) || 10000;

    // Адрес и координаты только у филиалов: фильтр по радиусу ищет партнёров, у которых есть филиал в радиусе
    if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
      query = `
        SELECT p.* FROM partners p
        WHERE p.id IN (
          SELECT b.partner_id FROM partner_branches b
          WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL
          AND (6371000 * acos(
            LEAST(1, GREATEST(-1,
              cos(radians(?)) * cos(radians(b.latitude)) * cos(radians(b.longitude) - radians(?)) +
              sin(radians(?)) * sin(radians(b.latitude))
            )))
          )) <= ?
        )
        ORDER BY p.created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `;
      params.push(lat, lng, lat, rad);
      countQuery = `
        SELECT COUNT(DISTINCT p.id) as total FROM partners p
        INNER JOIN partner_branches b ON b.partner_id = p.id
        WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL
        AND (6371000 * acos(
          LEAST(1, GREATEST(-1,
            cos(radians(?)) * cos(radians(b.latitude)) * cos(radians(b.longitude) - radians(?)) +
            sin(radians(?)) * sin(radians(b.latitude))
          )))
        )) <= ?
      `;
    } else {
      query = `SELECT * FROM partners ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
      countQuery = 'SELECT COUNT(*) as total FROM partners';
    }

    const [partners] = params.length ? await pool.execute(query, params) : await pool.execute(query);
    const [countResult] = params.length
      ? await pool.execute(countQuery, params.slice(0, 4))
      : await pool.execute(countQuery);
    const total = countResult[0].total;

    const processedPartners = partners.map(partner => {
      const result = { ...partner };
      if (result.photo_urls) {
        try {
          result.photo_urls = typeof result.photo_urls === 'string' ? JSON.parse(result.photo_urls) : result.photo_urls;
        } catch (e) {
          result.photo_urls = [];
        }
      } else {
        result.photo_urls = [];
      }
      result.branches = [];
      return result;
    });

    if (processedPartners.length > 0) {
      const partnerIds = processedPartners.map(p => p.id);
      const placeholders = partnerIds.map(() => '?').join(',');
      const [branchRows] = await pool.execute(
        `SELECT id, partner_id, name, address, latitude, longitude, created_at, updated_at FROM partner_branches WHERE partner_id IN (${placeholders}) ORDER BY name`,
        partnerIds
      );
      const branchesByPartner = {};
      for (const row of branchRows) {
        if (!branchesByPartner[row.partner_id]) branchesByPartner[row.partner_id] = [];
        branchesByPartner[row.partner_id].push(row);
      }
      for (const p of processedPartners) {
        p.branches = branchesByPartner[p.id] || [];
      }
    }

    success(res, {
      partners: processedPartners,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    error(res, 'Ошибка при получении списка партнеров', 500, err);
  }
});

/**
 * GET /api/partners/:id
 * Получение партнера по ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [partners] = await pool.execute(
      'SELECT * FROM partners WHERE id = ?',
      [id]
    );

    if (partners.length === 0) {
      return error(res, 'Partner not found', 404);
    }

    const partner = partners[0];

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
      [id]
    );
    partner.branches = branchRows;

    success(res, { partner });
  } catch (err) {
    error(res, 'Error fetching partner', 500, err);
  }
});

/**
 * POST /api/partners
 * Создание партнера (только для админов).
 * Поля: название, лого (файл или logo_url), логин (admin_email), пароль (генерируется на фронте),
 * филиалы (массив { name, address?, latitude?, longitude? }), массив фото (photos/photo_urls), url сайта.
 * Адрес и координаты только у филиалов, у партнёра этих полей нет.
 */
router.post('/', authenticate, requireAdmin, uploadPartnerWithLogo, [
  body('name').notEmpty().withMessage('Name is required'),
  body('admin_email').isEmail().withMessage('Login (email) is required and must be a valid email'),
  body('admin_password').notEmpty().withMessage('Password is required (e.g. generated)'),
  body('activity').optional().isString(),
  body('website_url').optional().isURL(),
  body('logo_url').optional().isString(),
  body('currency').notEmpty().withMessage('Currency is required (e.g. USD, RUB)'),
  body('exchange_rate_cents_per_coin').isInt({ min: 0 }).withMessage('Exchange rate: how many cents (or minor units) per 1 coin (0 = бесплатно за коины)'),
  body('branches')
    .optional()
    .customSanitizer((val) => {
      if (val == null) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const p = JSON.parse(val);
          return Array.isArray(p) ? p : [];
        } catch (e) {
          return [];
        }
      }
      return [];
    }),
  body('branches.*.name').optional().notEmpty(),
  body('branches.*.address').optional().isString(),
  body('branches.*.latitude').optional().isFloat(),
  body('branches.*.longitude').optional().isFloat()
], async (req, res) => {
  try {
    if (req.body && typeof req.body.photo_urls === 'string') {
      try {
        req.body.photo_urls = JSON.parse(req.body.photo_urls);
      } catch (e) {
        req.body.photo_urls = [];
      }
    }

    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }

    let bodyData = req.body;
    if (typeof req.body === 'string') {
      try {
        bodyData = JSON.parse(req.body);
      } catch (e) {}
    }

    const uploadedPhotos = [];
    if (req.files && req.files.photos && req.files.photos.length > 0) {
      for (const file of req.files.photos) {
        uploadedPhotos.push(`${UPLOADS_BASE}/uploads/photos/${path.basename(file.path)}`);
      }
    }

    let logoUrl = null;
    if (req.files && req.files.logo && req.files.logo[0]) {
      logoUrl = `${UPLOADS_BASE}/uploads/logos/${path.basename(req.files.logo[0].path)}`;
    } else if (bodyData.logo_url) {
      logoUrl = bodyData.logo_url;
    }

    const {
      name,
      admin_email,
      admin_password,
      activity,
      website_url,
      currency,
      exchange_rate_cents_per_coin,
      photo_urls = [],
      branches = []
    } = bodyData;

    const adminEmailNorm = (admin_email || '').trim().toLowerCase();
    const [existing] = await pool.execute('SELECT id FROM partners WHERE admin_email = ?', [adminEmailNorm]);
    if (existing.length > 0) {
      return error(res, 'Partner with this login (email) already exists', 409);
    }

    const finalPhotos = uploadedPhotos.length > 0 ? uploadedPhotos : (Array.isArray(photo_urls) ? photo_urls : []);
    const partnerId = generateId();
    const adminPasswordHash = await hashPassword(admin_password);
    const currencyCode = (currency || '').trim().toUpperCase().slice(0, 10);
    const rateRaw = parseInt(exchange_rate_cents_per_coin, 10);
    const rate = (rateRaw >= 0 && !isNaN(rateRaw)) ? rateRaw : 50;

    await pool.execute(
      `INSERT INTO partners (id, name, logo_url, photo_urls, activity, website_url,
        admin_email, admin_password_hash, currency, exchange_rate_cents_per_coin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        partnerId,
        name,
        logoUrl,
        finalPhotos.length > 0 ? JSON.stringify(finalPhotos) : null,
        activity || null,
        website_url || null,
        adminEmailNorm,
        adminPasswordHash,
        currencyCode,
        rate
      ]
    );

    const validBranches = Array.isArray(branches) ? branches.filter(b => b && b.name) : [];
    for (const b of validBranches) {
      const branchId = generateId();
      await pool.execute(
        'INSERT INTO partner_branches (id, partner_id, name, address, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)',
        [
          branchId,
          partnerId,
          b.name,
          b.address || null,
          b.latitude ?? null,
          b.longitude ?? null
        ]
      );
    }

    const [partners] = await pool.execute('SELECT * FROM partners WHERE id = ?', [partnerId]);
    const partner = partners[0];
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
      [partnerId]
    );
    partner.branches = branchRows;

    success(res, { partner }, 'Partner created', 201);
  } catch (err) {
    error(res, 'Error creating partner', 500, err);
  }
});

/**
 * PUT /api/partners/:id
 * Обновление партнера (только для админов).
 * Можно обновить: название, лого, логин (admin_email), пароль (admin_password), филиалы (branches — полная замена),
 * фото (photos/photo_urls), url сайта и остальные поля.
 */
router.put('/:id', authenticate, requireAdmin, uploadPartnerWithLogo, async (req, res) => {
  try {
    if (req.body && typeof req.body.branches === 'string') {
      try {
        req.body.branches = JSON.parse(req.body.branches);
      } catch (e) {
        req.body.branches = [];
      }
    }
    if (req.body && typeof req.body.photo_urls === 'string') {
      try {
        req.body.photo_urls = JSON.parse(req.body.photo_urls);
      } catch (e) {
        req.body.photo_urls = [];
      }
    }

    const { id } = req.params;

    const [existing] = await pool.execute('SELECT * FROM partners WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, 'Partner not found', 404);
    }

    const uploadedPhotos = [];
    if (req.files && req.files.photos && req.files.photos.length > 0) {
      for (const file of req.files.photos) {
        uploadedPhotos.push(`${UPLOADS_BASE}/uploads/photos/${path.basename(file.path)}`);
      }
    }

    let bodyData = req.body;
    if (typeof req.body === 'string') {
      try {
        bodyData = JSON.parse(req.body);
      } catch (e) {}
    }

    let logoUrl = undefined;
    if (req.files && req.files.logo && req.files.logo[0]) {
      logoUrl = `${UPLOADS_BASE}/uploads/logos/${path.basename(req.files.logo[0].path)}`;
    } else if (bodyData.logo_url !== undefined) {
      logoUrl = bodyData.logo_url || null;
    }

    const {
      name,
      admin_email,
      admin_password,
      activity,
      website_url,
      currency,
      exchange_rate_cents_per_coin,
      photo_urls,
      branches
    } = bodyData;

    if (admin_email !== undefined) {
      const adminEmailNorm = (admin_email || '').trim().toLowerCase();
      const [dup] = await pool.execute('SELECT id FROM partners WHERE admin_email = ? AND id != ?', [adminEmailNorm, id]);
      if (dup.length > 0) {
        return error(res, 'Partner with this login (email) already exists', 409);
      }
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (logoUrl !== undefined) { updates.push('logo_url = ?'); params.push(logoUrl); }
    if (activity !== undefined) { updates.push('activity = ?'); params.push(activity); }
    if (website_url !== undefined) { updates.push('website_url = ?'); params.push(website_url); }
    if (currency !== undefined) { updates.push('currency = ?'); params.push((currency || '').trim().toUpperCase().slice(0, 10)); }
    if (exchange_rate_cents_per_coin !== undefined) {
      const v = parseInt(exchange_rate_cents_per_coin, 10);
      updates.push('exchange_rate_cents_per_coin = ?');
      params.push((!isNaN(v) && v >= 0) ? v : 50);
    }
    if (admin_email !== undefined) { updates.push('admin_email = ?'); params.push((admin_email || '').trim().toLowerCase()); }
    // Пароль обновляем только если передан непустой строковый пароль; null, undefined или пустая строка — оставляем старый
    if (typeof admin_password === 'string' && admin_password.trim() !== '') {
      const adminPasswordHash = await hashPassword(admin_password);
      updates.push('admin_password_hash = ?');
      params.push(adminPasswordHash);
    }
    if (uploadedPhotos.length > 0 || photo_urls !== undefined) {
      const finalPhotos = uploadedPhotos.length > 0 ? uploadedPhotos : (Array.isArray(photo_urls) ? photo_urls : []);
      updates.push('photo_urls = ?');
      params.push(finalPhotos.length > 0 ? JSON.stringify(finalPhotos) : null);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(id);
      await pool.execute(`UPDATE partners SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    if (branches !== undefined && Array.isArray(branches)) {
      await pool.execute('DELETE FROM partner_branches WHERE partner_id = ?', [id]);
      const validBranches = branches.filter(b => b && b.name);
      for (const b of validBranches) {
        const branchId = generateId();
        await pool.execute(
          'INSERT INTO partner_branches (id, partner_id, name, address, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)',
          [branchId, id, b.name, b.address || null, b.latitude ?? null, b.longitude ?? null]
        );
      }
    }

    const [partners] = await pool.execute('SELECT * FROM partners WHERE id = ?', [id]);
    const partner = partners[0];
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
      [id]
    );
    partner.branches = branchRows;

    success(res, { partner }, 'Partner updated');
  } catch (err) {
    error(res, 'Error updating partner', 500, err);
  }
});

/**
 * DELETE /api/partners/:id
 * Удаление партнера (только для админов)
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT id FROM partners WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, 'Partner not found', 404);
    }

    await pool.execute('DELETE FROM partners WHERE id = ?', [id]);

    success(res, null, 'Partner deleted');
  } catch (err) {
    error(res, 'Error deleting partner', 500, err);
  }
});

module.exports = router;
