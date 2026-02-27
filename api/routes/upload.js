const express = require('express');
const { upload, getFileUrlFromPath } = require('../middleware/upload');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Принимаем и "file", и "image" (админка может слать разное имя поля)
const uploadOne = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]);

/**
 * POST /api/upload
 * Загрузка одного изображения (для админки: новости, партнёры и т.д.).
 * FormData: поле "file" или "image" (один файл). Только изображения (JPEG, PNG, GIF, WebP), до 10 MB.
 * Ответ: { success: true, data: { url: "https://..." } }
 */
router.post('/', authenticate, requireAdmin, uploadOne, (req, res) => {
  const file = (req.files && req.files.file && req.files.file[0]) || (req.files && req.files.image && req.files.image[0]) || req.file;
  if (!file) {
    return error(res, 'Файл не получен. Отправьте изображение в поле "file" или "image" (multipart/form-data).', 400);
  }
  const url = getFileUrlFromPath(file.path);
  if (!url) {
    return error(res, 'Не удалось сформировать URL файла', 500);
  }
  return success(res, { url }, 'Файл загружен', 201);
});

module.exports = router;
