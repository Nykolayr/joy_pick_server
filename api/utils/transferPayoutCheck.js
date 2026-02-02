const pool = require('../config/database');
const { generateId } = require('../utils/uuid');

/**
 * Создаёт запись в transfer_payout_checks после успешного Transfer.
 * Cron через (2 дня + 2 часа) проверит баланс Stripe; при необходимости повтор через 6 ч и пуш суперадминам.
 *
 * @param {string} transferId - id из таблицы transfers (внутренний UUID)
 * @param {string} performerUserId - ID получателя (исполнителя/создателя)
 * @param {number} amountCents - сумма в центах
 */
async function insertTransferPayoutCheck(transferId, performerUserId, amountCents) {
  try {
    const checkId = generateId();
    await pool.execute(
      `INSERT INTO transfer_payout_checks (id, transfer_id, performer_user_id, amount_cents, check_after, attempt, status)
       VALUES (?, ?, ?, ?, DATE_ADD(DATE_ADD(NOW(), INTERVAL 2 DAY), INTERVAL 2 HOUR), 1, 'pending')`,
      [checkId, transferId, performerUserId, amountCents]
    );
  } catch (err) {
    // Не прерываем основной поток при ошибке записи проверки
  }
}

module.exports = { insertTransferPayoutCheck };
