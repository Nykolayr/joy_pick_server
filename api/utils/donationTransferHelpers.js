const pool = require('../config/database');
const stripe = require('../config/stripe.js');
const { generateId } = require('../utils/uuid');

const SUCCESS_STATUSES = ['succeeded', 'requires_capture'];

/**
 * Проверяет донаты заявки в Stripe и удаляет из заявки те, у которых платёж не успешен.
 * Обновляет total_contributed и удаляет записи donations — как будто неуспешного доната не было.
 * Вызывать перед автоматическим или ручным переводом.
 *
 * @param {string} requestId - ID заявки
 * @returns {Promise<{ removed: number, removedDonationIds: string[] }>}
 */
async function removeFailedDonationsFromRequest(requestId) {
  const removedDonationIds = [];

  const [donations] = await pool.execute(
    'SELECT id, amount, payment_intent_id FROM donations WHERE request_id = ?',
    [requestId]
  );

  for (const donation of donations) {
    if (!donation.payment_intent_id) {
      removedDonationIds.push(donation.id);
      continue;
    }

    let status = null;
    try {
      const stripePI = await stripe.paymentIntents.retrieve(donation.payment_intent_id);
      status = stripePI.status;

      const [existing] = await pool.execute(
        'SELECT id FROM payment_intents WHERE payment_intent_id = ?',
        [donation.payment_intent_id]
      );
      if (existing.length > 0) {
        await pool.execute(
          'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
          [status, donation.payment_intent_id]
        );
      } else {
        const id = generateId();
        await pool.execute(
          `INSERT INTO payment_intents (id, payment_intent_id, user_id, request_id, amount_cents, currency, status, type, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            stripePI.id,
            stripePI.metadata?.user_id || null,
            stripePI.metadata?.request_id || null,
            stripePI.amount || 0,
            stripePI.currency || 'usd',
            status,
            stripePI.metadata?.type || 'donation',
            JSON.stringify(stripePI.metadata || {})
          ]
        );
      }
    } catch (e) {
      status = 'unknown_failed';
    }

    if (!SUCCESS_STATUSES.includes(status)) {
      removedDonationIds.push(donation.id);
    }
  }

  let actuallyRemoved = 0;
  for (const donationId of removedDonationIds) {
    try {
      const [rows] = await pool.execute(
        'SELECT amount FROM donations WHERE id = ?',
        [donationId]
      );
      if (rows.length > 0) {
        const amount = parseFloat(rows[0].amount) || 0;
        await pool.execute(
          'UPDATE requests SET total_contributed = GREATEST(0, COALESCE(total_contributed, 0) - ?) WHERE id = ?',
          [amount, requestId]
        );
      }
      await pool.execute('DELETE FROM donations WHERE id = ?', [donationId]);
      actuallyRemoved++;
    } catch (e) {
      // один неудачный delete не прерываем — продолжаем удалять остальные
    }
  }

  return { removed: actuallyRemoved, removedDonationIds };
}

/**
 * Возвращает деньги донатерам по заявке (все успешные донаты — refund, остальные — cancel).
 * Используется при waste, если исполнитель без полного Stripe, и при event, если нет участников с полным Stripe.
 *
 * @param {string} requestId - ID заявки
 * @returns {Promise<{ refunded: number, donorUserIds: string[] }>}
 */
async function refundDonationsForRequest(requestId) {
  const donorUserIds = [];
  let refunded = 0;

  const [donations] = await pool.execute(
    'SELECT user_id, amount, payment_intent_id FROM donations WHERE request_id = ? AND payment_intent_id IS NOT NULL',
    [requestId]
  );

  for (const donation of donations) {
    if (!donation.payment_intent_id || !(parseFloat(donation.amount) > 0)) continue;
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(donation.payment_intent_id);
      if (paymentIntent.status === 'succeeded') {
        const charges = await stripe.charges.list({
          payment_intent: donation.payment_intent_id,
          limit: 1
        });
        if (charges.data.length > 0) {
          await stripe.refunds.create({
            charge: charges.data[0].id,
            reason: 'requested_by_customer'
          });
          await pool.execute(
            'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
            ['refunded', donation.payment_intent_id]
          );
          refunded++;
        }
      } else if (paymentIntent.status !== 'canceled') {
        await stripe.paymentIntents.cancel(donation.payment_intent_id);
        await pool.execute(
          'UPDATE payment_intents SET status = ?, updated_at = NOW() WHERE payment_intent_id = ?',
          ['canceled', donation.payment_intent_id]
        );
      }
      if (donation.user_id) donorUserIds.push(donation.user_id);
    } catch (e) {
      if (donation.user_id) donorUserIds.push(donation.user_id);
    }
  }

  return { refunded, donorUserIds };
}

module.exports = { removeFailedDonationsFromRequest, refundDonationsForRequest };
