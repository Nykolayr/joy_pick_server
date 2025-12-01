/**
 * Нормализация даты в UTC
 * Преобразует дату в UTC формат, чтобы избежать проблем с часовыми поясами
 * 
 * @param {Date|string|null} date - Дата для нормализации
 * @returns {string|null} - ISO строка в UTC или null
 */
function normalizeToUTC(date) {
  if (!date) return null;
  
  // Если это строка, создаем Date объект
  const dateObj = date instanceof Date ? date : new Date(date);
  
  // Проверяем, что дата валидна
  if (isNaN(dateObj.getTime())) {
    return null;
  }
  
  // Возвращаем ISO строку в UTC
  return dateObj.toISOString();
}

/**
 * Нормализация объекта с датами
 * Рекурсивно нормализует все поля с датами в объекте
 * 
 * @param {Object} obj - Объект для нормализации
 * @param {string[]} dateFields - Массив имен полей, которые содержат даты
 * @returns {Object} - Объект с нормализованными датами
 */
function normalizeDatesInObject(obj, dateFields = ['created_at', 'updated_at', 'start_date', 'end_date', 'join_date']) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  const normalized = { ...obj };
  
  // Нормализуем указанные поля с датами
  for (const field of dateFields) {
    if (normalized[field] !== undefined && normalized[field] !== null) {
      normalized[field] = normalizeToUTC(normalized[field]);
    }
  }
  
  return normalized;
}

module.exports = {
  normalizeToUTC,
  normalizeDatesInObject
};

