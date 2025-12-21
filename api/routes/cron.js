const express = require('express');
const fs = require('fs');
const path = require('path');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const pool = require('../config/database');
const { generateId } = require('../utils/uuid');

// Импортируем runAllCronTasks с обработкой ошибок импорта
let runAllCronTasks;
try {
  runAllCronTasks = require('../../scripts/cronTasks').runAllCronTasks;
} catch (importError) {
  // Если ошибка при импорте, создаем функцию-заглушку
  runAllCronTasks = async () => {
    throw new Error(`Ошибка импорта cronTasks: ${importError.message}`);
  };
}

const router = express.Router();

// Путь к файлу с информацией о последнем запуске
const LAST_RUN_FILE = path.join(__dirname, '..', '..', 'logs', 'cron_last_run.json');

/**
 * GET /api/cron/status
 * Проверка статуса cron задач
 * Только для админов
 */
router.get('/status', authenticate, requireAdmin, async (req, res) => {
  try {
    let lastRunInfo = null;
    let fileExists = false;

    // Читаем информацию о последнем запуске
    if (fs.existsSync(LAST_RUN_FILE)) {
      try {
        const fileContent = fs.readFileSync(LAST_RUN_FILE, 'utf8');
        lastRunInfo = JSON.parse(fileContent);
        fileExists = true;
      } catch (readError) {
        // Ошибка чтения файла
      }
    }

    // Определяем статус
    let status = 'unknown';
    let isRunning = false;
    let lastRunTime = null;
    let hoursSinceLastRun = null;

    if (lastRunInfo && lastRunInfo.lastRun) {
      lastRunTime = new Date(lastRunInfo.lastRun);
      const now = new Date();
      const diffMs = now - lastRunTime;
      hoursSinceLastRun = diffMs / (1000 * 60 * 60);

      // Если последний запуск был менее 2 часов назад - cron работает
      if (hoursSinceLastRun < 2) {
        status = 'running';
        isRunning = true;
      } else if (hoursSinceLastRun < 24) {
        // Если менее 24 часов - возможно работает, но давно не запускался
        status = 'warning';
        isRunning = false;
      } else {
        // Если более 24 часов - скорее всего не работает
        status = 'stopped';
        isRunning = false;
      }
    } else {
      status = 'never_run';
      isRunning = false;
    }

    return success(res, {
      status: status,
      isRunning: isRunning,
      lastRun: lastRunTime ? lastRunTime.toISOString() : null,
      hoursSinceLastRun: hoursSinceLastRun ? Math.round(hoursSinceLastRun * 10) / 10 : null,
      lastRunInfo: lastRunInfo,
      fileExists: fileExists,
      message: isRunning 
        ? 'Cron задачи работают нормально' 
        : status === 'warning'
        ? 'Cron задачи давно не запускались (проверьте настройки cron)'
        : status === 'stopped'
        ? 'Cron задачи не запускались более 24 часов (проверьте настройки cron)'
        : 'Cron задачи еще не запускались'
    });
  } catch (err) {
    return error(res, 'Ошибка при проверке статуса cron', 500, err);
  }
});

/**
 * POST /api/cron/run
 * Ручной запуск cron задач
 * Только для админов
 */
router.post('/run', authenticate, requireAdmin, async (req, res) => {
  try {
    // Запускаем задачи и ждем результат
    const results = await runAllCronTasks();
    
    return success(res, {
      message: 'Cron задачи выполнены',
      results: results
    });
  } catch (err) {
    // Сохраняем информацию об ошибке в файл
    try {
      const lastRunInfo = {
        lastRun: new Date().toISOString(),
        status: 'error',
        error: err.message || 'Unknown error',
        errorName: err.name,
        errorStack: err.stack,
        results: null
      };
      const logsDir = path.dirname(LAST_RUN_FILE);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(lastRunInfo, null, 2));
    } catch (fileError) {
      // Не удалось сохранить
    }
    
    // ВСЕГДА передаем полный объект ошибки с деталями
    return error(res, `Ошибка при запуске cron задач: ${err.message || 'Неизвестная ошибка'}`, 500, err);
  }
});

/**
 * GET /api/cron/actions
 * Получение ближайших действий по заявкам
 * - 10 последних выполненных действий
 * - 10 запланированных действий
 * Только для админов
 */
router.get('/actions', authenticate, requireAdmin, async (req, res) => {
  try {
    // Получаем 10 последних выполненных действий
    const [completedActions] = await pool.execute(
      `SELECT id, action_type, request_id, request_category, action_description, 
              status, executed_at, metadata
       FROM cron_actions 
       ORDER BY executed_at DESC 
       LIMIT 10`
    );

    // Парсим metadata из JSON строки в объект
    const parsedActions = completedActions.map(action => {
      if (action.metadata && typeof action.metadata === 'string') {
        try {
          action.metadata = JSON.parse(action.metadata);
        } catch (e) {
          // Если не удалось распарсить, оставляем как есть
        }
      }
      return action;
    });

    // Вычисляем запланированные действия на основе текущих заявок
    const scheduledActions = [];

    // 1. SpeedCleanup: завершение через 24 часа после approved
    const [speedCleanupRequests] = await pool.execute(
      `SELECT id, name, updated_at, category
       FROM requests 
       WHERE category = 'speedCleanup' 
         AND status = 'approved' 
         AND updated_at IS NOT NULL
       ORDER BY updated_at ASC
       LIMIT 10`
    );

    for (const request of speedCleanupRequests) {
      const approvedDate = new Date(request.updated_at);
      const scheduledTime = new Date(approvedDate.getTime() + 24 * 60 * 60 * 1000);
      const now = new Date();
      
      if (scheduledTime > now) {
        scheduledActions.push({
          action_type: 'autoCompleteSpeedCleanup',
          request_id: request.id,
          request_category: request.category,
          request_name: request.name,
          action_description: `Автоматическое завершение заявки "${request.name}" через 24 часа после одобрения`,
          scheduled_at: scheduledTime.toISOString(),
          time_until: Math.round((scheduledTime - now) / (1000 * 60 * 60 * 10)) / 10 // часы с 1 знаком после запятой
        });
      }
    }

    // 2. WasteLocation: напоминание за 2 часа (join_date + 22 часа) и истечение через 24 часа (join_date + 24 часа)
    const [wasteRequests] = await pool.execute(
      `SELECT id, name, join_date, category
       FROM requests 
       WHERE category = 'wasteLocation' 
         AND status = 'inProgress' 
         AND joined_user_id IS NOT NULL
         AND join_date IS NOT NULL
       ORDER BY join_date ASC
       LIMIT 20`
    );

    for (const request of wasteRequests) {
      const joinDate = new Date(request.join_date);
      const reminderTime = new Date(joinDate.getTime() + 22 * 60 * 60 * 1000);
      const expiryTime = new Date(joinDate.getTime() + 24 * 60 * 60 * 1000);
      const now = new Date();

      // Напоминание за 2 часа
      if (reminderTime > now && reminderTime <= new Date(now.getTime() + 25 * 60 * 60 * 1000)) {
        scheduledActions.push({
          action_type: 'checkWasteReminders',
          request_id: request.id,
          request_category: request.category,
          request_name: request.name,
          action_description: `Напоминание исполнителю заявки "${request.name}" за 2 часа до окончания срока`,
          scheduled_at: reminderTime.toISOString(),
          time_until: Math.round((reminderTime - now) / (1000 * 60 * 60 * 10)) / 10
        });
      }

      // Истечение через 24 часа
      if (expiryTime > now && expiryTime <= new Date(now.getTime() + 25 * 60 * 60 * 1000)) {
        scheduledActions.push({
          action_type: 'checkExpiredWasteJoins',
          request_id: request.id,
          request_category: request.category,
          request_name: request.name,
          action_description: `Проверка истечения срока для заявки "${request.name}" (24 часа после присоединения)`,
          scheduled_at: expiryTime.toISOString(),
          time_until: Math.round((expiryTime - now) / (1000 * 60 * 60 * 10)) / 10
        });
      }
    }

    // 3. Event: уведомления за 24 часа, 2 часа, начало события
    const [eventRequests] = await pool.execute(
      `SELECT id, name, start_date, category
       FROM requests 
       WHERE category = 'event' 
         AND status = 'inProgress' 
         AND start_date IS NOT NULL
       ORDER BY start_date ASC
       LIMIT 30`
    );

    for (const request of eventRequests) {
      const startDate = new Date(request.start_date);
      const now = new Date();
      const diffHours = (startDate - now) / (1000 * 60 * 60);

      // Уведомление за 24 часа
      const notification24h = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
      if (notification24h > now && notification24h <= new Date(now.getTime() + 25 * 60 * 60 * 1000)) {
        scheduledActions.push({
          action_type: 'checkEventTimes',
          request_id: request.id,
          request_category: request.category,
          request_name: request.name,
          action_description: `Уведомление участникам события "${request.name}" за 24 часа до начала`,
          scheduled_at: notification24h.toISOString(),
          time_until: Math.round((notification24h - now) / (1000 * 60 * 60 * 10)) / 10
        });
      }

      // Уведомление за 2 часа
      const notification2h = new Date(startDate.getTime() - 2 * 60 * 60 * 1000);
      if (notification2h > now && notification2h <= new Date(now.getTime() + 3 * 60 * 60 * 1000)) {
        scheduledActions.push({
          action_type: 'checkEventTimes',
          request_id: request.id,
          request_category: request.category,
          request_name: request.name,
          action_description: `Уведомление участникам события "${request.name}" за 2 часа до начала`,
          scheduled_at: notification2h.toISOString(),
          time_until: Math.round((notification2h - now) / (1000 * 60 * 60 * 10)) / 10
        });
      }

      // Начало события
      if (startDate > now && startDate <= new Date(now.getTime() + 1 * 60 * 60 * 1000)) {
        scheduledActions.push({
          action_type: 'checkEventTimes',
          request_id: request.id,
          request_category: request.category,
          request_name: request.name,
          action_description: `Начало события "${request.name}"`,
          scheduled_at: startDate.toISOString(),
          time_until: Math.round((startDate - now) / (1000 * 60) / 10) / 10 // минуты
        });
      }
    }

    // 4. WasteLocation: уведомление о скором удалении и удаление
    // 4.1. Уведомление о скором удалении (когда заявке исполнилось 1 день)
    // expires_at = created_at + 1 день (время когда заявке исполнится 1 день)
    // Пуш отправляется когда expires_at <= NOW() (заявке уже исполнилось 1 день)
    const [wasteForNotification] = await pool.execute(
      `SELECT id, name, expires_at, created_at, category, extended_count
       FROM requests 
       WHERE category = 'wasteLocation'
         AND status = 'new' 
         AND expires_at IS NOT NULL
         AND expires_at <= NOW()
         AND expires_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
         AND extended_count = 0
       ORDER BY expires_at ASC
       LIMIT 10`
    );

    for (const request of wasteForNotification) {
      const expiresAt = new Date(request.expires_at);
      const now = new Date();
      
      // Время отправки пуша = когда заявке исполнилось 1 день = expires_at
      // Показываем что пуш должен быть отправлен сейчас (expires_at уже прошло)
      scheduledActions.push({
        action_type: 'notifyInactiveWasteRequests',
        request_id: request.id,
        request_category: request.category,
        request_name: request.name,
        action_description: `Уведомление создателю заявки "${request.name}" о скором удалении (через 24 часа после создания)`,
        scheduled_at: expiresAt.toISOString(),
        time_until: 0 // уже должно быть отправлено
      });
    }

    // 4.2. Архивирование неактивных waste заявок (через 1 день после пуша)
    // expires_at = created_at + 1 день (время отправки пуша)
    // Архивирование происходит через 1 день после пуша, то есть когда expires_at + 1 день <= NOW()
    const [wasteForDeletion] = await pool.execute(
      `SELECT id, name, expires_at, category
       FROM requests 
       WHERE category = 'wasteLocation'
         AND status = 'new' 
         AND expires_at IS NOT NULL
         AND expires_at <= DATE_SUB(NOW(), INTERVAL 1 DAY)
       ORDER BY expires_at ASC
       LIMIT 10`
    );

    for (const request of wasteForDeletion) {
      const expiresAt = new Date(request.expires_at);
      const now = new Date();
      // Время архивирования = expires_at + 1 день (через 1 день после пуша)
      const deleteTime = new Date(expiresAt.getTime() + 24 * 60 * 60 * 1000);
      
      // Показываем только если архивирование запланировано в ближайшие 24 часа
      if (deleteTime <= now && deleteTime > new Date(now.getTime() - 24 * 60 * 60 * 1000)) {
        scheduledActions.push({
          action_type: 'deleteInactiveRequests',
          request_id: request.id,
          request_category: request.category,
          request_name: request.name,
          action_description: `Архивирование неактивной заявки "${request.name}" (через 1 день после уведомления)`,
          scheduled_at: deleteTime.toISOString(),
          time_until: 0 // уже должно быть архивировано
        });
      }
    }

    // Сортируем запланированные действия по времени выполнения и берем первые 10
    scheduledActions.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const topScheduled = scheduledActions.slice(0, 10);

    return success(res, {
      completed: parsedActions,
      scheduled: topScheduled,
      total_completed: parsedActions.length,
      total_scheduled: topScheduled.length
    });
  } catch (err) {
    return error(res, 'Ошибка при получении действий cron', 500, err);
  }
});

module.exports = router;

