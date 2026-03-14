const express = require('express');
const { body, param, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, optionalAuthenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');

const router = express.Router();

// --- Как у recycling-stations: один путь /news, админские операции по auth ---

/**
 * GET /api/news
 * Список новостей (с пагинацией). С auth — в каждой новости is_liked.
 */
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    // LIMIT/OFFSET — числа в запросе (mysql2 не поддерживает плейсхолдеры для них), значения уже провалидированы
    const [rows] = await pool.execute(
      `SELECT n.id, n.title, n.short_description, n.text, n.image_url, n.published_at, n.view_count, n.created_at, n.updated_at,
       (SELECT COUNT(*) FROM news_likes WHERE news_id = n.id) AS likes_count
       FROM news n
       ORDER BY n.published_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`
    );

    const userId = req.user && req.user.userId;
    if (userId && rows.length > 0) {
      const ids = rows.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const [likedRows] = await pool.execute(
        `SELECT news_id FROM news_likes WHERE user_id = ? AND news_id IN (${placeholders})`,
        [userId, ...ids]
      );
      const likedSet = new Set(likedRows.map(r => r.news_id));
      rows.forEach(row => {
        row.is_liked = likedSet.has(row.id);
      });
    } else {
      rows.forEach(row => {
        row.is_liked = false;
      });
    }

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
 * POST /api/news
 * Создание новости (только админ). Как POST /api/recycling-stations.
 */
router.post('/', authenticate, requireAdmin, [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('short_description').optional({ values: 'null' }).trim().isLength({ max: 500 }),
  body('text').trim().notEmpty().withMessage('Text is required'),
  body('image_url').optional({ values: 'null' }).trim(),
  body('published_at').trim().notEmpty().withMessage('Published date is required')
], async (req, res) => {
  try {
    const val = validationResult(req);
    if (!val.isEmpty()) {
      return error(res, val.array()[0].msg || 'Validation error', 400, val.array());
    }

    const { title, short_description, text, image_url, published_at } = req.body;
    const id = generateId();
    let imageUrl = image_url != null && String(image_url).trim() ? String(image_url).trim() : null;
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      return error(res, 'Invalid image URL', 400);
    }
    const publishedAt = new Date(published_at);
    if (isNaN(publishedAt.getTime())) {
      return error(res, 'Invalid published date', 400);
    }

    const shortDesc = short_description != null && String(short_description).trim() ? String(short_description).trim().slice(0, 500) : null;
    await pool.execute(
      `INSERT INTO news (id, title, short_description, text, image_url, published_at, view_count)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [id, title.trim(), shortDesc, text.trim(), imageUrl, publishedAt.toISOString().slice(0, 19).replace('T', ' ')]
    );

    const [created] = await pool.execute(
      'SELECT id, title, short_description, text, image_url, published_at, view_count, created_at, updated_at FROM news WHERE id = ?',
      [id]
    );

    return success(res, { news: created[0] }, 'News created', 201);
  } catch (err) {
    return error(res, 'Error creating news', 500, err);
  }
});

/**
 * GET /api/news/:id/like-status
 */
router.get('/:id/like-status', authenticate, [
  param('id').isUUID()
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return error(res, 'Invalid news ID', 400);
    }
    const { id: newsId } = req.params;
    const userId = req.user.userId;

    const [newsRows] = await pool.execute('SELECT id FROM news WHERE id = ?', [newsId]);
    if (newsRows.length === 0) {
      return error(res, 'News not found', 404);
    }

    const [liked] = await pool.execute(
      'SELECT 1 FROM news_likes WHERE news_id = ? AND user_id = ?',
      [newsId, userId]
    );
    const [countRows] = await pool.execute('SELECT COUNT(*) AS c FROM news_likes WHERE news_id = ?', [newsId]);

    return success(res, {
      liked: liked.length > 0,
      likes_count: countRows[0].c
    });
  } catch (err) {
    return error(res, 'Error fetching like status', 500, err);
  }
});

/**
 * POST /api/news/:id/like
 * Toggle лайка. Требуется авторизация.
 */
router.post('/:id/like', authenticate, [
  param('id').isUUID()
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return error(res, 'Invalid news ID', 400);
    }
    const { id: newsId } = req.params;
    const userId = req.user.userId;

    const [newsRows] = await pool.execute('SELECT id FROM news WHERE id = ?', [newsId]);
    if (newsRows.length === 0) {
      return error(res, 'News not found', 404);
    }

    const [existing] = await pool.execute(
      'SELECT news_id FROM news_likes WHERE news_id = ? AND user_id = ?',
      [newsId, userId]
    );

    if (existing.length > 0) {
      await pool.execute('DELETE FROM news_likes WHERE news_id = ? AND user_id = ?', [newsId, userId]);
      const [countRows] = await pool.execute('SELECT COUNT(*) AS c FROM news_likes WHERE news_id = ?', [newsId]);
      return success(res, {
        liked: false,
        likes_count: countRows[0].c
      }, 'Like removed');
    }

    await pool.execute('INSERT INTO news_likes (news_id, user_id) VALUES (?, ?)', [newsId, userId]);
    const [countRows] = await pool.execute('SELECT COUNT(*) AS c FROM news_likes WHERE news_id = ?', [newsId]);
    return success(res, {
      liked: true,
      likes_count: countRows[0].c
    }, 'Like added');
  } catch (err) {
    return error(res, 'Error updating like', 500, err);
  }
});

/**
 * GET /api/news/:id
 * Одна новость. По умолчанию +1 просмотр. Если ?skip_view=1 и пользователь админ — просмотр не увеличиваем (для редактирования).
 */
router.get('/:id', optionalAuthenticate, [
  param('id').isUUID()
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return error(res, 'Invalid news ID', 400);
    }
    const { id } = req.params;
    const skipView = req.query.skip_view === '1' && req.user && req.user.isAdmin;

    const [rows] = await pool.execute(
      `SELECT n.id, n.title, n.short_description, n.text, n.image_url, n.published_at, n.view_count, n.created_at, n.updated_at,
       (SELECT COUNT(*) FROM news_likes WHERE news_id = n.id) AS likes_count
       FROM news n WHERE n.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return error(res, 'News not found', 404);
    }

    if (!skipView) {
      await pool.execute('UPDATE news SET view_count = view_count + 1, updated_at = NOW() WHERE id = ?', [id]);
    }

    const news = rows[0];
    if (!skipView) {
      news.view_count = (news.view_count || 0) + 1;
    }

    const userId = req.user && req.user.userId;
    if (userId) {
      const [liked] = await pool.execute(
        'SELECT 1 FROM news_likes WHERE news_id = ? AND user_id = ?',
        [id, userId]
      );
      news.is_liked = liked.length > 0;
    } else {
      news.is_liked = false;
    }

    return success(res, { news });
  } catch (err) {
    return error(res, 'Error fetching news', 500, err);
  }
});

/**
 * PUT /api/news/:id
 * Редактирование новости (только админ). Как PUT /api/recycling-stations/:id.
 */
router.put('/:id', authenticate, requireAdmin, [
  param('id').isUUID(),
  body('title').optional().trim().notEmpty(),
  body('short_description').optional({ values: 'null' }).trim().isLength({ max: 500 }),
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
    const { title, short_description, text, image_url, published_at } = req.body;

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
    if (short_description !== undefined) {
      const v = short_description != null && String(short_description).trim() ? String(short_description).trim().slice(0, 500) : null;
      updates.push('short_description = ?');
      params.push(v);
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
      `SELECT n.id, n.title, n.short_description, n.text, n.image_url, n.published_at, n.view_count, n.created_at, n.updated_at,
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
 * DELETE /api/news/:id
 * Удаление новости (только админ). Как DELETE /api/recycling-stations/:id.
 */
router.delete('/:id', authenticate, requireAdmin, [
  param('id').isUUID()
], async (req, res) => {
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
