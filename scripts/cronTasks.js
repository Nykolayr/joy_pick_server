#!/usr/bin/env node

/**
 * Скрипт для выполнения периодических задач (cron jobs)
 * 
 * Запуск: node scripts/cronTasks.js
 * Или через cron: 0 * * * * cd /path/to/joy_pick_server && node scripts/cronTasks.js
 * 
 * Этот скрипт выполняется каждый час и выполняет все необходимые периодические задачи
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const pool = require('../api/config/database');
const { sendSpeedCleanupNotification } = require('../api/services/pushNotification');
const { generateId } = require('../api/utils/uuid');

// Путь к файлу с информацией о последнем запуске
const LAST_RUN_FILE = path.join(__dirname, '..', 'logs', 'cron_last_run.json');

/**
 * Автоматический перевод speedCleanup заявок в completed через 24 часа после end_date
 * Начисление коинов и отправка push-уведомлений донатерам
 */
async function autoCompleteSpeedCleanup() {
  console.log('🔄 [autoCompleteSpeedCleanup] Начало обработки...');

  try {
    // Находим все speedCleanup заявки со статусом approved, где прошло 24 часа с end_date
    const [requests] = await pool.execute(
      `SELECT id, end_date, created_by 
       FROM requests 
       WHERE category = 'speedCleanup' 
         AND status = 'approved' 
         AND end_date IS NOT NULL 
         AND end_date <= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );

    if (requests.length === 0) {
      console.log('✅ [autoCompleteSpeedCleanup] Нет заявок для обработки');
      return { processed: 0, errors: 0 };
    }

    console.log(`📋 [autoCompleteSpeedCleanup] Найдено заявок: ${requests.length}`);

    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        const requestId = request.id;
        const endDate = new Date(request.end_date);
        const now = new Date();
        const diffHours = (now - endDate) / (1000 * 60 * 60);

        // Перевод в completed
        await pool.execute(
          'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
          ['completed', requestId]
        );
        console.log(`✅ [autoCompleteSpeedCleanup] Заявка ${requestId} переведена в completed (прошло ${Math.floor(diffHours)} часов)`);

        // Получаем донатеров из request_contributors
        const [contributors] = await pool.execute(
          'SELECT user_id, amount FROM request_contributors WHERE request_id = ?',
          [requestId]
        );

        const donorUserIds = [];

        if (contributors.length > 0) {
          const coinsToAward = 1;

          for (const contributor of contributors) {
            try {
              // Проверяем, есть ли уже донат в таблице donations
              const [existingDonation] = await pool.execute(
                'SELECT id FROM donations WHERE request_id = ? AND user_id = ?',
                [requestId, contributor.user_id]
              );

              // Если доната нет, создаем его
              if (existingDonation.length === 0) {
                await pool.execute(
                  'INSERT INTO donations (id, request_id, user_id, amount, payment_intent_id) VALUES (?, ?, ?, ?, ?)',
                  [generateId(), requestId, contributor.user_id, contributor.amount || 0, null]
                );
              }

              // Начисляем коины донатерам (по 1 коину каждому, кроме создателя)
              if (contributor.user_id && contributor.user_id !== request.created_by) {
                await pool.execute(
                  'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
                  [coinsToAward, coinsToAward, contributor.user_id]
                );
                donorUserIds.push(contributor.user_id);
              }
            } catch (contributorError) {
              console.error(`❌ [autoCompleteSpeedCleanup] Ошибка обработки донатера ${contributor.user_id}:`, contributorError.message);
            }
          }
        }

        // Отправляем push-уведомление донатерам (если они есть)
        if (donorUserIds.length > 0) {
          try {
            await sendSpeedCleanupNotification({
              userIds: donorUserIds,
              earnedCoin: true,
            });
            console.log(`📱 [autoCompleteSpeedCleanup] Отправлено push-уведомлений донатерам: ${donorUserIds.length}`);
          } catch (pushError) {
            console.error(`❌ [autoCompleteSpeedCleanup] Ошибка отправки push-уведомлений:`, pushError.message);
          }
        }

        processed++;
      } catch (requestError) {
        errors++;
        console.error(`❌ [autoCompleteSpeedCleanup] Ошибка обработки заявки ${request.id}:`, requestError.message);
      }
    }

    console.log(`✅ [autoCompleteSpeedCleanup] Завершено: обработано ${processed}, ошибок ${errors}`);
    return { processed, errors, total: requests.length };

  } catch (error) {
    console.error('❌ [autoCompleteSpeedCleanup] Критическая ошибка:', error);
    throw error;
  }
}

/**
 * Здесь можно добавлять новые периодические задачи
 * Например:
 * - Очистка старых данных
 * - Отправка напоминаний
 * - Синхронизация с внешними сервисами
 * и т.д.
 */
async function runAllCronTasks() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 Запуск cron задач: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);

  const results = {};

  try {
    // Задача 1: Автоматический перевод speedCleanup заявок
    results.autoCompleteSpeedCleanup = await autoCompleteSpeedCleanup();

    // TODO: Добавьте здесь новые задачи:
    // results.cleanupOldData = await cleanupOldData();
    // results.sendReminders = await sendReminders();
    // и т.д.

  } catch (error) {
    console.error('❌ Критическая ошибка выполнения cron задач:', error);
    throw error;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Все cron задачи завершены: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);

  // Сохраняем информацию о последнем запуске
  try {
    const lastRunInfo = {
      lastRun: new Date().toISOString(),
      results: results,
      status: 'success'
    };

    // Создаем папку logs если её нет
    const logsDir = path.dirname(LAST_RUN_FILE);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(lastRunInfo, null, 2));
    console.log(`💾 Информация о последнем запуске сохранена`);
  } catch (fileError) {
    console.error('⚠️ Не удалось сохранить информацию о последнем запуске:', fileError.message);
  }

  return results;
}

// Запуск скрипта
if (require.main === module) {
  runAllCronTasks()
    .then((results) => {
      console.log('📊 Результаты:', JSON.stringify(results, null, 2));
      
      // Сохраняем информацию о последнем запуске даже при ошибках
      try {
        const lastRunInfo = {
          lastRun: new Date().toISOString(),
          results: results,
          status: 'success'
        };

        const logsDir = path.dirname(LAST_RUN_FILE);
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }

        fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(lastRunInfo, null, 2));
      } catch (fileError) {
        console.error('⚠️ Не удалось сохранить информацию о последнем запуске:', fileError.message);
      }

      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Скрипт завершен с ошибкой:', err);
      
      // Сохраняем информацию об ошибке
      try {
        const lastRunInfo = {
          lastRun: new Date().toISOString(),
          results: {},
          status: 'error',
          error: err.message
        };

        const logsDir = path.dirname(LAST_RUN_FILE);
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }

        fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(lastRunInfo, null, 2));
      } catch (fileError) {
        // Игнорируем ошибки записи файла
      }

      process.exit(1);
    });
}

module.exports = { runAllCronTasks, autoCompleteSpeedCleanup };

