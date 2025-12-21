const pool = require('../config/database');

/**
 * Получить participant_completions из заявки
 * @param {string} requestId - ID заявки
 * @returns {Promise<Object>} - Объект participant_completions или пустой объект
 */
async function getParticipantCompletions(requestId) {
  try {
    const [requests] = await pool.execute(
      'SELECT participant_completions FROM requests WHERE id = ?',
      [requestId]
    );

    if (requests.length === 0) {
      return {};
    }

    const participantCompletions = requests[0].participant_completions;
    if (!participantCompletions) {
      return {};
    }

    // Парсим JSON если это строка
    if (typeof participantCompletions === 'string') {
      try {
        return JSON.parse(participantCompletions);
      } catch (e) {
        return {};
      }
    }

    return participantCompletions || {};
  } catch (err) {
    throw new Error(`Ошибка получения participant_completions: ${err.message}`);
  }
}

/**
 * Сохранить participant_completions в заявку
 * @param {string} requestId - ID заявки
 * @param {Object} completions - Объект participant_completions
 * @returns {Promise<void>}
 */
async function saveParticipantCompletions(requestId, completions) {
  try {
    await pool.execute(
      'UPDATE requests SET participant_completions = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(completions), requestId]
    );
  } catch (err) {
    throw new Error(`Ошибка сохранения participant_completions: ${err.message}`);
  }
}

/**
 * Инициализировать запись для участника в participant_completions
 * @param {string} requestId - ID заявки
 * @param {string} userId - ID пользователя
 * @returns {Promise<void>}
 */
async function initializeParticipantCompletion(requestId, userId) {
  try {
    const completions = await getParticipantCompletions(requestId);
    
    // Если запись уже существует, не перезаписываем
    if (completions[userId]) {
      return;
    }

    // Создаем новую запись со статусом inProgress
    completions[userId] = {
      status: 'inProgress',
      photos_after: [],
      completion_comment: null,
      completion_latitude: null,
      completion_longitude: null,
      rejection_reason: null,
      completed_at: null
    };

    await saveParticipantCompletions(requestId, completions);
  } catch (err) {
    throw new Error(`Ошибка инициализации participant_completion: ${err.message}`);
  }
}

/**
 * Обновить статус закрытия работы участника
 * @param {string} requestId - ID заявки
 * @param {string} userId - ID пользователя
 * @param {Object} completionData - Данные закрытия работы
 * @returns {Promise<void>}
 */
async function updateParticipantCompletion(requestId, userId, completionData) {
  try {
    const completions = await getParticipantCompletions(requestId);
    
    if (!completions[userId]) {
      throw new Error(`Участник ${userId} не найден в participant_completions`);
    }

    // Обновляем данные
    completions[userId] = {
      ...completions[userId],
      ...completionData
    };

    await saveParticipantCompletions(requestId, completions);
  } catch (err) {
    throw new Error(`Ошибка обновления participant_completion: ${err.message}`);
  }
}

/**
 * Получить список участников со статусом approved
 * @param {string} requestId - ID заявки
 * @returns {Promise<string[]>} - Массив ID участников со статусом approved
 */
async function getApprovedParticipants(requestId) {
  try {
    const completions = await getParticipantCompletions(requestId);
    const approved = [];

    for (const [userId, completion] of Object.entries(completions)) {
      if (completion.status === 'approved') {
        approved.push(userId);
      }
    }

    return approved;
  } catch (err) {
    throw new Error(`Ошибка получения approved участников: ${err.message}`);
  }
}

module.exports = {
  getParticipantCompletions,
  saveParticipantCompletions,
  initializeParticipantCompletion,
  updateParticipantCompletion,
  getApprovedParticipants
};

