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
 * GET /api/recycling-stations
 * Получение списка станций переработки
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, latitude, longitude, radius = 10000, waste_type } = req.query;
    
    // Валидация и преобразование параметров пагинации
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = 'SELECT * FROM recycling_stations';
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

    // Фильтр по типу мусора
    if (waste_type) {
      conditions.push('JSON_CONTAINS(accepted_waste_types, JSON_QUOTE(?)) = 1');
      params.push(waste_type);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

    const [stations] = await pool.execute(query, params);

    // Обработка JSON полей
    const processedStations = stations.map(station => {
      const result = { ...station };
      
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
      
      // Парсим accepted_waste_types
      if (result.accepted_waste_types) {
        try {
          result.accepted_waste_types = typeof result.accepted_waste_types === 'string' 
            ? JSON.parse(result.accepted_waste_types) 
            : result.accepted_waste_types;
        } catch (e) {
          result.accepted_waste_types = [];
        }
      } else {
        result.accepted_waste_types = [];
      }
      
      return result;
    });

    // Получение общего количества
    let countQuery = 'SELECT COUNT(*) as total FROM recycling_stations';
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
      stations: processedStations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    error(res, 'Ошибка при получении списка станций переработки', 500, err);
  }
});

/**
 * GET /api/recycling-stations/:id
 * Получение станции переработки по ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [stations] = await pool.execute(
      'SELECT * FROM recycling_stations WHERE id = ?',
      [id]
    );

    if (stations.length === 0) {
      return error(res, 'Станция переработки не найдена', 404);
    }

    const station = stations[0];
    
    // Парсим photo_urls
    if (station.photo_urls) {
      try {
        station.photo_urls = typeof station.photo_urls === 'string' 
          ? JSON.parse(station.photo_urls) 
          : station.photo_urls;
      } catch (e) {
        station.photo_urls = [];
      }
    } else {
      station.photo_urls = [];
    }

    // Парсим accepted_waste_types
    if (station.accepted_waste_types) {
      try {
        station.accepted_waste_types = typeof station.accepted_waste_types === 'string' 
          ? JSON.parse(station.accepted_waste_types) 
          : station.accepted_waste_types;
      } catch (e) {
        station.accepted_waste_types = [];
      }
    } else {
      station.accepted_waste_types = [];
    }

    success(res, { station });
  } catch (err) {
    error(res, 'Ошибка при получении станции переработки', 500, err);
  }
});

/**
 * POST /api/recycling-stations
 * Создание станции переработки (только для админов)
 * Поддерживает multipart/form-data с файлами
 */
router.post('/', authenticate, requireAdmin, upload.array('photos', 10), [
  body('name').notEmpty().withMessage('Название обязательно'),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('address').optional().isString(),
  body('activity').optional().isString(),
  body('website_url').optional().isURL(),
  body('accepted_waste_types').optional().isArray()
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
      photo_urls = [],
      accepted_waste_types = []
    } = bodyData;

    // Объединяем загруженные файлы с URL из JSON
    const finalPhotos = uploadedPhotos.length > 0 ? uploadedPhotos : (Array.isArray(photo_urls) ? photo_urls : []);

    // Обработка accepted_waste_types
    let processedWasteTypes = [];
    if (Array.isArray(accepted_waste_types) && accepted_waste_types.length > 0) {
      processedWasteTypes = accepted_waste_types;
    } else if (typeof accepted_waste_types === 'string') {
      try {
        processedWasteTypes = JSON.parse(accepted_waste_types);
      } catch (e) {
        processedWasteTypes = [];
      }
    }

    const stationId = generateId();

    // Создание станции переработки
    await pool.execute(
      `INSERT INTO recycling_stations (id, name, photo_urls, latitude, longitude, address, activity, website_url, accepted_waste_types, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        stationId,
        name,
        finalPhotos.length > 0 ? JSON.stringify(finalPhotos) : null,
        latitude || null,
        longitude || null,
        address || null,
        activity || null,
        website_url || null,
        processedWasteTypes.length > 0 ? JSON.stringify(processedWasteTypes) : null
      ]
    );

    // Получение созданной станции
    const [stations] = await pool.execute(
      'SELECT * FROM recycling_stations WHERE id = ?',
      [stationId]
    );

    const station = stations[0];
    
    // Парсим JSON поля
    if (station.photo_urls) {
      try {
        station.photo_urls = typeof station.photo_urls === 'string' 
          ? JSON.parse(station.photo_urls) 
          : station.photo_urls;
      } catch (e) {
        station.photo_urls = [];
      }
    } else {
      station.photo_urls = [];
    }

    if (station.accepted_waste_types) {
      try {
        station.accepted_waste_types = typeof station.accepted_waste_types === 'string' 
          ? JSON.parse(station.accepted_waste_types) 
          : station.accepted_waste_types;
      } catch (e) {
        station.accepted_waste_types = [];
      }
    } else {
      station.accepted_waste_types = [];
    }

    success(res, { station }, 'Станция переработки создана', 201);
  } catch (err) {
    error(res, 'Ошибка при создании станции переработки', 500, err);
  }
});

/**
 * PUT /api/recycling-stations/:id
 * Обновление станции переработки (только для админов)
 * Поддерживает multipart/form-data с файлами
 */
router.put('/:id', authenticate, requireAdmin, upload.array('photos', 10), async (req, res) => {
  try {
    const { id } = req.params;

    // Проверка существования
    const [existing] = await pool.execute('SELECT * FROM recycling_stations WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, 'Станция переработки не найдена', 404);
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
      photo_urls,
      accepted_waste_types
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

    // Обновление типов мусора
    if (accepted_waste_types !== undefined) {
      let processedWasteTypes = [];
      if (Array.isArray(accepted_waste_types) && accepted_waste_types.length > 0) {
        processedWasteTypes = accepted_waste_types;
      } else if (typeof accepted_waste_types === 'string') {
        try {
          processedWasteTypes = JSON.parse(accepted_waste_types);
        } catch (e) {
          processedWasteTypes = [];
        }
      }
      updates.push('accepted_waste_types = ?');
      params.push(processedWasteTypes.length > 0 ? JSON.stringify(processedWasteTypes) : null);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(id);
      await pool.execute(`UPDATE recycling_stations SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // Получение обновленной станции
    const [stations] = await pool.execute(
      'SELECT * FROM recycling_stations WHERE id = ?',
      [id]
    );

    const station = stations[0];
    
    // Парсим JSON поля
    if (station.photo_urls) {
      try {
        station.photo_urls = typeof station.photo_urls === 'string' 
          ? JSON.parse(station.photo_urls) 
          : station.photo_urls;
      } catch (e) {
        station.photo_urls = [];
      }
    } else {
      station.photo_urls = [];
    }

    if (station.accepted_waste_types) {
      try {
        station.accepted_waste_types = typeof station.accepted_waste_types === 'string' 
          ? JSON.parse(station.accepted_waste_types) 
          : station.accepted_waste_types;
      } catch (e) {
        station.accepted_waste_types = [];
      }
    } else {
      station.accepted_waste_types = [];
    }

    success(res, { station }, 'Станция переработки обновлена');
  } catch (err) {
    error(res, 'Ошибка при обновлении станции переработки', 500, err);
  }
});

/**
 * DELETE /api/recycling-stations/:id
 * Удаление станции переработки (только для админов)
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT id FROM recycling_stations WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, 'Станция переработки не найдена', 404);
    }

    await pool.execute('DELETE FROM recycling_stations WHERE id = ?', [id]);

    success(res, null, 'Станция переработки удалена');
  } catch (err) {
    error(res, 'Ошибка при удалении станции переработки', 500, err);
  }
});

module.exports = router;

