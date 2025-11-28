const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateId } = require('../utils/uuid');

const router = express.Router();

/**
 * GET /api/waste-types
 * Получение списка всех типов отходов (публичный эндпоинт)
 */
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, danger, created_at, updated_at FROM waste_types ORDER BY name ASC'
    );

    success(res, rows);
  } catch (err) {
    console.error('Ошибка получения списка типов отходов:', err);
    error(res, 'Ошибка при получении списка типов отходов', 500, err);
  }
});

/**
 * GET /api/waste-types/:id
 * Получение типа отходов по ID (публичный эндпоинт)
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      'SELECT id, name, danger, created_at, updated_at FROM waste_types WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return error(res, 'Тип отходов не найден', 404);
    }

    success(res, rows[0]);
  } catch (err) {
    console.error('Ошибка получения типа отходов:', err);
    error(res, 'Ошибка при получении типа отходов', 500, err);
  }
});

/**
 * POST /api/waste-types
 * Создание нового типа отходов (только для администраторов)
 */
router.post('/', authenticate, requireAdmin, [
  body('name')
    .notEmpty()
    .withMessage('Название обязательно')
    .isString()
    .withMessage('Название должно быть строкой')
    .trim()
    .toLowerCase()
    .isLength({ min: 1, max: 255 })
    .withMessage('Название должно быть от 1 до 255 символов'),
  body('danger')
    .optional()
    .isBoolean()
    .withMessage('danger должен быть булевым значением'),
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { name, danger = false } = req.body;

    // Проверка на уникальность названия
    const [existing] = await pool.execute(
      'SELECT id FROM waste_types WHERE name = ?',
      [name]
    );

    if (existing.length > 0) {
      return error(res, 'Тип отходов с таким названием уже существует', 409);
    }

    const id = generateId();

    await pool.execute(
      'INSERT INTO waste_types (id, name, danger) VALUES (?, ?, ?)',
      [id, name, danger]
    );

    // Получение созданного типа отходов
    const [rows] = await pool.execute(
      'SELECT id, name, danger, created_at, updated_at FROM waste_types WHERE id = ?',
      [id]
    );

    success(res, rows[0], 'Тип отходов успешно создан', 201);
  } catch (err) {
    console.error('Ошибка создания типа отходов:', err);
    
    // Обработка ошибки дублирования (на случай, если проверка не сработала)
    if (err.code === 'ER_DUP_ENTRY') {
      return error(res, 'Тип отходов с таким названием уже существует', 409);
    }
    
    error(res, 'Ошибка при создании типа отходов', 500, err);
  }
});

/**
 * PUT /api/waste-types/:id
 * Обновление типа отходов (только для администраторов)
 */
router.put('/:id', authenticate, requireAdmin, [
  body('name')
    .optional()
    .isString()
    .withMessage('Название должно быть строкой')
    .trim()
    .toLowerCase()
    .isLength({ min: 1, max: 255 })
    .withMessage('Название должно быть от 1 до 255 символов'),
  body('danger')
    .optional()
    .isBoolean()
    .withMessage('danger должен быть булевым значением'),
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Ошибка валидации', 400, validationErrors.array());
    }

    const { id } = req.params;
    const { name, danger } = req.body;

    // Проверка существования
    const [existing] = await pool.execute(
      'SELECT id FROM waste_types WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return error(res, 'Тип отходов не найден', 404);
    }

    // Если обновляется name, проверяем на уникальность
    if (name !== undefined) {
      const [duplicate] = await pool.execute(
        'SELECT id FROM waste_types WHERE name = ? AND id != ?',
        [name, id]
      );

      if (duplicate.length > 0) {
        return error(res, 'Тип отходов с таким названием уже существует', 409);
      }
    }

    // Формируем запрос на обновление
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }

    if (danger !== undefined) {
      updates.push('danger = ?');
      params.push(danger);
    }

    if (updates.length === 0) {
      return error(res, 'Нет полей для обновления', 400);
    }

    params.push(id);

    await pool.execute(
      `UPDATE waste_types SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Получение обновленного типа отходов
    const [rows] = await pool.execute(
      'SELECT id, name, danger, created_at, updated_at FROM waste_types WHERE id = ?',
      [id]
    );

    success(res, rows[0], 'Тип отходов успешно обновлен');
  } catch (err) {
    console.error('Ошибка обновления типа отходов:', err);
    
    // Обработка ошибки дублирования
    if (err.code === 'ER_DUP_ENTRY') {
      return error(res, 'Тип отходов с таким названием уже существует', 409);
    }
    
    error(res, 'Ошибка при обновлении типа отходов', 500, err);
  }
});

/**
 * DELETE /api/waste-types/:id
 * Удаление типа отходов (только для администраторов)
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Проверка существования
    const [existing] = await pool.execute(
      'SELECT id, name FROM waste_types WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return error(res, 'Тип отходов не найден', 404);
    }

    // Проверка использования в заявках
    // В таблице requests поле waste_types хранится как JSON массив названий
    const wasteTypeName = existing[0].name;
    const [usedInRequests] = await pool.execute(
      `SELECT COUNT(*) as count FROM requests 
       WHERE JSON_CONTAINS(waste_types, JSON_QUOTE(?))`,
      [wasteTypeName]
    );

    if (usedInRequests[0].count > 0) {
      return error(
        res,
        'Невозможно удалить тип отходов, так как он используется в заявках',
        400
      );
    }

    await pool.execute('DELETE FROM waste_types WHERE id = ?', [id]);

    success(res, null, 'Тип отходов успешно удален');
  } catch (err) {
    console.error('Ошибка удаления типа отходов:', err);
    error(res, 'Ошибка при удалении типа отходов', 500, err);
  }
});

module.exports = router;

