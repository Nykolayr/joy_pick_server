const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { upload } = require('../middleware/upload');
const path = require('path');

const router = express.Router();

/**
 * GET /api/partners
 * Получение списка партнеров
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, latitude, longitude, radius = 10000 } = req.query;
    
    // Валидация и преобразование параметров пагинации
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = 'SELECT * FROM partners';
    const conditions = [];
    const params = [];

    // Фильтр по радиусу
    if (latitude && longitude) {
      conditions.push(`
        (6371000 * acos(
          cos(radians(?)) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(latitude))
        )) <= ?
      `);
      params.push(parseFloat(latitude), parseFloat(longitude), parseFloat(latitude), parseFloat(radius));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

    const [partners] = await pool.execute(query, params);

    // Обработка JSON полей
    const processedPartners = partners.map(partner => {
      const result = { ...partner };
      
      // Парсим photo_urls
      if (result.photo_urls) {
        try {
          result.photo_urls = typeof result.photo_urls === 'string' 
            ? JSON.parse(result.photo_urls) 
            : result.photo_urls;
        } catch (e) {
          result.photo_urls = [];
        }
      } else {
        result.photo_urls = [];
      }
      
      return result;
    });

    // Получение общего количества
    let countQuery = 'SELECT COUNT(*) as total FROM partners';
    const countParams = [];
    const countConditions = [];
    
    if (conditions.length > 0) {
      let paramIndex = 0;
      for (let i = 0; i < conditions.length; i++) {
        const condition = conditions[i];
        if (!condition.includes('6371000')) {
          countConditions.push(condition);
          countParams.push(params[paramIndex]);
          paramIndex++;
        } else {
          paramIndex += 4;
        }
      }
      
      if (countConditions.length > 0) {
        countQuery += ' WHERE ' + countConditions.join(' AND ');
      }
    }
    
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

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
      return error(res, 'Партнер не найден', 404);
    }

    const partner = partners[0];
    
    // Парсим photo_urls
    if (partner.photo_urls) {
      try {
        partner.photo_urls = typeof partner.photo_urls === 'string' 
          ? JSON.parse(partner.photo_urls) 
          : partner.photo_urls;
      } catch (e) {
        partner.photo_urls = [];
      }
    } else {
      partner.photo_urls = [];
    }

    success(res, { partner });
  } catch (err) {
    error(res, 'Ошибка при получении партнера', 500, err);
  }
});

/**
 * POST /api/partners
 * Создание партнера (только для админов)
 * Поддерживает multipart/form-data с файлами
 */
router.post('/', authenticate, requireAdmin, upload.array('photos', 10), [
  body('name').notEmpty().withMessage('Название обязательно'),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('address').optional().isString(),
  body('activity').optional().isString(),
  body('website_url').optional().isURL()
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    // Обработка загруженных файлов
    const uploadedPhotos = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const fileUrl = `http://autogie1.bget.ru/uploads/photos/${path.basename(file.path)}`;
        uploadedPhotos.push(fileUrl);
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
      latitude,
      longitude,
      address,
      activity,
      website_url,
      photo_urls = []
    } = bodyData;

    // Объединяем загруженные файлы с URL из JSON (приоритет у загруженных файлов)
    const finalPhotos = uploadedPhotos.length > 0 ? uploadedPhotos : (Array.isArray(photo_urls) ? photo_urls : []);

    const partnerId = generateId();

    // Создание партнера
    await pool.execute(
      `INSERT INTO partners (id, name, photo_urls, latitude, longitude, address, activity, website_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        partnerId,
        name,
        finalPhotos.length > 0 ? JSON.stringify(finalPhotos) : null,
        latitude || null,
        longitude || null,
        address || null,
        activity || null,
        website_url || null
      ]
    );

    // Получение созданного партнера
    const [partners] = await pool.execute(
      'SELECT * FROM partners WHERE id = ?',
      [partnerId]
    );

    const partner = partners[0];
    
    // Парсим photo_urls
    if (partner.photo_urls) {
      try {
        partner.photo_urls = typeof partner.photo_urls === 'string' 
          ? JSON.parse(partner.photo_urls) 
          : partner.photo_urls;
      } catch (e) {
        partner.photo_urls = [];
      }
    } else {
      partner.photo_urls = [];
    }

    success(res, { partner }, 'Партнер создан', 201);
  } catch (err) {
    error(res, 'Ошибка при создании партнера', 500, err);
  }
});

/**
 * PUT /api/partners/:id
 * Обновление партнера (только для админов)
 * Поддерживает multipart/form-data с файлами
 */
router.put('/:id', authenticate, requireAdmin, upload.array('photos', 10), async (req, res) => {
  try {
    const { id } = req.params;

    // Проверка существования
    const [existing] = await pool.execute('SELECT * FROM partners WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, 'Партнер не найден', 404);
    }

    // Обработка загруженных файлов
    const uploadedPhotos = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const fileUrl = `http://autogie1.bget.ru/uploads/photos/${path.basename(file.path)}`;
        uploadedPhotos.push(fileUrl);
      }
    }

    // Парсим JSON данные
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
      latitude,
      longitude,
      address,
      activity,
      website_url,
      photo_urls
    } = bodyData;

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (latitude !== undefined) {
      updates.push('latitude = ?');
      params.push(latitude);
    }
    if (longitude !== undefined) {
      updates.push('longitude = ?');
      params.push(longitude);
    }
    if (address !== undefined) {
      updates.push('address = ?');
      params.push(address);
    }
    if (activity !== undefined) {
      updates.push('activity = ?');
      params.push(activity);
    }
    if (website_url !== undefined) {
      updates.push('website_url = ?');
      params.push(website_url);
    }

    // Обновление фотографий
    if (uploadedPhotos.length > 0 || photo_urls !== undefined) {
      const finalPhotos = uploadedPhotos.length > 0 
        ? uploadedPhotos 
        : (Array.isArray(photo_urls) ? photo_urls : []);
      updates.push('photo_urls = ?');
      params.push(finalPhotos.length > 0 ? JSON.stringify(finalPhotos) : null);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(id);
      await pool.execute(`UPDATE partners SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // Получение обновленного партнера
    const [partners] = await pool.execute(
      'SELECT * FROM partners WHERE id = ?',
      [id]
    );

    const partner = partners[0];
    
    // Парсим photo_urls
    if (partner.photo_urls) {
      try {
        partner.photo_urls = typeof partner.photo_urls === 'string' 
          ? JSON.parse(partner.photo_urls) 
          : partner.photo_urls;
      } catch (e) {
        partner.photo_urls = [];
      }
    } else {
      partner.photo_urls = [];
    }

    success(res, { partner }, 'Партнер обновлен');
  } catch (err) {
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
    error(res, 'Ошибка при удалении партнера', 500, err);
  }
});

module.exports = router;
