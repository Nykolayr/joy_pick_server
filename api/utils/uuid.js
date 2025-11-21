const { v4: uuidv4 } = require('uuid');

/**
 * Генерация UUID
 * @returns {String} UUID
 */
function generateId() {
  return uuidv4();
}

module.exports = {
  generateId
};

