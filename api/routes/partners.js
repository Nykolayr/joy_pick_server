const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { uploadPartnerPhotos, getFileUrlFromPath } = require('../middleware/upload');

const router = express.Router();

/**
 * GET /api/partners
 * Получение списка партнеров
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, city, latitude, longitude, radius = 10000 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT p.*,
       GROUP_CONCAT(DISTINCT pp.photo_url) as photos,
       GROUP_CONCAT(DISTINCT pt.type_name) as partner_types
      FROM partners p
      LEFT JOIN partner_photos pp ON p.id = pp.partner_id
      LEFT JOIN partner_types pt ON p.id = pt.partner_id
    `;

    const conditions = [];
    const params = [];

    if (city) {
      conditions.push('p.city = ?');
      params.push(city);
    }

    // Фильтр по радиусу
    if (latitude && longitude) {
      conditions.push(`
        (6371000 * acos(
          cos(radians(?)) * cos(radians(p.latitude)) *
          cos(radians(p.longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(p.latitude))
        )) <= ?
      `);
      params.push(parseFloat(latitude), parseFloat(longitude), parseFloat(latitude), parseFloat(radius));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' GROUP BY p.id ORDER BY p.rating DESC, p.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [partners] = await pool.execute(query, params);

    // Обработка результатов
    const processedPartners = partners.map(partner => {
      const result = Object.assign({}, partner);
      result.photos = partner.photos ? partner.photos.split(',') : [];
      result.partner_types = partner.partner_types ? partner.partner_types.split(',') : [];
      return result;
    });

    // Получение общего количества
    let countQuery = 'SELECT COUNT(*) as total FROM partners';
    const countParams = [];
    
    if (conditions.length > 0) {
      const countConditions = conditions.filter(c => !c.includes('6371000'));
      if (countConditions.length > 0) {
        countQuery += ' WHERE ' + countConditions.join(' AND ');
        params.slice(0, -2).forEach((p, i) => {
          if (!conditions[i].includes('6371000')) {
            countParams.push(p);
          }
        });
      }
    }
    
    const [countResult] = await pool.execute(countQuery, countParams.length > 0 ? countParams : []);
    const total = countResult[0].total;

    success(res, {
      partners: processedPartners,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Ошибка получения партнеров:', err);
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
      `SELECT p.*,
       GROUP_CONCAT(DISTINCT pp.photo_url) as photos,
       GROUP_CONCAT(DISTINCT pt.type_name) as partner_types
      FROM partners p
      LEFT JOIN partner_photos pp ON p.id = pp.partner_id
      LEFT JOIN partner_types pt ON p.id = pt.partner_id
      WHERE p.id = ?
      GROUP BY p.id`,
      [id]
    );

    if (partners.length === 0) {
      return error(res, 'Партнер не найден', 404);
    }

    const partner = partners[0];
    partner.photos = partner.photos ? partner.photos.split(',') : [];
    partner.partner_types = partner.partner_types ? partner.partner_types.split(',') : [];

    success(res, { partner });
  } catch (err) {
    console.error('Ошибка получения партнера:', err);
    error(res, 'Ошибка при получении партнера', 500, err);
  }
});

/**
 * POST /api/partners
 * Создание партнера (только для админов)
 * Поддерживает загрузку файлов через multipart/form-data:
 * - photos: массив файлов для фото партнера
 * 
 * Также поддерживает отправку URL через JSON (для обратной совместимости)
 */
router.post('/', authenticate, requireAdmin, uploadPartnerPhotos, [
  body('name').notEmpty().withMessage('Название обязательно'),
  body('description').optional().isString(),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('city').optional().isString()
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    // Обработка загруженных файлов
    const uploadedPhotos = [];
    if (req.files && req.files.photos && Array.isArray(req.files.photos)) {
      for (const file of req.files.photos) {
        const fileUrl = getFileUrlFromPath(file.path);
        if (fileUrl) uploadedPhotos.push(fileUrl);
      }
    }

    // Парсим JSON данные (если отправлены как JSON)
    let bodyData = req.body;
    if (typeof req.body === 'string') {
      try {
        bodyData = JSON.parse(req.body);
      } catch (e) {
        // Если не JSON, используем как есть
      }
    }

    const {
      name,
      description,
      latitude,
      longitude,
      city,
      rating = 0,
      photos = [],
      partner_types = []
    } = bodyData;

    // Объединяем загруженные файлы с URL из JSON (приоритет у загруженных файлов)
    const finalPhotos = uploadedPhotos.length > 0 ? uploadedPhotos : (Array.isArray(photos) ? photos : []);

    const partnerId = generateId();

    // Создание партнера
    await pool.execute(
      `INSERT INTO partners (id, name, description, latitude, longitude, city, rating)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [partnerId, name, description || null, latitude || null, longitude || null, city || null, rating]
    );

    // Добавление фотографий
    if (finalPhotos.length > 0) {
      for (const photoUrl of finalPhotos) {
        await pool.execute(
          'INSERT INTO partner_photos (id, partner_id, photo_url) VALUES (?, ?, ?)',
          [generateId(), partnerId, photoUrl]
        );
      }
    }

    // Добавление типов
    if (partner_types.length > 0) {
      for (const typeName of partner_types) {
        await pool.execute(
          'INSERT INTO partner_types (id, partner_id, type_name) VALUES (?, ?, ?)',
          [generateId(), partnerId, typeName]
        );
      }
    }

    // Получение созданного партнера
    const [partners] = await pool.execute(
      `SELECT p.*,
       GROUP_CONCAT(DISTINCT pp.photo_url) as photos,
       GROUP_CONCAT(DISTINCT pt.type_name) as partner_types
      FROM partners p
      LEFT JOIN partner_photos pp ON p.id = pp.partner_id
      LEFT JOIN partner_types pt ON p.id = pt.partner_id
      WHERE p.id = ?
      GROUP BY p.id`,
      [partnerId]
    );

    const partner = partners[0];
    partner.photos = partner.photos ? partner.photos.split(',') : [];
    partner.partner_types = partner.partner_types ? partner.partner_types.split(',') : [];

    success(res, { partner }, 'Партнер создан', 201);
  } catch (err) {
    console.error('Ошибка создания партнера:', err);
    error(res, 'Ошибка при создании партнера', 500, err);
  }
});

/**
 * PUT /api/partners/:id
 * Обновление партнера (только для админов)
 */
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, latitude, longitude, city, rating, photos, partner_types } = req.body;

    // Проверка существования
    const [existing] = await pool.execute('SELECT id FROM partners WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, 'Партнер не найден', 404);
    }

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (latitude !== undefined) {
      updates.push('latitude = ?');
      params.push(latitude);
    }
    if (longitude !== undefined) {
      updates.push('longitude = ?');
      params.push(longitude);
    }
    if (city !== undefined) {
      updates.push('city = ?');
      params.push(city);
    }
    if (rating !== undefined) {
      updates.push('rating = ?');
      params.push(rating);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(id);
      await pool.execute(`UPDATE partners SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // Обновление фотографий и типов, если указаны
    if (photos !== undefined) {
      await pool.execute('DELETE FROM partner_photos WHERE partner_id = ?', [id]);
      if (photos.length > 0) {
        for (const photoUrl of photos) {
          await pool.execute(
            'INSERT INTO partner_photos (id, partner_id, photo_url) VALUES (?, ?, ?)',
            [generateId(), id, photoUrl]
          );
        }
      }
    }

    if (partner_types !== undefined) {
      await pool.execute('DELETE FROM partner_types WHERE partner_id = ?', [id]);
      if (partner_types.length > 0) {
        for (const typeName of partner_types) {
          await pool.execute(
            'INSERT INTO partner_types (id, partner_id, type_name) VALUES (?, ?, ?)',
            [generateId(), id, typeName]
          );
        }
      }
    }

    // Получение обновленного партнера
    const [partners] = await pool.execute(
      `SELECT p.*,
       GROUP_CONCAT(DISTINCT pp.photo_url) as photos,
       GROUP_CONCAT(DISTINCT pt.type_name) as partner_types
      FROM partners p
      LEFT JOIN partner_photos pp ON p.id = pp.partner_id
      LEFT JOIN partner_types pt ON p.id = pt.partner_id
      WHERE p.id = ?
      GROUP BY p.id`,
      [id]
    );

    const partner = partners[0];
    partner.photos = partner.photos ? partner.photos.split(',') : [];
    partner.partner_types = partner.partner_types ? partner.partner_types.split(',') : [];

    success(res, { partner }, 'Партнер обновлен');
  } catch (err) {
    console.error('Ошибка обновления партнера:', err);
    error(res, 'Ошибка при обновлении партнера', 500, err);
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
      return error(res, 'Партнер не найден', 404);
    }

    await pool.execute('DELETE FROM partners WHERE id = ?', [id]);

    success(res, null, 'Партнер удален');
  } catch (err) {
    console.error('Ошибка удаления партнера:', err);
    error(res, 'Ошибка при удалении партнера', 500, err);
  }
});

module.exports = router;

