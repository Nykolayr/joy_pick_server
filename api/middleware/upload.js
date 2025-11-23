const multer = require('multer');
const path = require('path');
const { generateId } = require('../utils/uuid');
const fs = require('fs');

// Создаем папку uploads если её нет
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Настройка хранилища для multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Определяем подпапку в зависимости от типа загрузки
    let subfolder = 'general';
    
    if (file.fieldname.includes('photo') || file.fieldname.includes('Photo')) {
      subfolder = 'photos';
    } else if (file.fieldname.includes('avatar') || file.fieldname.includes('Avatar')) {
      subfolder = 'avatars';
    }
    
    const destPath = path.join(uploadsDir, subfolder);
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }
    cb(null, destPath);
  },
  filename: (req, file, cb) => {
    // Генерируем уникальное имя файла
    const ext = path.extname(file.originalname);
    const filename = `${generateId()}${ext}`;
    cb(null, filename);
  }
});

// Фильтр для проверки типа файла
const fileFilter = (req, file, cb) => {
  // Разрешаем только изображения
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Недопустимый тип файла. Разрешены только изображения (JPEG, PNG, GIF, WebP)'), false);
  }
};

// Настройка multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB максимум
    files: 20 // Максимум 20 файлов за раз
  }
});

/**
 * Middleware для загрузки фотографий заявок
 * Поддерживает множественную загрузку для photos, photos_before, photos_after
 */
const uploadRequestPhotos = upload.fields([
  { name: 'photos', maxCount: 10 },
  { name: 'photos_before', maxCount: 10 },
  { name: 'photos_after', maxCount: 10 }
]);

/**
 * Middleware для загрузки фотографий партнеров
 */
const uploadPartnerPhotos = upload.fields([
  { name: 'photos', maxCount: 10 }
]);

/**
 * Middleware для загрузки аватара пользователя
 */
const uploadUserAvatar = upload.single('photo');

/**
 * Middleware для загрузки одного файла (универсальный)
 */
const uploadSingle = upload.single('file');

/**
 * Middleware для загрузки нескольких файлов (универсальный)
 */
const uploadMultiple = upload.array('files', 20);

/**
 * Функция для получения URL файла
 * @param {String} filename - Имя файла
 * @param {String} subfolder - Подпапка (photos, avatars, general)
 * @returns {String} URL файла
 */
function getFileUrl(filename, subfolder = 'general') {
  const baseUrl = process.env.BASE_URL || 'http://autogie1.bget.ru';
  return `${baseUrl}/uploads/${subfolder}/${filename}`;
}

/**
 * Функция для получения URL из пути файла
 * @param {String} filepath - Полный путь к файлу
 * @returns {String} URL файла
 */
function getFileUrlFromPath(filepath) {
  if (!filepath) return null;
  
  // Извлекаем имя файла и подпапку из пути
  const relativePath = path.relative(uploadsDir, filepath);
  const parts = relativePath.split(path.sep);
  
  if (parts.length >= 2) {
    const subfolder = parts[0];
    const filename = parts[parts.length - 1];
    return getFileUrl(filename, subfolder);
  }
  
  return null;
}

module.exports = {
  uploadRequestPhotos,
  uploadPartnerPhotos,
  uploadUserAvatar,
  uploadSingle,
  uploadMultiple,
  getFileUrl,
  getFileUrlFromPath
};

