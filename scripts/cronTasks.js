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
 * Запись выполненного действия в таблицу cron_actions
 */
async function logCronAction(actionType, requestId, requestCategory, actionDescription, status = 'completed', metadata = null) {
  try {
    const actionId = generateId();
    await pool.execute(
      `INSERT INTO cron_actions (id, action_type, request_id, request_category, action_description, status, metadata, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        actionId,
        actionType,
        requestId,
        requestCategory,
        actionDescription,
        status,
        metadata ? JSON.stringify(metadata) : null
      ]
    );
  } catch (err) {
    // Игнорируем ошибки записи в лог, чтобы не прерывать выполнение cron
  }
}

/**
 * Автоматический перевод speedCleanup заявок в completed через 24 часа после end_date
 * Начисление коинов и отправка push-уведомлений донатерам
 */
async function autoCompleteSpeedCleanup() {
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
      return { processed: 0, errors: 0 };
    }

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

        // Получаем донатеров и суммы донатов
        const [donations] = await pool.execute(
          'SELECT DISTINCT user_id, amount FROM donations WHERE request_id = ?',
          [requestId]
        );

        const donorUserIds = [];
        let totalDonationsAmount = 0;

        if (donations.length > 0) {
          const coinsToAward = 1;

          for (const donation of donations) {
            try {
              // Начисляем коины донатерам (по 1 коину каждому, кроме создателя)
              if (donation.user_id && donation.user_id !== request.created_by) {
                await pool.execute(
                  'UPDATE users SET jcoins = COALESCE(jcoins, 0) + ?, coins_from_participation = COALESCE(coins_from_participation, 0) + ?, updated_at = NOW() WHERE id = ?',
                  [coinsToAward, coinsToAward, donation.user_id]
                );
                donorUserIds.push(donation.user_id);
              }
              
              // Суммируем донаты
              if (donation.amount) {
                totalDonationsAmount += parseFloat(donation.amount) || 0;
              }
            } catch (donationError) {
              // Ошибка обработки донатера
            }
          }
        }

        // TODO: Перевести все донаты (за вычетом комиссии) исполнителю (created_by) через платежную систему
        // Пока только логируем сумму
        if (totalDonationsAmount > 0 && request.created_by) {
          // Здесь должен быть код перевода денег исполнителю через платежную систему
          // const commission = totalDonationsAmount * 0.1; // 10% комиссия (пример)
          // const amountToTransfer = totalDonationsAmount - commission;
          // await transferMoneyToUser(request.created_by, amountToTransfer);
        }

        // Отправляем push-уведомление исполнителю (created_by) о получении донатов
        if (request.created_by) {
          try {
            await sendSpeedCleanupNotification({
              userIds: [request.created_by],
              messageType: 'executor',
              requestId: requestId,
            });
          } catch (pushError) {
            // Ошибка отправки push-уведомления исполнителю
          }
        }

        // Записываем действие для каждой обработанной заявки
        await logCronAction(
          'autoCompleteSpeedCleanup',
          requestId,
          'speedCleanup',
          `Автоматическое завершение заявки ${requestId} через 24 часа после одобрения`,
          'completed',
          { donorCount: donorUserIds.length, coinsAwarded: coinsToAward }
        );

        processed++;
      } catch (requestError) {
        errors++;
        // Записываем ошибку в лог с подробной информацией
        await logCronAction(
          'autoCompleteSpeedCleanup',
          request.id,
          'speedCleanup',
          `Ошибка при обработке заявки ${request.id}: ${requestError.message || 'Неизвестная ошибка'}`,
          'error',
          {
            error: requestError.message || 'Неизвестная ошибка',
            errorName: requestError.name || 'Error',
            errorStack: requestError.stack,
            requestId: request.id
          }
        );
      }
    }

    // Записываем общее действие для всей задачи
    if (requests.length > 0) {
      const hasErrors = errors > 0;
      await logCronAction(
        'autoCompleteSpeedCleanup',
        null,
        'speedCleanup',
        `Обработано ${processed} из ${requests.length} заявок speedCleanup${hasErrors ? ` (${errors} ошибок)` : ''}`,
        hasErrors ? 'error' : 'completed',
        { 
          processed, 
          errors, 
          total: requests.length,
          hasErrors: hasErrors,
          message: hasErrors ? `При обработке возникло ${errors} ошибок. Проверьте отдельные записи с status='error' для деталей.` : null
        }
      );
    }

    return { processed, errors, total: requests.length };

  } catch (error) {
    throw error;
  }
}

/**
 * Проверка напоминаний исполнителю за 2 часа до окончания срока (для waste)
 */
async function checkWasteReminders() {
  try {
    // Находим все waste заявки со статусом inProgress, где join_date + 22 часа = текущее время (с точностью до минуты)
    // 22 часа = 1320 минут, добавляем 1 минуту = 1321 минута
    const [requests] = await pool.execute(
      `SELECT id, join_date, joined_user_id 
       FROM requests 
       WHERE category = 'wasteLocation' 
         AND status = 'inProgress' 
         AND joined_user_id IS NOT NULL
         AND join_date IS NOT NULL
         AND join_date <= DATE_SUB(NOW(), INTERVAL 1320 MINUTE)
         AND join_date > DATE_SUB(NOW(), INTERVAL 1321 MINUTE)`
    );

    if (requests.length === 0) {
      return { processed: 0, errors: 0 };
    }

    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        await sendReminderNotification({
          userIds: [request.joined_user_id],
          requestId: request.id,
          requestCategory: 'wasteLocation',
        });
        
        // Записываем действие
        await logCronAction(
          'checkWasteReminders',
          request.id,
          'wasteLocation',
          `Напоминание исполнителю заявки ${request.id} за 2 часа до окончания срока`,
          'completed'
        );
        
        processed++;
      } catch (error) {
        errors++;
        // Записываем ошибку в лог с подробной информацией
        await logCronAction(
          'checkExpiredWasteJoins',
          request.id,
          'wasteLocation',
          `Ошибка при проверке истечения срока для заявки ${request.id}: ${error.message || 'Неизвестная ошибка'}`,
          'error',
          {
            error: error.message || 'Неизвестная ошибка',
            errorName: error.name || 'Error',
            errorStack: error.stack,
            requestId: request.id
          }
        );
      }
    }

    return { processed, errors, total: requests.length };

  } catch (error) {
    throw error;
  }
}

/**
 * Проверка истекших присоединений для waste (24 часа)
 */
async function checkExpiredWasteJoins() {
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
      return { processed: 0, errors: 0 };
    }

    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        // Отправляем пуш исполнителю
        await sendRequestExpiredNotification({
          userIds: [request.joined_user_id],
          requestId: request.id,
          messageType: 'executor',
          requestCategory: 'wasteLocation',
        });

        // Отправляем пуш создателю
        await sendRequestExpiredNotification({
          userIds: [request.created_by],
          requestId: request.id,
          messageType: 'creator',
          requestCategory: 'wasteLocation',
        });

        // Меняем статус на new и обнуляем joined_user_id и join_date
        await pool.execute(
          'UPDATE requests SET status = ?, joined_user_id = NULL, join_date = NULL, updated_at = NOW() WHERE id = ?',
          ['new', request.id]
        );

        // Записываем действие
        await logCronAction(
          'checkExpiredWasteJoins',
          request.id,
          'wasteLocation',
          `Истек срок для заявки ${request.id} (24 часа после присоединения), статус изменен на new`,
          'completed'
        );

        processed++;
      } catch (error) {
        errors++;
        // Записываем ошибку в лог с подробной информацией
        await logCronAction(
          'checkExpiredWasteJoins',
          request.id,
          'wasteLocation',
          `Ошибка при проверке истечения срока для заявки ${request.id}: ${error.message || 'Неизвестная ошибка'}`,
          'error',
          {
            error: error.message || 'Неизвестная ошибка',
            errorName: error.name || 'Error',
            errorStack: error.stack,
            requestId: request.id
          }
        );
      }
    }

    return { processed, errors, total: requests.length };

  } catch (error) {
    throw error;
  }
}

/**
 * Уведомление о скором удалении неактивных waste заявок
 * TODO: После проверки вернуть комментарий "через 7 дней" (сейчас 1 день для тестирования)
 */
async function notifyInactiveWasteRequests() {
  try {
    // TODO: После проверки изменить комментарий на "заявке исполнилось 7 дней" (сейчас 1 день для тестирования)
    // Находим все waste заявки со статусом new, где заявке исполнилось 1 день (expires_at <= NOW())
    // expires_at = created_at + 1 день, поэтому когда expires_at <= NOW(), заявке исполнилось 1 день
    // Пуш отправляется когда заявке исполнилось 1 день, и через сутки заявка будет удалена
    const [requests] = await pool.execute(
      `SELECT id, created_by, expires_at, extended_count
       FROM requests 
       WHERE category = 'wasteLocation'
         AND status = 'new' 
         AND expires_at IS NOT NULL
         AND expires_at <= NOW()
         AND expires_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
         AND extended_count = 0`
    );

    if (requests.length === 0) {
      return { processed: 0, errors: 0 };
    }

    let processed = 0;
    let errors = 0;

    const { sendRequestRejectedNotification } = require('../api/services/pushNotification');

    for (const request of requests) {
      try {
        // Проверяем, было ли уже отправлено уведомление для этой заявки
        const [existingActions] = await pool.execute(
          `SELECT id FROM cron_actions 
           WHERE action_type = 'notifyInactiveWasteRequests' 
             AND request_id = ? 
             AND status = 'completed'
           LIMIT 1`,
          [request.id]
        );

        // Если уведомление уже было отправлено, пропускаем
        if (existingActions.length > 0) {
          continue;
        }

        // Отправляем пуш создателю о том, что заявка будет удалена через сутки
        // И что он может продлить ее еще на неделю
        await sendRequestRejectedNotification({
          userIds: [request.created_by],
          requestId: request.id,
          messageType: 'creator',
          rejectionMessage: 'Your request will be deleted in 24 hours. You can extend it for another week by opening the request.',
          requestCategory: 'wasteLocation',
        });

        // Записываем действие
        await logCronAction(
          'notifyInactiveWasteRequests',
          request.id,
          'wasteLocation',
          `Уведомление создателю заявки ${request.id} о скором удалении (через 24 часа)`,
          'completed'
        );
        
        processed++;
      } catch (error) {
        errors++;
        // Записываем ошибку в лог с подробной информацией
        await logCronAction(
          'notifyInactiveWasteRequests',
          request.id,
          'wasteLocation',
          `Ошибка при уведомлении о скором удалении заявки ${request.id}: ${error.message || 'Неизвестная ошибка'}`,
          'error',
          {
            error: error.message || 'Неизвестная ошибка',
            errorName: error.name || 'Error',
            errorStack: error.stack,
            requestId: request.id
          }
        );
      }
    }

    return { processed, errors, total: requests.length };

  } catch (error) {
    throw error;
  }
}

/**
 * Архивирование неактивных waste заявок
 * Архивирует заявки типа wasteLocation:
 * 1. Со статусом 'new', если прошло 2 суток с момента создания и никто не взялся за исполнение
 * 2. Со статусом 'inProgress', если прошло 2 суток с момента присоединения и заявка не выполнена
 */
async function deleteInactiveRequests() {
  try {
    // 1. Находим все waste заявки со статусом new, где прошло 2 суток с момента создания
    // и никто не взялся за исполнение (joined_user_id IS NULL)
    const [newRequests] = await pool.execute(
      `SELECT id, created_by, cost, category
       FROM requests 
       WHERE category = 'wasteLocation'
         AND status = 'new' 
         AND joined_user_id IS NULL
         AND created_at <= DATE_SUB(NOW(), INTERVAL 2 DAY)`
    );

    // 2. Находим все waste заявки со статусом inProgress, где прошло 2 суток с момента присоединения
    // и заявка не выполнена (статус все еще inProgress, а не completed или approved)
    const [inProgressRequests] = await pool.execute(
      `SELECT id, created_by, cost, category, joined_user_id
       FROM requests 
       WHERE category = 'wasteLocation'
         AND status = 'inProgress' 
         AND joined_user_id IS NOT NULL
         AND join_date IS NOT NULL
         AND join_date <= DATE_SUB(NOW(), INTERVAL 2 DAY)`
    );

    // Объединяем оба списка
    const requests = [...newRequests, ...inProgressRequests];

    if (requests.length === 0) {
      return { processed: 0, errors: 0 };
    }

    if (requests.length === 0) {
      return { processed: 0, errors: 0 };
    }

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

        // Определяем тип архивирования для сообщения
        const isInProgress = request.joined_user_id !== null && request.joined_user_id !== undefined;
        const archiveReason = isInProgress 
          ? '2 суток без выполнения после присоединения'
          : '2 суток без присоединения';

        // Отправляем пуши создателю
        const { sendRequestRejectedNotification } = require('../api/services/pushNotification');
        await sendRequestRejectedNotification({
          userIds: [request.created_by],
          requestId: request.id,
          messageType: 'creator',
          rejectionMessage: isInProgress 
            ? 'Your request was archived because it was not completed on time'
            : 'Your request was archived due to inactivity',
          requestCategory: 'wasteLocation',
        });

        // Отправляем пуш исполнителю, если заявка была взята
        if (isInProgress) {
          await sendRequestRejectedNotification({
            userIds: [request.joined_user_id],
            requestId: request.id,
            messageType: 'executor',
            rejectionMessage: 'The request you took was archived because it was not completed on time',
            requestCategory: 'wasteLocation',
          });
        }

        // Отправляем пуши донатерам
        const donorUserIds = donations.map(d => d.user_id).filter(Boolean);
        if (donorUserIds.length > 0) {
          await sendRequestRejectedNotification({
            userIds: donorUserIds,
            requestId: request.id,
            messageType: 'donor',
            rejectionMessage: 'Request you donated to was archived',
            requestCategory: 'wasteLocation',
          });
        }

        // Архивируем заявку (переводим в статус archived)
        await pool.execute('UPDATE requests SET status = ? WHERE id = ?', ['archived', request.id]);
        
        // Записываем действие
        await logCronAction(
          'deleteInactiveRequests',
          request.id,
          request.category || 'wasteLocation',
          `Архивирование неактивной заявки ${request.id} (${archiveReason})`,
          'completed',
          { 
            donorCount: donations.length,
            wasInProgress: isInProgress,
            joinedUserId: request.joined_user_id || null
          }
        );
        
        processed++;
      } catch (error) {
        errors++;
        // Записываем ошибку в лог с подробной информацией
        await logCronAction(
          'deleteInactiveRequests',
          request.id,
          request.category || 'wasteLocation',
          `Ошибка при архивировании неактивной заявки ${request.id}: ${error.message || 'Неизвестная ошибка'}`,
          'error',
          {
            error: error.message || 'Неизвестная ошибка',
            errorName: error.name || 'Error',
            errorStack: error.stack,
            requestId: request.id
          }
        );
      }
    }

    return { processed, errors, total: requests.length };

  } catch (error) {
    throw error;
  }
}

/**
 * Проверка времени до события для event
 */
async function checkEventTimes() {
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
      return { processed: 0, errors: 0 };
    }

    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        const startDate = new Date(request.start_date);
        const diffHours = (startDate - now) / (1000 * 60 * 60);
        const diffMinutes = (startDate - now) / (1000 * 60);

        // Получаем зарегистрированных участников из registered_participants
        const [requestData] = await pool.execute(
          'SELECT registered_participants, created_by FROM requests WHERE id = ?',
          [request.id]
        );
        
        let participantUserIds = [];
        if (requestData[0]?.registered_participants) {
          try {
            participantUserIds = typeof requestData[0].registered_participants === 'string'
              ? JSON.parse(requestData[0].registered_participants)
              : requestData[0].registered_participants;
            if (!Array.isArray(participantUserIds)) {
              participantUserIds = [];
            }
          } catch (e) {
            participantUserIds = [];
          }
        }
        
        // Также добавляем создателя события (если его еще нет в списке)
        if (requestData[0]?.created_by && !participantUserIds.includes(requestData[0].created_by)) {
          participantUserIds.push(requestData[0].created_by);
        }

        // Проверяем время до события
        let actionDescription = '';
        let messageType = '';
        let shouldSendNotification = false;
        
        if (diffHours >= 23.5 && diffHours <= 24.5) {
          // За 24 часа
          messageType = '24hours';
          // Проверяем, было ли уже отправлено уведомление за 24 часа
          const [existingActions] = await pool.execute(
            `SELECT id FROM cron_actions 
             WHERE action_type = 'checkEventTimes' 
               AND request_id = ? 
               AND status = 'completed'
               AND action_description LIKE ?
             LIMIT 1`,
            [request.id, `%за 24 часа до начала%`]
          );
          if (existingActions.length === 0 && participantUserIds.length > 0) {
            await sendEventTimeNotification({
              userIds: participantUserIds,
              requestId: request.id,
              messageType: '24hours',
            });
            actionDescription = `Уведомление участникам события ${request.id} за 24 часа до начала`;
            shouldSendNotification = true;
          }
        } else if (diffHours >= 1.5 && diffHours <= 2.5) {
          // За 2 часа
          messageType = '2hours';
          // Проверяем, было ли уже отправлено уведомление за 2 часа
          const [existingActions] = await pool.execute(
            `SELECT id FROM cron_actions 
             WHERE action_type = 'checkEventTimes' 
               AND request_id = ? 
               AND status = 'completed'
               AND action_description LIKE ?
             LIMIT 1`,
            [request.id, `%за 2 часа до начала%`]
          );
          if (existingActions.length === 0 && participantUserIds.length > 0) {
            await sendEventTimeNotification({
              userIds: participantUserIds,
              requestId: request.id,
              messageType: '2hours',
            });
            actionDescription = `Уведомление участникам события ${request.id} за 2 часа до начала`;
            shouldSendNotification = true;
          }
        } else if (diffMinutes >= -5 && diffMinutes <= 5) {
          // Событие началось
          messageType = 'start';
          // Проверяем, было ли уже отправлено уведомление о начале
          const [existingActions] = await pool.execute(
            `SELECT id FROM cron_actions 
             WHERE action_type = 'checkEventTimes' 
               AND request_id = ? 
               AND status = 'completed'
               AND action_description LIKE ?
             LIMIT 1`,
            [request.id, `%Начало события%`]
          );
          if (existingActions.length === 0) {
            await sendEventTimeNotification({
              userIds: [request.created_by],
              requestId: request.id,
              messageType: 'start',
            });
            actionDescription = `Начало события ${request.id}`;
            shouldSendNotification = true;
          }
        }

        // Записываем действие, если было отправлено уведомление
        if (shouldSendNotification && actionDescription) {
          await logCronAction(
            'checkEventTimes',
            request.id,
            'event',
            actionDescription,
            'completed',
            { messageType, participantCount: participantUserIds.length }
          );
        }

        processed++;
      } catch (error) {
        errors++;
        // Записываем ошибку в лог с подробной информацией
        await logCronAction(
          'checkEventTimes',
          request.id,
          'event',
          `Ошибка при проверке времени события для заявки ${request.id}: ${error.message || 'Неизвестная ошибка'}`,
          'error',
          {
            error: error.message || 'Неизвестная ошибка',
            errorName: error.name || 'Error',
            errorStack: error.stack,
            requestId: request.id
          }
        );
      }
    }

    return { processed, errors, total: requests.length };

  } catch (error) {
    throw error;
  }
}

/**
 * Здесь можно добавлять новые периодические задачи
 */
async function runAllCronTasks() {
  const results = {};

  try {
    results.autoCompleteSpeedCleanup = await autoCompleteSpeedCleanup();
    results.checkWasteReminders = await checkWasteReminders();
    results.checkExpiredWasteJoins = await checkExpiredWasteJoins();
    results.checkEventTimes = await checkEventTimes();
    results.notifyInactiveWasteRequests = await notifyInactiveWasteRequests();

    const currentHour = new Date().getHours();
    if (currentHour === 0) {
      results.deleteInactiveRequests = await deleteInactiveRequests();
    } else {
      results.deleteInactiveRequests = { processed: 0, errors: 0, skipped: true };
    }

  } catch (error) {
    // Сохраняем ошибку в файл
    try {
      const lastRunInfo = {
        lastRun: new Date().toISOString(),
        results: results,
        status: 'error',
        error: error.message
      };
      const logsDir = path.dirname(LAST_RUN_FILE);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(lastRunInfo, null, 2));
    } catch (fileError) {
      // Не удалось сохранить
    }
    throw error;
  }

  // Сохраняем информацию о последнем запуске
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
    // Не удалось сохранить
  }

  return results;
}

// Запуск скрипта
if (require.main === module) {
  runAllCronTasks()
    .then((results) => {
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
        // Не удалось сохранить
      }

      process.exit(0);
    })
    .catch((err) => {
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
  notifyInactiveWasteRequests,
  deleteInactiveRequests,
  checkEventTimes
};

