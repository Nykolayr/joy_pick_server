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
const { 
  sendSpeedCleanupNotification,
  sendReminderNotification,
  sendRequestExpiredNotification,
  sendEventTimeNotification
} = require('../api/services/pushNotification');
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
    // Находим все speedCleanup заявки со статусом approved, где прошло 24 часа с момента одобрения (updated_at)
    const [requests] = await pool.execute(
      `SELECT id, updated_at, created_by 
       FROM requests 
       WHERE category = 'speedCleanup' 
         AND status = 'approved' 
         AND updated_at IS NOT NULL 
         AND updated_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
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
        const approvedDate = new Date(request.updated_at);
        const now = new Date();
        const diffHours = (now - approvedDate) / (1000 * 60 * 60);

        // Перевод в completed
        await pool.execute(
          'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
          ['completed', requestId]
        );
        console.log(`✅ [autoCompleteSpeedCleanup] Заявка ${requestId} переведена в completed (прошло ${Math.floor(diffHours)} часов с одобрения)`);

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
 * Проверка напоминаний исполнителю за 2 часа до окончания срока (для waste)
 */
async function checkWasteReminders() {
  console.log('🔄 [checkWasteReminders] Начало обработки...');

  try {
    // Находим все waste заявки со статусом inProgress, где join_date + 22 часа = текущее время (с точностью до минуты)
    const [requests] = await pool.execute(
      `SELECT id, join_date, joined_user_id 
       FROM requests 
       WHERE category = 'wasteLocation' 
         AND status = 'inProgress' 
         AND joined_user_id IS NOT NULL
         AND join_date IS NOT NULL
         AND join_date <= DATE_SUB(NOW(), INTERVAL 22 HOUR)
         AND join_date > DATE_SUB(NOW(), INTERVAL 22 HOUR 1 MINUTE)`
    );

    if (requests.length === 0) {
      console.log('✅ [checkWasteReminders] Нет заявок для обработки');
      return { processed: 0, errors: 0 };
    }

    console.log(`📋 [checkWasteReminders] Найдено заявок: ${requests.length}`);

    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        await sendReminderNotification({
          userIds: [request.joined_user_id],
          requestId: request.id,
        });
        console.log(`📱 [checkWasteReminders] Отправлено напоминание исполнителю ${request.joined_user_id} для заявки ${request.id}`);
        processed++;
      } catch (error) {
        errors++;
        console.error(`❌ [checkWasteReminders] Ошибка обработки заявки ${request.id}:`, error.message);
      }
    }

    console.log(`✅ [checkWasteReminders] Завершено: обработано ${processed}, ошибок ${errors}`);
    return { processed, errors, total: requests.length };

  } catch (error) {
    console.error('❌ [checkWasteReminders] Критическая ошибка:', error);
    throw error;
  }
}

/**
 * Проверка истекших присоединений для waste (24 часа)
 */
async function checkExpiredWasteJoins() {
  console.log('🔄 [checkExpiredWasteJoins] Начало обработки...');

  try {
    // Находим все waste заявки со статусом inProgress, где join_date + 24 часа < текущее время
    const [requests] = await pool.execute(
      `SELECT id, join_date, joined_user_id, created_by 
       FROM requests 
       WHERE category = 'wasteLocation' 
         AND status = 'inProgress' 
         AND joined_user_id IS NOT NULL
         AND join_date IS NOT NULL
         AND join_date <= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );

    if (requests.length === 0) {
      console.log('✅ [checkExpiredWasteJoins] Нет заявок для обработки');
      return { processed: 0, errors: 0 };
    }

    console.log(`📋 [checkExpiredWasteJoins] Найдено заявок: ${requests.length}`);

    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        // Отправляем пуш исполнителю
        await sendRequestExpiredNotification({
          userIds: [request.joined_user_id],
          requestId: request.id,
          messageType: 'executor',
        });

        // Отправляем пуш создателю
        await sendRequestExpiredNotification({
          userIds: [request.created_by],
          requestId: request.id,
          messageType: 'creator',
        });

        // Меняем статус на new и обнуляем joined_user_id и join_date
        await pool.execute(
          'UPDATE requests SET status = ?, joined_user_id = NULL, join_date = NULL, updated_at = NOW() WHERE id = ?',
          ['new', request.id]
        );

        console.log(`✅ [checkExpiredWasteJoins] Заявка ${request.id} возвращена в статус new`);
        processed++;
      } catch (error) {
        errors++;
        console.error(`❌ [checkExpiredWasteJoins] Ошибка обработки заявки ${request.id}:`, error.message);
      }
    }

    console.log(`✅ [checkExpiredWasteJoins] Завершено: обработано ${processed}, ошибок ${errors}`);
    return { processed, errors, total: requests.length };

  } catch (error) {
    console.error('❌ [checkExpiredWasteJoins] Критическая ошибка:', error);
    throw error;
  }
}

/**
 * Удаление неактивных заявок (7 дней без присоединения)
 */
async function deleteInactiveRequests() {
  console.log('🔄 [deleteInactiveRequests] Начало обработки...');

  try {
    // Находим все заявки со статусом new, где created_at + 7 дней < текущее время
    const [requests] = await pool.execute(
      `SELECT id, created_by, cost 
       FROM requests 
       WHERE status = 'new' 
         AND created_at <= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    if (requests.length === 0) {
      console.log('✅ [deleteInactiveRequests] Нет заявок для обработки');
      return { processed: 0, errors: 0 };
    }

    console.log(`📋 [deleteInactiveRequests] Найдено заявок: ${requests.length}`);

    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        // Получаем донатеров
        const [donations] = await pool.execute(
          'SELECT DISTINCT user_id, amount FROM donations WHERE request_id = ?',
          [request.id]
        );

        // TODO: Возврат денег создателю и донатерам через платежную систему
        if (request.cost && request.cost > 0) {
          console.log(`💰 [deleteInactiveRequests] Возврат ${request.cost} создателю заявки ${request.id}`);
        }
        for (const donation of donations) {
          if (donation.amount && donation.amount > 0) {
            console.log(`💰 [deleteInactiveRequests] Возврат ${donation.amount} донатеру ${donation.user_id} заявки ${request.id}`);
          }
        }

        // Отправляем пуши
        const { sendRequestRejectedNotification } = require('../api/services/pushNotification');
        await sendRequestRejectedNotification({
          userIds: [request.created_by],
          requestId: request.id,
          messageType: 'creator',
          rejectionMessage: 'Your request was deleted due to inactivity',
        });

        const donorUserIds = donations.map(d => d.user_id).filter(Boolean);
        if (donorUserIds.length > 0) {
          await sendRequestRejectedNotification({
            userIds: donorUserIds,
            requestId: request.id,
            messageType: 'donor',
            rejectionMessage: 'Request you donated to was deleted',
          });
        }

        // Удаляем заявку
        await pool.execute('DELETE FROM requests WHERE id = ?', [request.id]);
        console.log(`✅ [deleteInactiveRequests] Заявка ${request.id} удалена`);
        processed++;
      } catch (error) {
        errors++;
        console.error(`❌ [deleteInactiveRequests] Ошибка обработки заявки ${request.id}:`, error.message);
      }
    }

    console.log(`✅ [deleteInactiveRequests] Завершено: обработано ${processed}, ошибок ${errors}`);
    return { processed, errors, total: requests.length };

  } catch (error) {
    console.error('❌ [deleteInactiveRequests] Критическая ошибка:', error);
    throw error;
  }
}

/**
 * Проверка времени до события для event
 */
async function checkEventTimes() {
  console.log('🔄 [checkEventTimes] Начало обработки...');

  try {
    // Находим все event заявки со статусом inProgress, где start_date близко к текущему времени
    const now = new Date();
    const [requests] = await pool.execute(
      `SELECT id, start_date, created_by 
       FROM requests 
       WHERE category = 'event' 
         AND status = 'inProgress' 
         AND start_date IS NOT NULL
         AND start_date >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
         AND start_date <= DATE_ADD(NOW(), INTERVAL 25 HOUR)`
    );

    if (requests.length === 0) {
      console.log('✅ [checkEventTimes] Нет заявок для обработки');
      return { processed: 0, errors: 0 };
    }

    console.log(`📋 [checkEventTimes] Найдено заявок: ${requests.length}`);

    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        const startDate = new Date(request.start_date);
        const diffHours = (startDate - now) / (1000 * 60 * 60);
        const diffMinutes = (startDate - now) / (1000 * 60);

        // Получаем участников
        const [participants] = await pool.execute(
          'SELECT user_id FROM request_participants WHERE request_id = ?',
          [request.id]
        );
        const participantUserIds = participants.map(p => p.user_id).filter(Boolean);

        // Проверяем время до события
        if (diffHours >= 23.5 && diffHours <= 24.5) {
          // За 24 часа
          if (participantUserIds.length > 0) {
            await sendEventTimeNotification({
              userIds: participantUserIds,
              requestId: request.id,
              messageType: '24hours',
            });
            console.log(`📱 [checkEventTimes] Отправлено уведомление за 24 часа участникам заявки ${request.id}`);
          }
        } else if (diffHours >= 1.5 && diffHours <= 2.5) {
          // За 2 часа
          if (participantUserIds.length > 0) {
            await sendEventTimeNotification({
              userIds: participantUserIds,
              requestId: request.id,
              messageType: '2hours',
            });
            console.log(`📱 [checkEventTimes] Отправлено уведомление за 2 часа участникам заявки ${request.id}`);
          }
        } else if (diffMinutes >= -5 && diffMinutes <= 5) {
          // Событие началось
          await sendEventTimeNotification({
            userIds: [request.created_by],
            requestId: request.id,
            messageType: 'start',
          });
          console.log(`📱 [checkEventTimes] Отправлено уведомление о начале события заказчику заявки ${request.id}`);
        }

        processed++;
      } catch (error) {
        errors++;
        console.error(`❌ [checkEventTimes] Ошибка обработки заявки ${request.id}:`, error.message);
      }
    }

    console.log(`✅ [checkEventTimes] Завершено: обработано ${processed}, ошибок ${errors}`);
    return { processed, errors, total: requests.length };

  } catch (error) {
    console.error('❌ [checkEventTimes] Критическая ошибка:', error);
    throw error;
  }
}

/**
 * Здесь можно добавлять новые периодические задачи
 */
async function runAllCronTasks() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 Запуск cron задач: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);

  const results = {};

  try {
    // Задача 1: Автоматический перевод speedCleanup заявок
    results.autoCompleteSpeedCleanup = await autoCompleteSpeedCleanup();

    // Задача 2: Проверка напоминаний для waste (каждые 5-10 минут)
    results.checkWasteReminders = await checkWasteReminders();

    // Задача 3: Проверка истекших присоединений для waste (каждые 5-10 минут)
    results.checkExpiredWasteJoins = await checkExpiredWasteJoins();

    // Задача 4: Проверка времени до события для event (каждые 5-10 минут)
    results.checkEventTimes = await checkEventTimes();

    // Задача 5: Удаление неактивных заявок (каждые 24 часа)
    // Выполняем только раз в день (проверяем час)
    const currentHour = new Date().getHours();
    if (currentHour === 0) { // В полночь
      results.deleteInactiveRequests = await deleteInactiveRequests();
    } else {
      results.deleteInactiveRequests = { processed: 0, errors: 0, skipped: true };
    }

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

module.exports = { 
  runAllCronTasks, 
  autoCompleteSpeedCleanup,
  checkWasteReminders,
  checkExpiredWasteJoins,
  deleteInactiveRequests,
  checkEventTimes
};

