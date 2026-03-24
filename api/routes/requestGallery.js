const express = require('express');
const pool = require('../config/database');
const { upload, getFileUrlFromPath } = require('../middleware/upload');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

// Поддерживаем оба названия поля, как и в /upload
const uploadOne = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]);

/**
 * POST /api/request-gallery/upload
 * Загружает изображение в галерею для создания заявок.
 * FormData: file или image.
 */
router.post('/upload', uploadOne, async (req, res) => {
  try {
    const file = (req.files && req.files.file && req.files.file[0])
      || (req.files && req.files.image && req.files.image[0])
      || req.file;
    if (!file) {
      return error(res, 'File not received. Send an image in field "file" or "image" (multipart/form-data).', 400);
    }

    const imageUrl = getFileUrlFromPath(file.path);
    if (!imageUrl) {
      return error(res, 'Failed to build file URL', 500);
    }

    const uploadedBy = req.user?.userId || null;
    const [result] = await pool.execute(
      'INSERT INTO request_creation_gallery (image_url, uploaded_by) VALUES (?, ?)',
      [imageUrl, uploadedBy]
    );

    const [rows] = await pool.execute(
      'SELECT id, image_url, uploaded_by, created_at FROM request_creation_gallery WHERE id = ? LIMIT 1',
      [result.insertId]
    );
    const item = rows[0] || {
      id: result.insertId,
      image_url: imageUrl,
      uploaded_by: uploadedBy,
      created_at: new Date().toISOString()
    };

    return success(res, item, 'Image uploaded to request gallery', 201);
  } catch (e) {
    return error(res, e.message || 'Failed to upload image to request gallery', 500, e);
  }
});

/**
 * GET /api/request-gallery
 * Список изображений галереи для выбора при создании заявки.
 * Query: page, limit
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM request_creation_gallery'
    );
    const total = countRows[0] ? Number(countRows[0].total) : 0;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    // LIMIT/OFFSET интерполируем только после нормализации до int
    const [items] = await pool.execute(
      `SELECT id, image_url, uploaded_by, created_at
       FROM request_creation_gallery
       ORDER BY created_at DESC, id DESC
       LIMIT ${Math.floor(limit)} OFFSET ${Math.floor(offset)}`
    );

    return success(res, {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (e) {
    return error(res, e.message || 'Failed to fetch request gallery', 500, e);
  }
});

module.exports = router;
