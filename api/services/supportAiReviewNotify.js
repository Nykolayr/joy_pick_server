const pool = require('../config/database');
const { sendPlainEmail } = require('../config/email');
const { sendNotificationToUsers } = require('./pushNotification');

const DEFAULT_NOTIFY_EMAIL = 'nykolayr@gmail.com';
const APP_NAME = process.env.APP_NAME || 'Joy Pick';

function parseNotifyEmails() {
  const raw =
    process.env.SUPPORT_REVIEW_NOTIFY_EMAILS ||
    process.env.SUPPORT_REVIEW_NOTIFY_EMAIL ||
    DEFAULT_NOTIFY_EMAIL;
  return [...new Set(String(raw).split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
}

function parseNotifyUserIds() {
  const raw = process.env.SUPPORT_REVIEW_NOTIFY_USER_IDS || '';
  return [...new Set(String(raw).split(/[,;]/).map((x) => x.trim()).filter(Boolean))];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(text, max = 140) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function extractTicketContext(ticket) {
  const round = ticket?.current_round || null;
  const history = Array.isArray(ticket?.history) ? ticket.history : [];
  const last = round || history[history.length - 1] || {};
  return {
    id: ticket?.id || null,
    locale: ticket?.locale || 'ru',
    question: String(last.question || '').trim(),
    adminRemark: String(last.admin_remark || '').trim(),
    aiAnswer: String(last.ai_answer || '').trim()
  };
}

async function resolvePushUserIds(emails) {
  const explicit = parseNotifyUserIds();
  if (explicit.length) return explicit;

  const ids = [];
  for (const email of emails) {
    const [rows] = await pool.execute(
      `SELECT id FROM users
       WHERE LOWER(email) = LOWER(?)
         AND fcm_token IS NOT NULL AND fcm_token != ''
       LIMIT 1`,
      [email]
    );
    if (rows.length) ids.push(String(rows[0].id));
  }
  return [...new Set(ids)];
}

function buildAdminReviewUrl(ticketId) {
  const base = (process.env.ADMIN_WEB_BASE_URL || process.env.APP_URL || 'https://joypick.world')
    .replace(/\/$/, '');
  if (ticketId) return `${base}/admin/support-ai-review/${ticketId}`;
  return `${base}/admin/support-ai-review`;
}

async function countPendingReviewTickets() {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS c FROM support_ai_review_tickets WHERE status = 'pending_review'`
  );
  return Number(rows[0]?.c || 0);
}

/**
 * Сброс «пачки» уведомлений: когда pending_review = 0, следующий submit снова даст один push+email.
 */
async function resetSupportAiReviewNotifyBatchIfEmpty() {
  const pendingCount = await countPendingReviewTickets();
  const batchCleared = pendingCount === 0;
  if (batchCleared) {
    console.info('[supportAiReviewNotify] очередь пуста — следующий pending снова уведомит');
  }
  return { pendingCount, batchCleared };
}

/**
 * Пуш + email только для первого тикета в пачке (pending_review = 1).
 * Пока в очереди есть необработанные вопросы — повторных уведомлений нет.
 */
async function maybeNotifySupportAiReviewPending(ticket, { reason = 'submitted' } = {}) {
  if (String(process.env.SUPPORT_REVIEW_NOTIFY_ENABLED || '1').trim() === '0') {
    return { skipped: true, reason: 'disabled' };
  }

  const pendingCount = await countPendingReviewTickets();
  if (pendingCount !== 1) {
    return {
      skipped: true,
      reason: 'batch_already_notified',
      pendingCount
    };
  }

  return notifySupportAiReviewPending(ticket, { reason, pendingCount });
}

/**
 * Пуш + email при новом тикете в очереди ревью Support AI (pending_review).
 * Вызывать через maybeNotifySupportAiReviewPending — не напрямую.
 */
async function notifySupportAiReviewPending(ticket, { reason = 'submitted', pendingCount = 1 } = {}) {
  const ctx = extractTicketContext(ticket);
  if (!ctx.id || !ctx.question) {
    return { skipped: true, reason: 'empty_ticket' };
  }

  const emails = parseNotifyEmails();
  const title =
    reason === 'reopened'
      ? 'Support AI: повторное ревью'
      : 'Support AI: новые вопросы на ревью';
  const pushBody =
    pendingCount > 1
      ? `В очереди ${pendingCount} вопрос(ов). ${truncate(ctx.question, 100)}`
      : truncate(ctx.question, 160);
  const adminUrl = buildAdminReviewUrl(null);

  const result = { push: null, email: null, emails, userIds: [] };

  try {
    const userIds = await resolvePushUserIds(emails);
    result.userIds = userIds;
    if (userIds.length) {
      result.push = await sendNotificationToUsers({
        title,
        body: pushBody,
        userIds,
        sound: 'default',
        data: {
          type: 'support_ai_review_pending',
          ticket_id: ctx.id,
          locale: ctx.locale,
          reason
        },
        outboundLog: {
          send_source: 'support_ai_review_notify',
          skip_consolidation: true,
          send_reason: reason,
          push_trigger: 'support_ai_review_pending'
        }
      });
    } else {
      result.push = { successCount: 0, failureCount: 0, reason: 'no_fcm_user' };
    }
  } catch (e) {
    console.warn('[supportAiReviewNotify] push failed:', e.message);
    result.push = { error: e.message };
  }

  try {
    const subject = `[${APP_NAME}] ${title}`;
    const safeQuestion = escapeHtml(ctx.question);
    const safeRemark = escapeHtml(ctx.adminRemark || '—');
    const safeAnswer = escapeHtml(truncate(ctx.aiAnswer, 1200));
    const html = `
      <!doctype html>
      <html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#222;">
        <h2>${escapeHtml(title)}</h2>
        <p>В очереди ревью: <strong>${pendingCount}</strong> вопрос(ов). Пока они не обработаны, повторных писем не будет.</p>
        <p><strong>Первый в очереди — вопрос:</strong></p>
        <p style="white-space:pre-wrap;">${safeQuestion}</p>
        <p><strong>Замечание:</strong></p>
        <p style="white-space:pre-wrap;">${safeRemark}</p>
        <p><strong>Ответ ИИ (фрагмент):</strong></p>
        <p style="white-space:pre-wrap;">${safeAnswer}</p>
        <p><a href="${escapeHtml(adminUrl)}">Открыть очередь в админке</a></p>
        <p style="color:#666;font-size:12px;">Тикет: ${escapeHtml(ctx.id)}</p>
      </body></html>`;
    const text = [
      title,
      '',
      `В очереди: ${pendingCount} вопрос(ов).`,
      '',
      `Вопрос: ${ctx.question}`,
      '',
      `Замечание: ${ctx.adminRemark || '—'}`,
      '',
      `Ответ ИИ: ${truncate(ctx.aiAnswer, 1200)}`,
      '',
      `Админка: ${adminUrl}`,
      `ID: ${ctx.id}`
    ].join('\n');

    result.email = await sendPlainEmail({
      to: emails,
      subject,
      html,
      text
    });
  } catch (e) {
    console.warn('[supportAiReviewNotify] email failed:', e.message);
    result.email = { success: false, error: e.message };
  }

  console.info('[supportAiReviewNotify]', {
    ticketId: ctx.id,
    reason,
    pendingCount,
    pushOk: result.push?.successCount,
    emailOk: result.email?.success
  });

  return result;
}

module.exports = {
  maybeNotifySupportAiReviewPending,
  notifySupportAiReviewPending,
  resetSupportAiReviewNotifyBatchIfEmpty,
  countPendingReviewTickets,
  parseNotifyEmails,
  resolvePushUserIds
};
