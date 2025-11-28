const express = require('express');
const fs = require('fs');
const path = require('path');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { runAllCronTasks } = require('../../scripts/cronTasks');

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
        console.error('Ошибка чтения файла последнего запуска:', readError);
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
    console.error('Ошибка проверки статуса cron:', err);
    return error(res, 'Ошибка при проверке статуса cron', 500);
  }
});

/**
 * POST /api/cron/run
 * Ручной запуск cron задач
 * Только для админов
 */
router.post('/run', authenticate, requireAdmin, async (req, res) => {
  try {
    console.log('🔧 Ручной запуск cron задач из админки...');
    
    // Запускаем задачи асинхронно, чтобы не блокировать ответ
    runAllCronTasks()
      .then((results) => {
        console.log('✅ Ручной запуск cron задач завершен:', results);
      })
      .catch((err) => {
        console.error('❌ Ошибка при ручном запуске cron задач:', err);
      });

    // Сразу возвращаем ответ, что задачи запущены
    return success(res, {
      message: 'Cron задачи запущены',
      note: 'Задачи выполняются в фоновом режиме. Проверьте статус через /api/cron/status'
    });
  } catch (err) {
    console.error('Ошибка ручного запуска cron:', err);
    return error(res, 'Ошибка при запуске cron задач', 500);
  }
});

module.exports = router;

