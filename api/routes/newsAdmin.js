const express = require('express');
const { body, param, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

/**
 * GET /api/news-admin
 * Список всех новостей для админки (как у partner-admin — отдельный путь)
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await pool.execute(
      `SELECT n.id, n.title, n.text, n.image_url, n.published_at, n.view_count, n.created_at, n.updated_at,
       (SELECT COUNT(*) FROM news_likes WHERE news_id = n.id) AS likes_count
       FROM news n
       ORDER BY n.published_at DESC
       LIMIT ? OFFSET ?`,
      [limitNum, offset]
    );

    const [countResult] = await pool.execute('SELECT COUNT(*) AS total FROM news');
    const total = countResult[0].total;

    return success(res, {
      news: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    return error(res, 'Error fetching news list', 500, err);
  }
});

/**
 * GET /api/news-admin/:id
 */
router.get('/:id', [param('id').isUUID()], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return error(res, 'Invalid news ID', 400);
    }
    const { id } = req.params;

    const [rows] = await pool.execute(
      `SELECT n.id, n.title, n.text, n.image_url, n.published_at, n.view_count, n.created_at, n.updated_at,
       (SELECT COUNT(*) FROM news_likes WHERE news_id = n.id) AS likes_count
       FROM news n WHERE n.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return error(res, 'News not found', 404);
    }

    return success(res, { news: rows[0] });
  } catch (err) {
    return error(res, 'Error fetching news', 500, err);
  }
});

/**
 * POST /api/news-admin
 */
router.post('/', [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('text').trim().notEmpty().withMessage('Text is required'),
  body('image_url').optional({ values: 'null' }).trim(),
  body('published_at').trim().notEmpty().withMessage('Published date is required')
], async (req, res) => {
  try {
    const val = validationResult(req);
    if (!val.isEmpty()) {
      return error(res, val.array()[0].msg || 'Validation error', 400, val.array());
    }

    const { title, text, image_url, published_at } = req.body;
    const id = generateId();
    let imageUrl = image_url != null && String(image_url).trim() ? String(image_url).trim() : null;
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      return error(res, 'Invalid image URL', 400);
    }
    const publishedAt = new Date(published_at);
    if (isNaN(publishedAt.getTime())) {
      return error(res, 'Invalid published date', 400);
    }

    await pool.execute(
      `INSERT INTO news (id, title, text, image_url, published_at, view_count)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [id, title.trim(), text.trim(), imageUrl, publishedAt.toISOString().slice(0, 19).replace('T', ' ')]
    );

    const [created] = await pool.execute(
      'SELECT id, title, text, image_url, published_at, view_count, created_at FROM news WHERE id = ?',
      [id]
    );

    return success(res, { news: created[0] }, 'News created', 201);
  } catch (err) {
    return error(res, 'Error creating news', 500, err);
  }
});

/**
 * PUT /api/news-admin/:id
 */
router.put('/:id', [
  param('id').isUUID(),
  body('title').optional().trim().notEmpty(),
  body('text').optional().trim().notEmpty(),
  body('image_url').optional({ values: 'null' }).trim(),
  body('published_at').optional().trim()
], async (req, res) => {
  try {
    const val = validationResult(req);
    if (!val.isEmpty()) {
      return error(res, val.array()[0].msg || 'Validation error', 400, val.array());
    }

    const { id } = req.params;
    const { title, text, image_url, published_at } = req.body;

    const [existing] = await pool.execute('SELECT id FROM news WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, 'News not found', 404);
    }

    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title.trim());
    }
    if (text !== undefined) {
      updates.push('text = ?');
      params.push(text.trim());
    }
    if (image_url !== undefined) {
      const img = image_url != null && String(image_url).trim() ? String(image_url).trim() : null;
      if (img && !/^https?:\/\//i.test(img)) {
        return error(res, 'Invalid image URL', 400);
      }
      updates.push('image_url = ?');
      params.push(img);
    }
    if (published_at !== undefined) {
      const d = new Date(published_at);
      if (isNaN(d.getTime())) {
        return error(res, 'Invalid published date', 400);
      }
      updates.push('published_at = ?');
      params.push(d.toISOString().slice(0, 19).replace('T', ' '));
    }

    if (updates.length === 0) {
      return error(res, 'No data to update', 400);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await pool.execute(
      `UPDATE news SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const [updated] = await pool.execute(
      `SELECT n.id, n.title, n.text, n.image_url, n.published_at, n.view_count, n.created_at, n.updated_at,
       (SELECT COUNT(*) FROM news_likes WHERE news_id = n.id) AS likes_count
       FROM news n WHERE n.id = ?`,
      [id]
    );

    return success(res, { news: updated[0] }, 'News updated');
  } catch (err) {
    return error(res, 'Error updating news', 500, err);
  }
});

/**
 * DELETE /api/news-admin/:id
 */
router.delete('/:id', [param('id').isUUID()], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return error(res, 'Invalid news ID', 400);
    }
    const { id } = req.params;

    const [result] = await pool.execute('DELETE FROM news WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return error(res, 'News not found', 404);
    }

    return success(res, null, 'News deleted');
  } catch (err) {
    return error(res, 'Error deleting news', 500, err);
  }
});

module.exports = router;
