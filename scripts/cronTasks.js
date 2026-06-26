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

async function clearSocialShareOnArchive(requestId) {
  if (!requestId) return;
  try {
    const { clearSocialShareForRequest } = require('../api/services/requestSocialShareService');
    await clearSocialShareForRequest(requestId);
  } catch (e) {
    console.warn('[cron] clearSocialShare:', requestId, e.message);
  }
}

const pool = require('../api/config/database');
const stripe = require('../api/config/stripe');
const { 
  sendSpeedCleanupNotification,
  sendReminderNotification,
  sendRequestExpiredNotification,
  sendRequestRejectedNotification,
  sendEventTimeNotification,
  sendTransferAvailableToUserNotification,
  sendTransferCheckFailedToSuperAdmins,
  getSuperAdminIds
} = require('../api/services/pushNotification');
const { generateId } = require('../api/utils/uuid');
const { deleteAllChatsForRequest } = require('../api/utils/chatHelpers');
const { releaseEarthdayCleanupOnRequestDelete } = require('../api/utils/earthdayRequestLink');

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
 * Автоматический перевод speedCleanup в archived после 7 дней с первой сдачи пользователем (donation_window_started_at), иначе от created_at.
 * Перед переводом: выплата по донатам после одобрения (payoutSpeedCleanupNewDonationsBeforeArchive).
 */
async function autoCompleteSpeedCleanup() {
  try {
    const [requests] = await pool.execute(
      `SELECT id, created_by FROM requests 
       WHERE category = 'speedCleanup' AND status = 'approved' 
         AND COALESCE(donation_window_started_at, created_at) <= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    if (requests.length === 0) {
      return { processed: 0, errors: 0 };
    }

    const { payoutSpeedCleanupNewDonationsBeforeArchive } = require('../api/routes/requests');
    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        const requestId = request.id;
        // Сначала выплата по донатам после одобрения (деньги создателю, коины только новым донатерам)
        const payoutResult = await payoutSpeedCleanupNewDonationsBeforeArchive(requestId);

        // Перевод в archived (после выплат и окончания срока)
        await pool.execute(
          'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
          ['archived', requestId]
        );
        await clearSocialShareOnArchive(requestId);

        if (request.created_by) {
          try {
            const hadDonations = Boolean(payoutResult.hadPostApprovalDonations);
            await sendSpeedCleanupNotification({
              userIds: [request.created_by],
              messageType: hadDonations ? 'executor' : 'executorArchiveNoDonations',
              requestId: requestId,
            });
          } catch (pushError) {}
        }

        await logCronAction(
          'autoCompleteSpeedCleanup',
          requestId,
          'speedCleanup',
          `Заявка ${requestId} переведена в archived (7 дней с donation_window_started_at/created_at)`,
          'completed',
          {}
        );
        processed++;
      } catch (requestError) {
        errors++;
        await logCronAction(
          'autoCompleteSpeedCleanup',
          request.id,
          'speedCleanup',
          `Ошибка при завершении заявки ${request.id}: ${requestError.message || 'Неизвестная ошибка'}`,
          'error',
          { error: requestError.message, requestId: request.id }
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
 * Уведомление о скором снятии неактивных waste заявок (никто не присоединился за 7 дней).
 * extended_count=0: «можно продлить на 7 дней, иначе через сутки снимем». extended_count=1: «через сутки снимем».
 */
async function notifyInactiveWasteRequests() {
  try {
    // Waste: new, никто не присоединился, expires_at истёк не более суток назад (окно 24ч для продления)
    const [requests] = await pool.execute(
      `SELECT id, created_by, expires_at, extended_count
       FROM requests 
       WHERE category = 'wasteLocation'
         AND status = 'new' 
         AND joined_user_id IS NULL
         AND expires_at IS NOT NULL
         AND expires_at <= NOW()
         AND expires_at > DATE_SUB(NOW(), INTERVAL 1 DAY)`
    );

    if (requests.length === 0) {
      return { processed: 0, errors: 0 };
    }

    let processed = 0;
    let errors = 0;

    const { sendRequestRejectedNotification } = require('../api/services/pushNotification');

    for (const request of requests) {
      try {
        const extCount = Number(request.extended_count) || 0;
        const [existingActions] = await pool.execute(
          `SELECT id, metadata FROM cron_actions 
           WHERE action_type = 'notifyInactiveWasteRequests' 
             AND request_id = ? 
             AND status = 'completed'`,
          [request.id]
        );
        const alreadySentForThisWindow = existingActions.some(a => {
          if (!a.metadata) return extCount === 0;
          try {
            const m = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata;
            return (m.extended_count || 0) === extCount;
          } catch (_) { return false; }
        });
        if (alreadySentForThisWindow) continue;

        const rejectionMessage = extCount === 0
          ? 'Заявке 7 дней, никто не присоединился. Можно продлить на 7 дней. Если не продлите в течение суток — заявка будет снята.'
          : 'Заявка будет снята через сутки (продление уже использовано).';

        await sendRequestRejectedNotification({
          userIds: [request.created_by],
          requestId: request.id,
          messageType: 'creator',
          rejectionMessage,
          requestCategory: 'wasteLocation',
        });

        await logCronAction(
          'notifyInactiveWasteRequests',
          request.id,
          'wasteLocation',
          `Уведомление создателю о продлении/снятии заявки ${request.id} (extended_count=${extCount})`,
          'completed',
          { extended_count: extCount }
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
 * Исполнитель не закрыл работу в срок: waste/speed — от created_at (7+1 суток). Event — checkEventAfterStartDate.
 */
async function checkExecutorStaleness() {
  const { sendRequestRejectedNotification } = require('../api/services/pushNotification');
  let warned = 0;
  let archived = 0;
  let errors = 0;

  try {
    const [warnWs] = await pool.execute(
      `SELECT id, created_by, category, joined_user_id, name FROM requests
       WHERE category IN ('wasteLocation', 'speedCleanup')
         AND status = 'inProgress'
         AND (
           (category = 'wasteLocation' AND joined_user_id IS NOT NULL)
           OR category = 'speedCleanup'
         )
         AND created_at <= DATE_SUB(NOW(), INTERVAL 7 DAY)
         AND created_at > DATE_SUB(NOW(), INTERVAL 8 DAY)`
    );

    const [archWs] = await pool.execute(
      `SELECT id, created_by, category, joined_user_id, name FROM requests
       WHERE category IN ('wasteLocation', 'speedCleanup')
         AND status = 'inProgress'
         AND (
           (category = 'wasteLocation' AND joined_user_id IS NOT NULL)
           OR category = 'speedCleanup'
         )
         AND created_at <= DATE_SUB(NOW(), INTERVAL 8 DAY)`
    );

    for (const request of warnWs) {
      try {
        const [done] = await pool.execute(
          `SELECT id FROM cron_actions WHERE action_type = 'executorStaleWarnCreator' AND request_id = ? AND status = 'completed' LIMIT 1`,
          [request.id]
        );
        if (done.length > 0) continue;
        await sendRequestRejectedNotification({
          userIds: [request.created_by],
          requestId: request.id,
          messageType: 'creator',
          rejectionMessage:
            'Исполнитель не сдал работу за 7 суток. Если за сутки ситуация не изменится — заявка будет отправлена в архив.',
          requestCategory: request.category
        });
        await logCronAction(
          'executorStaleWarnCreator',
          request.id,
          request.category,
          'Предупреждение создателю: 7 суток без сдачи работы исполнителем',
          'completed',
          {}
        );
        warned++;
      } catch (e) {
        errors++;
      }
    }

    const archivedIds = new Set();

    async function doArchive(request, reasonLabel) {
      if (archivedIds.has(request.id)) return;
      const [donations] = await pool.execute(
        'SELECT DISTINCT user_id FROM donations WHERE request_id = ?',
        [request.id]
      );
      const donorUserIds = donations.map((d) => d.user_id).filter(Boolean);
      await sendRequestRejectedNotification({
        userIds: [request.created_by],
        requestId: request.id,
        messageType: 'creator',
        rejectionMessage:
          'Заявка отправлена в архив: работа не была сдана исполнителем в срок (7+1 суток).',
        requestCategory: request.category
      }).catch(() => {});
      if (request.joined_user_id) {
        await sendRequestRejectedNotification({
          userIds: [request.joined_user_id],
          requestId: request.id,
          messageType: 'executor',
          rejectionMessage:
            'Заявка в архиве: не была сдана в срок (7+1 суток по правилам платформы).',
          requestCategory: request.category
        }).catch(() => {});
      }
      if (donorUserIds.length > 0) {
        await sendRequestRejectedNotification({
          userIds: donorUserIds,
          requestId: request.id,
          messageType: 'donor',
          rejectionMessage: 'Заявка архивирована: исполнитель не сдал работу в срок.',
          requestCategory: request.category
        }).catch(() => {});
      }
      await pool.execute(
        'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
        ['archived', request.id]
      );
      await clearSocialShareOnArchive(request.id);
      await logCronAction(
        'executorStaleArchive',
        request.id,
        request.category,
        `Архив: исполнитель не сдал в срок — ${reasonLabel}`,
        'completed',
        {}
      );
      archivedIds.add(request.id);
      archived++;
    }

    for (const request of archWs) {
      try {
        await doArchive(request, 'waste/speed от created_at');
      } catch (e) {
        errors++;
      }
    }

    return { warned, archived, errors };
  } catch (error) {
    throw error;
  }
}

/**
 * Финализация предложенных решений автомодерации после grace period (24ч по умолчанию).
 */
async function finalizePendingModerationProposals() {
  const { finalizeDueProposals } = require('../api/services/requestModerationService');
  let result = { finalized: 0, errors: 0, total: 0 };
  try {
    result = await finalizeDueProposals();
    if (result.finalized > 0) {
      await logCronAction(
        'moderationAutoFinalize',
        null,
        null,
        `Автофинализация предложенной модерации: ${result.finalized} заявок`,
        'completed',
        result
      );
    }
  } catch (e) {
    result = { finalized: 0, errors: 1, total: 0, error: e.message };
  }
  return result;
}

/**
 * pending на модерации: окно 7 суток с первой сдачи (donation_window_started_at / submitted_for_review_at).
 * На 6–7 сутки — пуш админам; после 7 — архив + рефанд донатов (как раньше по смыслу, SLA под новое окно донатов).
 * Не архивирует заявки с активным предложением автомодерации до moderation_finalize_at.
 */
async function checkModerationReviewStale() {
  const { sendModerationStaleReminderNotification } = require('../api/services/pushNotification');
  const { archivePendingModerationTimeout } = require('../api/routes/requests');
  let warned = 0;
  let archived = 0;
  let errors = 0;

  try {
    const [toArchive] = await pool.execute(
      `SELECT id, name, category, created_by, submitted_for_review_at, updated_at, donation_window_started_at
       FROM requests
       WHERE status = 'pending'
         AND category IN ('wasteLocation', 'speedCleanup', 'event')
         AND NOT (
           moderation_proposed_action IS NOT NULL
           AND moderation_cancelled_at IS NULL
           AND moderation_finalize_at IS NOT NULL
           AND moderation_finalize_at > NOW()
         )
         AND (
           (COALESCE(donation_window_started_at, submitted_for_review_at) IS NOT NULL
            AND COALESCE(donation_window_started_at, submitted_for_review_at) <= DATE_SUB(NOW(), INTERVAL 7 DAY))
           OR (COALESCE(donation_window_started_at, submitted_for_review_at) IS NULL
            AND updated_at <= DATE_SUB(NOW(), INTERVAL 7 DAY))
         )`
    );

    const [toWarn] = await pool.execute(
      `SELECT id, name, category, created_by, submitted_for_review_at, updated_at, donation_window_started_at
       FROM requests
       WHERE status = 'pending'
         AND category IN ('wasteLocation', 'speedCleanup', 'event')
         AND (
           (
             COALESCE(donation_window_started_at, submitted_for_review_at) IS NOT NULL
             AND COALESCE(donation_window_started_at, submitted_for_review_at) <= DATE_SUB(NOW(), INTERVAL 6 DAY)
             AND COALESCE(donation_window_started_at, submitted_for_review_at) > DATE_SUB(NOW(), INTERVAL 7 DAY)
           )
           OR (
             COALESCE(donation_window_started_at, submitted_for_review_at) IS NULL
             AND updated_at <= DATE_SUB(NOW(), INTERVAL 6 DAY)
             AND updated_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
           )
         )`
    );

    const archiveIds = new Set(toArchive.map((r) => r.id));

    for (const request of toArchive) {
      try {
        await archivePendingModerationTimeout(request.id, request.category, request.created_by);
        await logCronAction(
          'moderationTimeoutArchive',
          request.id,
          request.category,
          'Архив: нет апрува модератора 7+ суток с момента сдачи пользователем (донаты возвращены)',
          'completed',
          {}
        );
        archived++;
      } catch (e) {
        errors++;
        await logCronAction(
          'moderationTimeoutArchive',
          request.id,
          request.category,
          `Ошибка архива по SLA модерации: ${e.message}`,
          'error',
          { error: e.message }
        );
      }
    }

    for (const request of toWarn) {
      if (archiveIds.has(request.id)) continue;
      try {
        const [done] = await pool.execute(
          `SELECT id FROM cron_actions WHERE action_type = 'moderationStaleWarnAdmins' AND request_id = ? AND status = 'completed' LIMIT 1`,
          [request.id]
        );
        if (done.length > 0) continue;
        await sendModerationStaleReminderNotification({
          requestId: request.id,
          requestName: request.name,
          requestCategory: request.category,
          daysWaiting: 7
        });
        await logCronAction(
          'moderationStaleWarnAdmins',
          request.id,
          request.category,
          'Пуш модераторам: pending 7+ суток без апрува',
          'completed',
          {}
        );
        warned++;
      } catch (e) {
        errors++;
      }
    }

    return { warned, archived, errors };
  } catch (error) {
    throw error;
  }
}

/**
 * Архивирование/снятие неактивных заявок.
 * Waste: new без исполнителя — сутки после expires_at (как раньше).
 * Исполнитель не сдал работу 7+1 суток — в checkExecutorStaleness; модерация pending 7+1 — в checkModerationReviewStale.
 * Speed «завис в new/inProgress» без ухода на модерацию — 8 дней с created_at → handleRequestRejection (event — только checkEventAfterStartDate от start_date).
 * @param {Object} [options] - skipSpeedEventReject: true при вызове из GET /api/requests
 */
async function deleteInactiveRequests(options = {}) {
  try {
    // 1. Waste new, никто не присоединился: expires_at + 1 день прошло → мягкое снятие (archived)
    const [wasteNewToArchive] = await pool.execute(
      `SELECT id, created_by, category, joined_user_id
       FROM requests 
       WHERE category = 'wasteLocation'
         AND status = 'new' 
         AND joined_user_id IS NULL
         AND expires_at IS NOT NULL
         AND expires_at <= DATE_SUB(NOW(), INTERVAL 1 DAY)`
    );

    // 2. Speed: 8 дней с created_at, ещё не ушёл на модерацию — отклоняем (рефанды). Event не трогаем (см. checkEventAfterStartDate).
    const [speedEventToReject] = await pool.execute(
      `SELECT id, created_by, category, name
       FROM requests 
       WHERE category = 'speedCleanup'
         AND status IN ('new', 'inProgress')
         AND created_at <= DATE_SUB(NOW(), INTERVAL 8 DAY)`
    );

    const archiveCandidates = [...wasteNewToArchive];
    const seenArchive = new Set();
    const requestsToArchive = [];
    for (const r of archiveCandidates) {
      if (seenArchive.has(r.id)) continue;
      seenArchive.add(r.id);
      requestsToArchive.push(r);
    }
    let processed = 0;
    let errors = 0;

    const { sendRequestRejectedNotification } = require('../api/services/pushNotification');

    const archivedIdsThisRun = new Set();

    for (const request of requestsToArchive) {
      try {
        const [donations] = await pool.execute(
          'SELECT DISTINCT user_id, amount FROM donations WHERE request_id = ?',
          [request.id]
        );
        const isInProgress = request.joined_user_id != null;
        const cat = String(request.category || '');
        let archiveReason = 'Авто-архив: неактивная или просроченная заявка';
        if (cat === 'wasteLocation') {
          archiveReason = 'wasteLocation: истёк срок (expires_at), никто не присоединился / не продлено';
        }

        await sendRequestRejectedNotification({
          userIds: [request.created_by],
          requestId: request.id,
          messageType: 'creator',
          rejectionMessage: isInProgress
            ? 'Your request was archived because it was not completed on time'
            : 'Заявка снята: никто не присоединился в срок или не продлена.',
          requestCategory: request.category || 'wasteLocation',
        });
        if (isInProgress) {
          await sendRequestRejectedNotification({
            userIds: [request.joined_user_id],
            requestId: request.id,
            messageType: 'executor',
            rejectionMessage: 'The request you took was archived because it was not completed on time',
            requestCategory: 'wasteLocation',
          });
        }
        const donorUserIds = donations.map(d => d.user_id).filter(Boolean);
        if (donorUserIds.length > 0) {
          await sendRequestRejectedNotification({
            userIds: donorUserIds,
            requestId: request.id,
            messageType: 'donor',
            rejectionMessage: 'Request you donated to was archived',
            requestCategory: request.category || 'wasteLocation',
          });
        }

        await pool.execute(
          'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
          ['archived', request.id]
        );
        await clearSocialShareOnArchive(request.id);
        await logCronAction(
          'deleteInactiveRequests',
          request.id,
          request.category || 'wasteLocation',
          `Архивирование заявки ${request.id} (${archiveReason})`,
          'completed',
          { donorCount: donations.length, wasInProgress: isInProgress }
        );
        archivedIdsThisRun.add(request.id);
        processed++;
      } catch (error) {
        errors++;
        await logCronAction(
          'deleteInactiveRequests',
          request.id,
          request.category || 'wasteLocation',
          `Ошибка архивирования ${request.id}: ${error.message || 'Неизвестная ошибка'}`,
          'error',
          { error: error.message }
        );
      }
    }

    // Speed: отклонение без одобрения (рефанды, пуши, status=rejected). Пропускаем при вызове из GET /api/requests (skipSpeedEventReject).
    if (!options.skipSpeedEventReject) {
      const { handleRequestRejection } = require('../api/routes/requests');
      for (const request of speedEventToReject) {
        if (archivedIdsThisRun.has(request.id)) {
          continue;
        }
        try {
          await handleRequestRejection(
            request.id,
            request.category,
            request.created_by,
            'Не одобрена в течение 7 дней',
            'Заявка снята: не одобрена модератором в течение 7 дней.'
          );
          await logCronAction(
            'deleteInactiveRequests',
            request.id,
            request.category,
            `Авто-отклонение заявки ${request.id} (8 дней без одобрения)`,
            'completed',
            { reason: 'not_approved_in_time' }
          );
          processed++;
        } catch (error) {
          errors++;
          await logCronAction(
            'deleteInactiveRequests',
            request.id,
            request.category,
            `Ошибка авто-отклонения ${request.id}: ${error.message || 'Неизвестная ошибка'}`,
            'error',
            { error: error.message }
          );
        }
      }
    }

    return { processed, errors, total: requestsToArchive.length + (options.skipSpeedEventReject ? 0 : speedEventToReject.length) };
  } catch (error) {
    throw error;
  }
}

/**
 * Уведомление суперадминов: speed 7 дней с created_at без закрытия (event — отдельно checkEventAfterStartDate).
 */
async function notifySuperadminsRequestNotClosed() {
  try {
    const [requests] = await pool.execute(
      `SELECT id, name, category, created_by, created_at, start_date
       FROM requests 
       WHERE category = 'speedCleanup'
         AND status IN ('new', 'inProgress', 'pending')
         AND created_at <= DATE_SUB(NOW(), INTERVAL 7 DAY)
         AND created_at > DATE_SUB(NOW(), INTERVAL 8 DAY)`
    );
    if (requests.length === 0) {
      return { processed: 0, errors: 0 };
    }

    const superAdminIds = await getSuperAdminIds();
    if (superAdminIds.length === 0) {
      return { processed: 0, errors: 0 };
    }

    let processed = 0;
    let errors = 0;
    const { sendRequestRejectedNotification } = require('../api/services/pushNotification');

    for (const request of requests) {
      try {
        const [existing] = await pool.execute(
          `SELECT id FROM cron_actions 
           WHERE action_type = 'notifySuperadminsRequestNotClosed' AND request_id = ? AND status = 'completed' LIMIT 1`,
          [request.id]
        );
        if (existing.length > 0) continue;

        await sendRequestRejectedNotification({
          userIds: superAdminIds,
          requestId: request.id,
          messageType: 'creator',
          rejectionMessage: `Заявка «${(request.name || '').slice(0, 50)}» не закрыта. 7 дней с создания — нужно одобрить или отклонить в админке.`,
          requestCategory: request.category,
        });

        await logCronAction(
          'notifySuperadminsRequestNotClosed',
          request.id,
          request.category,
          `Уведомление суперадминам: заявка ${request.id} не закрыта`,
          'completed'
        );
        processed++;
      } catch (error) {
        errors++;
        await logCronAction(
          'notifySuperadminsRequestNotClosed',
          request.id,
          request.category,
          `Ошибка уведомления суперадминам: ${error.message || 'Неизвестная ошибка'}`,
          'error',
          { error: error.message }
        );
      }
    }

    return { processed, errors, total: requests.length };
  } catch (error) {
    throw error;
  }
}

/**
 * Выплаты и коины для speedCleanup/event: когда одобрено модератором и прошло 7 дней с первой сдачи работы пользователем (donation_window_started_at), иначе fallback created_at.
 */
async function processPayoutAfter7Days() {
  try {
    const [requests] = await pool.execute(
      `SELECT id, category, created_by, start_date, end_date
       FROM requests 
       WHERE category IN ('speedCleanup', 'event')
         AND status = 'approved'
         AND COALESCE(donation_window_started_at, created_at) <= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
    if (requests.length === 0) {
      return { processed: 0, errors: 0 };
    }

    const { handleEventApproval, handleSpeedCleanupApproval } = require('../api/routes/requests');
    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        const [existing] = await pool.execute(
          `SELECT id FROM cron_actions 
           WHERE action_type = 'processPayoutAfter7Days' AND request_id = ? AND status = 'completed' LIMIT 1`,
          [request.id]
        );
        if (existing.length > 0) continue;

        if (request.category === 'event') {
          await handleEventApproval(request.id, request.created_by);
        } else if (request.category === 'speedCleanup') {
          let earnedCoin = false;
          if (request.start_date && request.end_date) {
            const start = new Date(request.start_date);
            const end = new Date(request.end_date);
            const diffMinutes = (end - start) / (1000 * 60);
            earnedCoin = diffMinutes >= 20;
          }
          await handleSpeedCleanupApproval(request.id, request.created_by, earnedCoin);
        }

        await logCronAction(
          'processPayoutAfter7Days',
          request.id,
          request.category,
          `Выплаты и коины после 7 дней для заявки ${request.id}`,
          'completed'
        );
        processed++;
      } catch (error) {
        errors++;
        await logCronAction(
          'processPayoutAfter7Days',
          request.id,
          request.category,
          `Ошибка выплат после 7 дней: ${error.message || 'Неизвестная ошибка'}`,
          'error',
          { error: error.message }
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
 * Event (субботник) после start_date: created_at не учитывается.
 * - start_date прошла, < 24 ч: напоминание закрыть (pendingApproval) или перенести дату.
 * - start_date + 24 ч, всё ещё new/inProgress: archived (не delete, не rejected).
 * Закрыто = pendingApproval / approved / archived / rejected — не трогаем.
 */
async function checkEventAfterStartDate() {
  try {
    const { sendEventCompletionReminderNotification } = require('../api/services/pushNotification');

    const eventOpenWhere = `
      category = 'event'
      AND status IN ('new', 'inProgress')
      AND start_date IS NOT NULL
    `;

    const [toArchive] = await pool.execute(
      `SELECT id, created_by, start_date, status, name
       FROM requests
       WHERE ${eventOpenWhere}
         AND start_date <= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );

    const [toRemind] = await pool.execute(
      `SELECT id, created_by, start_date, status, name
       FROM requests
       WHERE ${eventOpenWhere}
         AND start_date <= NOW()
         AND start_date > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );

    let archived = 0;
    let warnings = 0;
    let errors = 0;

    for (const request of toArchive) {
      try {
        const [donations] = await pool.execute(
          'SELECT DISTINCT user_id FROM donations WHERE request_id = ?',
          [request.id]
        );
        const donorUserIds = donations.map((d) => d.user_id).filter(Boolean);

        await sendRequestRejectedNotification({
          userIds: [request.created_by],
          requestId: request.id,
          messageType: 'creator',
          rejectionMessage:
            'Событие отправлено в архив: в течение суток после даты уборки не было отправлено на модерацию и дата не перенесена.',
          requestCategory: 'event',
        }).catch(() => {});

        if (donorUserIds.length > 0) {
          await sendRequestRejectedNotification({
            userIds: donorUserIds,
            requestId: request.id,
            messageType: 'donor',
            rejectionMessage: 'Event archived: not submitted for review within 24 hours after the scheduled date.',
            requestCategory: 'event',
          }).catch(() => {});
        }

        await pool.execute(
          'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
          ['archived', request.id]
        );
        await clearSocialShareOnArchive(request.id);

        await logCronAction(
          'checkEventAfterStartDate',
          request.id,
          'event',
          `Архив event "${request.name}" через 24ч после start_date (не отправлено на модерацию)`,
          'completed',
          { start_date: request.start_date }
        );
        archived++;
      } catch (err) {
        errors++;
        await logCronAction(
          'checkEventAfterStartDate',
          request.id,
          'event',
          `Ошибка архива event ${request.id}: ${err.message || 'Неизвестная ошибка'}`,
          'error',
          { error: err.message }
        );
      }
    }

    for (const request of toRemind) {
      try {
        const [warningActions] = await pool.execute(
          `SELECT id FROM cron_actions
           WHERE action_type = 'checkEventAfterStartDate'
             AND request_id = ?
             AND status = 'completed'
             AND action_description LIKE '%предупреждение%'
           LIMIT 1`,
          [request.id]
        );
        if (warningActions.length > 0) continue;

        await sendEventCompletionReminderNotification({
          userIds: [request.created_by],
          requestId: request.id,
          eventName: request.name || 'Событие',
          hoursRemaining: 24,
        });

        await logCronAction(
          'checkEventAfterStartDate',
          request.id,
          'event',
          `Отправка предупреждения для event "${request.name}" после start_date (закройте или перенесите дату)`,
          'completed',
          { start_date: request.start_date }
        );
        warnings++;
      } catch (err) {
        errors++;
      }
    }

    return {
      processed: archived,
      archived,
      warnings,
      errors,
      total: toArchive.length + toRemind.length,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Legacy cleanup для старого статуса pending_payment.
 * Поле requests.payment_intent_id удалено, поэтому здесь НЕ обращаемся к нему.
 * Если в БД остались старые pending_payment заявки — просто архивируем их.
 */
async function cleanupUnpaidRequests() {
  try {
    // Находим legacy-заявки pending_payment:
    // - wasteLocation/speedCleanup: старше 24 часов
    // - event: когда start_date уже прошла
    const [requests] = await pool.execute(
      `SELECT id, created_by, category, start_date
       FROM requests 
       WHERE status = 'pending_payment'
         AND (
           (category IN ('wasteLocation', 'speedCleanup') AND created_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR))
           OR 
           (category = 'event' AND start_date IS NOT NULL AND start_date <= NOW())
         )`
    );

    if (requests.length === 0) {
      return { processed: 0, errors: 0 };
    }

    let processed = 0;
    let errors = 0;

    for (const request of requests) {
      try {
        const rejectionMessage = request.category === 'event'
          ? 'Your event was archived because it stayed in legacy pending_payment status after event date'
          : 'Your request was archived because it stayed in legacy pending_payment status';

        await sendRequestRejectedNotification({
          userIds: [request.created_by],
          requestId: request.id,
          messageType: 'creator',
          rejectionMessage,
          requestCategory: request.category || 'wasteLocation',
        });

        // Безопасно переводим в archived вместо удаления: это legacy-сценарий после миграции платежей на donations.
        await pool.execute(
          'UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?',
          ['archived', request.id]
        );
        await clearSocialShareOnArchive(request.id);

        await logCronAction(
          'cleanupUnpaidRequests',
          request.id,
          request.category || 'wasteLocation',
          `Legacy pending_payment -> archived для заявки ${request.id}`,
          'completed',
          { start_date: request.start_date || null, legacy: true }
        );

        processed++;
      } catch (error) {
        errors++;
        await logCronAction(
          'cleanupUnpaidRequests',
          request.id,
          request.category || 'wasteLocation',
          `Ошибка при очистке неоплаченной заявки ${request.id}: ${error.message || 'Неизвестная ошибка'}`,
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
 * Проверка доступности выплат: через (2 дня + 2 ч) после Transfer проверяем баланс Stripe.
 * Если деньги доступны — пуш получателю; если нет — повтор через 6 ч; при второй неудаче — пуш суперадминам.
 */
async function checkTransferPayoutAvailability() {
  try {
    const [rows] = await pool.execute(
      `SELECT c.id AS check_id, c.transfer_id, c.performer_user_id, c.amount_cents, c.attempt
       FROM transfer_payout_checks c
       WHERE c.status = 'pending' AND c.check_after <= NOW()`
    );

    if (rows.length === 0) {
      return { processed: 0, errors: 0 };
    }

    let processed = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const { check_id, transfer_id, performer_user_id, amount_cents, attempt } = row;
        const amountDollars = (amount_cents / 100).toFixed(2);

        const [transfers] = await pool.execute(
          'SELECT transfer_id AS stripe_transfer_id, request_id FROM transfers WHERE id = ?',
          [transfer_id]
        );
        const stripeTransferId = transfers[0]?.stripe_transfer_id || transfer_id;
        const requestId = transfers[0]?.request_id || null;

        const [accounts] = await pool.execute(
          'SELECT account_id FROM stripe_accounts WHERE user_id = ?',
          [performer_user_id]
        );

        let availableCents = 0;
        if (accounts.length > 0) {
          try {
            const balance = await stripe.balance.retrieve({ stripeAccount: accounts[0].account_id });
            const usd = (balance.available || []).find(b => b.currency === 'usd');
            availableCents = usd ? usd.amount : 0;
          } catch (stripeErr) {
            // Ошибка Stripe — считаем, что деньги не доступны
          }
        }

        if (availableCents >= amount_cents) {
          await sendTransferAvailableToUserNotification({
            userId: performer_user_id,
            amountDollars
          });
          await pool.execute(
            "UPDATE transfer_payout_checks SET status = 'money_available', updated_at = NOW() WHERE id = ?",
            [check_id]
          );
          await logCronAction(
            'checkTransferPayoutAvailability',
            requestId,
            null,
            `Проверка выплаты ${transfer_id}: деньги доступны, пуш отправлен пользователю ${performer_user_id}`,
            'completed',
            { transfer_id, performer_user_id, amount_cents }
          );
          processed++;
        } else {
          if (attempt === 1) {
            await pool.execute(
              `UPDATE transfer_payout_checks SET check_after = DATE_ADD(NOW(), INTERVAL 6 HOUR), attempt = 2, updated_at = NOW() WHERE id = ?`,
              [check_id]
            );
            await logCronAction(
              'checkTransferPayoutAvailability',
              requestId,
              null,
              `Проверка выплаты ${transfer_id}: деньги ещё не доступны, повтор через 6 ч`,
              'completed',
              { transfer_id, performer_user_id, amount_cents }
            );
            processed++;
          } else {
            const details = `Balance check failed: available=${availableCents} cents, required=${amount_cents} cents. Stripe transfer: ${stripeTransferId}.`;
            await sendTransferCheckFailedToSuperAdmins({
              transferId: stripeTransferId,
              performerUserId: performer_user_id,
              amountCents: amount_cents,
              requestId,
              details
            });
            await pool.execute(
              "UPDATE transfer_payout_checks SET status = 'alert_sent', updated_at = NOW() WHERE id = ?",
              [check_id]
            );
            await logCronAction(
              'checkTransferPayoutAvailability',
              requestId,
              null,
              `Проверка выплаты ${transfer_id}: деньги не дошли после 2 проверок, пуш суперадминам`,
              'completed',
              { transfer_id, performer_user_id, amount_cents }
            );
            processed++;
          }
        }
      } catch (err) {
        errors++;
        await logCronAction(
          'checkTransferPayoutAvailability',
          null,
          null,
          `Ошибка проверки выплаты ${row.transfer_id}: ${err.message || 'Неизвестная ошибка'}`,
          'error',
          { error: err.message, transfer_id: row.transfer_id }
        );
      }
    }

    return { processed, errors, total: rows.length };
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
    // Первая выплата — при одобрении (requests.js). Перед архивом — только новые донаты (в autoCompleteSpeedCleanup).
    results.autoCompleteSpeedCleanup = await autoCompleteSpeedCleanup();
    results.checkWasteReminders = await checkWasteReminders();
    results.checkExpiredWasteJoins = await checkExpiredWasteJoins();
    results.checkEventTimes = await checkEventTimes();
    results.checkEventAfterStartDate = await checkEventAfterStartDate();
    results.checkTransferPayoutAvailability = await checkTransferPayoutAvailability();
    results.notifyInactiveWasteRequests = await notifyInactiveWasteRequests();
    results.notifySuperadminsRequestNotClosed = await notifySuperadminsRequestNotClosed();
    results.cleanupUnpaidRequests = await cleanupUnpaidRequests();
    results.checkExecutorStaleness = await checkExecutorStaleness();
    results.finalizePendingModerationProposals = await finalizePendingModerationProposals();
    results.checkModerationReviewStale = await checkModerationReviewStale();

    // Раньше архивация вызывалась только в 00:00 локального сервера — из‑за этого «просроченные»
    // заявки месяцами оставались активными. Запускаем при каждом проходе крона.
    results.deleteInactiveRequests = await deleteInactiveRequests();

    try {
      const { processEarthdayBulkCreateJobsTick } = require('../api/services/earthdayBulkCreateJobs');
      results.earthdayBulkCreateJobs = await processEarthdayBulkCreateJobsTick(pool);
    } catch (earthdayJobErr) {
      results.earthdayBulkCreateJobs = { error: earthdayJobErr.message || 'earthdayBulkCreateJobs failed' };
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
  earthdayBulkCreateJobsTick: async () => {
    const { processEarthdayBulkCreateJobsTick } = require('../api/services/earthdayBulkCreateJobs');
    return processEarthdayBulkCreateJobsTick(pool);
  },
  autoCompleteSpeedCleanup,
  checkWasteReminders,
  checkExpiredWasteJoins,
  checkTransferPayoutAvailability,
  notifyInactiveWasteRequests,
  notifySuperadminsRequestNotClosed,
  deleteInactiveRequests,
  checkEventTimes,
  checkEventAfterStartDate,
  cleanupUnpaidRequests,
  checkExecutorStaleness,
  finalizePendingModerationProposals,
  checkModerationReviewStale
};

