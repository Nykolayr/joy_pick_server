const express = require('express');
const { body, param, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, optionalAuthenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');
const { SUPPORTED_LOCALES, parseContent, translateToAllLocales } = require('../services/translateNews');

const router = express.Router();

function parseI18n(val) {
  if (val == null) return {};
  if (typeof val === 'object') return val;
  try {
    return typeof val === 'string' ? JSON.parse(val) : {};
  } catch (e) {
    return {};
  }
}

/** Выбрать текст по локали из JSON i18n, fallback на en */
function pickLocale(i18n, locale) {
  const obj = parseI18n(i18n);
  return (obj[locale] != null && String(obj[locale]).trim() !== '') ? String(obj[locale]) : (obj.en != null ? String(obj.en) : '');
}

/** Преобразовать строку новости из БД (с *_i18n) в плоские title, short_description, text для locale */
function rowToLocale(row, locale) {
  const r = { ...row };
  r.title = pickLocale(row.title_i18n, locale);
  r.short_description = pickLocale(row.short_description_i18n, locale);
  r.text = pickLocale(row.text_i18n, locale);
  delete r.title_i18n;
  delete r.short_description_i18n;
  delete r.text_i18n;
  return r;
}

function validateLocale(locale) {
  return locale && SUPPORTED_LOCALES.includes(String(locale).toLowerCase());
}

/** Для обратной совместимости: если locale не передан или неверный — используем en */
function resolveLocale(queryLocale) {
  const locale = (queryLocale || '').toLowerCase();
  return validateLocale(locale) ? locale : 'en';
}

/**
 * GET /api/news
 * Список новостей. Query locale опционален: при отсутствии или неверном значении используется en.
 */
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const locale = resolveLocale(req.query.locale);

    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await pool.execute(
      `SELECT n.id, n.source_lang, n.title_i18n, n.short_description_i18n, n.text_i18n, n.image_url, n.published_at, n.view_count, n.created_at, n.updated_at,
       (SELECT COUNT(*) FROM news_likes WHERE news_id = n.id) AS likes_count
       FROM news n
       ORDER BY n.published_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`
    );

    const userId = req.user && req.user.userId;
    const list = rows.map(row => {
      const r = rowToLocale(row, locale);
      r.is_liked = false;
      return r;
    });

    if (userId && list.length > 0) {
      const ids = list.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const [likedRows] = await pool.execute(
        `SELECT news_id FROM news_likes WHERE user_id = ? AND news_id IN (${placeholders})`,
        [userId, ...ids]
      );
      const likedSet = new Set(likedRows.map(r => r.news_id));
      list.forEach(row => { row.is_liked = likedSet.has(row.id); });
    }

    const [countResult] = await pool.execute('SELECT COUNT(*) AS total FROM news');
    const total = countResult[0].total;

    return success(res, {
      news: list,
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
 * Создание новости (админ). Тело: content (title[|||]short_description[|||]text), source_lang, image_url?, published_at.
 * В ответе — translation_report (полный отчёт по переводу для админки).
 */
router.post('/', authenticate, requireAdmin, [
  body('content').trim().notEmpty().withMessage('content is required (title[|||]short_description[|||]text)'),
  body('source_lang').trim().notEmpty().withMessage('source_lang is required').isIn(SUPPORTED_LOCALES).withMessage('source_lang must be one of: ' + SUPPORTED_LOCALES.join(', ')),
  body('image_url').optional({ values: 'null' }).trim(),
  body('published_at').trim().notEmpty().withMessage('Published date is required')
], async (req, res) => {
  try {
    const val = validationResult(req);
    if (!val.isEmpty()) {
      return error(res, val.array()[0].msg || 'Validation error', 400, val.array());
    }

    const { content, source_lang, image_url, published_at } = req.body;
    const parsed = parseContent(content);
    if (parsed.error) {
      return error(res, parsed.error, 400);
    }

    let imageUrl = image_url != null && String(image_url).trim() ? String(image_url).trim() : null;
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      return error(res, 'Invalid image URL', 400);
    }
    const publishedAt = new Date(published_at);
    if (isNaN(publishedAt.getTime())) {
      return error(res, 'Invalid published date', 400);
    }

    const { title_i18n, short_description_i18n, text_i18n, translation_report } = await translateToAllLocales(
      source_lang,
      parsed.title,
      parsed.short_description,
      parsed.text
    );

    const id = generateId();
    await pool.execute(
      `INSERT INTO news (id, source_lang, title_i18n, short_description_i18n, text_i18n, image_url, published_at, view_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        id,
        source_lang,
        JSON.stringify(title_i18n),
        JSON.stringify(short_description_i18n),
        JSON.stringify(text_i18n),
        imageUrl,
        publishedAt.toISOString().slice(0, 19).replace('T', ' ')
      ]
    );

    const [created] = await pool.execute(
      'SELECT id, source_lang, title_i18n, short_description_i18n, text_i18n, image_url, published_at, view_count, created_at, updated_at FROM news WHERE id = ?',
      [id]
    );

    const news = rowToLocale(created[0], 'en');
    return success(res, { news, translation_report }, 'News created', 201);
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
 * Одна новость. Query locale опционален: при отсутствии или неверном значении используется en. По умолчанию +1 просмотр; при skip_view=1 и админ — без инкремента.
 */
router.get('/:id', optionalAuthenticate, [
  param('id').isUUID()
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return error(res, 'Invalid news ID', 400);
    }
    const locale = resolveLocale(req.query.locale);
    const { id } = req.params;
    const skipView = req.query.skip_view === '1' && req.user && req.user.isAdmin;

    const [rows] = await pool.execute(
      `SELECT n.id, n.source_lang, n.title_i18n, n.short_description_i18n, n.text_i18n, n.image_url, n.published_at, n.view_count, n.created_at, n.updated_at,
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

    const news = rowToLocale(rows[0], locale);
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
 * Редактирование новости (админ). Можно передать content + source_lang (пересчёт переводов) и/или image_url, published_at.
 * В ответе — translation_report при обновлении контента.
 */
router.put('/:id', authenticate, requireAdmin, [
  param('id').isUUID(),
  body('content').optional().trim().notEmpty(),
  body('source_lang').optional().trim().isIn(SUPPORTED_LOCALES),
  body('image_url').optional({ values: 'null' }).trim(),
  body('published_at').optional().trim()
], async (req, res) => {
  try {
    const val = validationResult(req);
    if (!val.isEmpty()) {
      return error(res, val.array()[0].msg || 'Validation error', 400, val.array());
    }

    const { id } = req.params;
    const { content, source_lang, image_url, published_at } = req.body;

    const [existing] = await pool.execute('SELECT id FROM news WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, 'News not found', 404);
    }

    let translation_report = null;

    if (content != null && content !== '' && source_lang) {
      const parsed = parseContent(content);
      if (parsed.error) {
        return error(res, parsed.error, 400);
      }
      const result = await translateToAllLocales(source_lang, parsed.title, parsed.short_description, parsed.text);
      translation_report = result.translation_report;
      await pool.execute(
        `UPDATE news SET source_lang = ?, title_i18n = ?, short_description_i18n = ?, text_i18n = ?, updated_at = NOW() WHERE id = ?`,
        [
          source_lang,
          JSON.stringify(result.title_i18n),
          JSON.stringify(result.short_description_i18n),
          JSON.stringify(result.text_i18n),
          id
        ]
      );
    }

    const updates = [];
    const params = [];
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
    if (updates.length > 0) {
      params.push(id);
      await pool.execute(`UPDATE news SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
    }

    const [updated] = await pool.execute(
      `SELECT n.id, n.source_lang, n.title_i18n, n.short_description_i18n, n.text_i18n, n.image_url, n.published_at, n.view_count, n.created_at, n.updated_at,
       (SELECT COUNT(*) FROM news_likes WHERE news_id = n.id) AS likes_count
       FROM news n WHERE n.id = ?`,
      [id]
    );
    const news = rowToLocale(updated[0], 'en');
    const payload = { news };
    if (translation_report) payload.translation_report = translation_report;
    return success(res, payload, 'News updated');
  } catch (err) {
    return error(res, 'Error updating news', 500, err);
  }
});

/**
 * DELETE /api/news/:id
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
