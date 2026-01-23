const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const stripe = require('../config/stripe');
const { generateId } = require('../utils/uuid');

const router = express.Router();

// Все роуты требуют суперадмина
router.use(authenticate);
router.use(requireSuperAdmin);

// ============================================================================
// СЕКЦИЯ 1: PAYMENT INTENTS (Платежи)
// ============================================================================

/**
 * GET /api/stripe-admin/payment-intents
 * Получение списка PaymentIntent
 * 
 * Query параметры:
 * - request_id - фильтр по заявке
 * - user_id - фильтр по пользователю
 * - type - тип (donation/request_payment)
 * - status - статус (requires_capture, succeeded, canceled, etc.)
 * - limit - количество (по умолчанию 10, максимум 100)
 */
router.get('/payment-intents', async (req, res) => {
  try {
    const { request_id, user_id, type, status, limit = 10 } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    // Сначала получаем из БД для фильтрации
    let query = 'SELECT * FROM payment_intents WHERE 1=1';
    const params = [];

    if (request_id) {
      query += ' AND request_id = ?';
      params.push(request_id);
    }
    if (user_id) {
      query += ' AND user_id = ?';
      params.push(user_id);
    }
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT ${limitNum}`;

    const [paymentIntents] = await pool.execute(query, params);

    // Получаем детальную информацию из Stripe для каждого PaymentIntent
    const detailedPaymentIntents = await Promise.all(
      paymentIntents.map(async (pi) => {
        try {
          const stripePI = await stripe.paymentIntents.retrieve(pi.payment_intent_id, {
            expand: ['charges.data.payment_method', 'charges.data.balance_transaction']
          });

          return {
            ...pi,
            stripe_data: {
              id: stripePI.id,
              amount: stripePI.amount,
              currency: stripePI.currency,
              status: stripePI.status,
              created: stripePI.created,
              payment_method: stripePI.payment_method,
              payment_method_types: stripePI.payment_method_types,
              capture_method: stripePI.capture_method,
              amount_capturable: stripePI.amount_capturable,
              amount_received: stripePI.amount_received,
              charges: stripePI.charges?.data?.map(charge => ({
                id: charge.id,
                amount: charge.amount,
                status: charge.status,
                payment_method_details: charge.payment_method_details,
                billing_details: charge.billing_details,
                receipt_url: charge.receipt_url,
                balance_transaction: charge.balance_transaction
              })) || []
            }
          };
        } catch (stripeErr) {
          return {
            ...pi,
            stripe_error: stripeErr.message
          };
        }
      })
    );

    success(res, {
      payment_intents: detailedPaymentIntents,
      total: detailedPaymentIntents.length
    });
  } catch (err) {
    return error(res, 'Ошибка при получении PaymentIntent', 500, err);
  }
});

/**
 * GET /api/stripe-admin/payment-intents/:payment_intent_id
 * Получение детальной информации о PaymentIntent
 */
router.get('/payment-intents/:payment_intent_id', async (req, res) => {
  try {
    const { payment_intent_id } = req.params;

    // Получаем из БД
    const [paymentIntents] = await pool.execute(
      'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
      [payment_intent_id]
    );

    if (paymentIntents.length === 0) {
      return error(res, 'PaymentIntent не найден в БД', 404);
    }

    const paymentIntent = paymentIntents[0];

    // Получаем детальную информацию из Stripe
    try {
      const stripePI = await stripe.paymentIntents.retrieve(payment_intent_id, {
        expand: ['charges.data.payment_method', 'charges.data.balance_transaction']
      });

      // Получаем связанные данные из БД
      let requestData = null;
      if (paymentIntent.request_id) {
        const [requests] = await pool.execute(
          'SELECT id, name, category, cost, status FROM requests WHERE id = ?',
          [paymentIntent.request_id]
        );
        requestData = requests[0] || null;
      }

      let userData = null;
      if (paymentIntent.user_id) {
        const [users] = await pool.execute(
          'SELECT id, email, display_name FROM users WHERE id = ?',
          [paymentIntent.user_id]
        );
        userData = users[0] || null;
      }

      success(res, {
        db_data: paymentIntent,
        stripe_data: {
          id: stripePI.id,
          amount: stripePI.amount,
          currency: stripePI.currency,
          status: stripePI.status,
          created: stripePI.created,
          payment_method: stripePI.payment_method,
          payment_method_types: stripePI.payment_method_types,
          capture_method: stripePI.capture_method,
          amount_capturable: stripePI.amount_capturable,
          amount_received: stripePI.amount_received,
          canceled_at: stripePI.canceled_at,
          charges: stripePI.charges?.data?.map(charge => ({
            id: charge.id,
            amount: charge.amount,
            status: charge.status,
            payment_method_details: charge.payment_method_details,
            billing_details: charge.billing_details,
            receipt_url: charge.receipt_url,
            balance_transaction: charge.balance_transaction
          })) || [],
          metadata: stripePI.metadata
        },
        related_data: {
          request: requestData,
          user: userData
        }
      });
    } catch (stripeErr) {
      return error(res, 'Ошибка при получении данных из Stripe', 500, stripeErr);
    }
  } catch (err) {
    return error(res, 'Ошибка при получении PaymentIntent', 500, err);
  }
});

// ============================================================================
// СЕКЦИЯ 2: TRANSFERS (Переводы волонтёрам)
// ============================================================================

/**
 * GET /api/stripe-admin/transfers
 * Получение списка Transfers
 * 
 * Query параметры:
 * - request_id - фильтр по заявке
 * - performer_user_id - фильтр по исполнителю
 * - status - статус (pending, paid, failed, canceled)
 * - limit - количество (по умолчанию 10, максимум 100)
 */
router.get('/transfers', async (req, res) => {
  try {
    const { request_id, performer_user_id, status, limit = 10 } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    let query = 'SELECT * FROM transfers WHERE 1=1';
    const params = [];

    if (request_id) {
      query += ' AND request_id = ?';
      params.push(request_id);
    }
    if (performer_user_id) {
      query += ' AND performer_user_id = ?';
      params.push(performer_user_id);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT ${limitNum}`;

    const [transfers] = await pool.execute(query, params);

    // Получаем детальную информацию из Stripe
    const detailedTransfers = await Promise.all(
      transfers.map(async (transfer) => {
        try {
          const stripeTransfer = await stripe.transfers.retrieve(transfer.transfer_id);

          // Получаем информацию о получателе
          let performerData = null;
          if (transfer.performer_user_id) {
            const [users] = await pool.execute(
              'SELECT id, email, display_name FROM users WHERE id = ?',
              [transfer.performer_user_id]
            );
            performerData = users[0] || null;
          }

          // Получаем информацию о Stripe аккаунте получателя
          let accountData = null;
          if (stripeTransfer.destination) {
            try {
              const account = await stripe.accounts.retrieve(stripeTransfer.destination);
              accountData = {
                id: account.id,
                type: account.type,
                country: account.country,
                charges_enabled: account.charges_enabled,
                payouts_enabled: account.payouts_enabled,
                email: account.email
              };
            } catch (accountErr) {
              accountData = { error: accountErr.message };
            }
          }

          return {
            ...transfer,
            stripe_data: {
              id: stripeTransfer.id,
              amount: stripeTransfer.amount,
              currency: stripeTransfer.currency,
              status: stripeTransfer.status,
              created: stripeTransfer.created,
              destination: stripeTransfer.destination,
              destination_payment: stripeTransfer.destination_payment,
              source_transaction: stripeTransfer.source_transaction,
              reversals: stripeTransfer.reversals,
              metadata: stripeTransfer.metadata
            },
            related_data: {
              performer: performerData,
              destination_account: accountData
            }
          };
        } catch (stripeErr) {
          return {
            ...transfer,
            stripe_error: stripeErr.message
          };
        }
      })
    );

    success(res, {
      transfers: detailedTransfers,
      total: detailedTransfers.length
    });
  } catch (err) {
    return error(res, 'Ошибка при получении Transfers', 500, err);
  }
});

/**
 * GET /api/stripe-admin/transfers/:transfer_id
 * Получение детальной информации о Transfer
 */
router.get('/transfers/:transfer_id', async (req, res) => {
  try {
    const { transfer_id } = req.params;

    // Получаем из БД
    const [transfers] = await pool.execute(
      'SELECT * FROM transfers WHERE transfer_id = ?',
      [transfer_id]
    );

    if (transfers.length === 0) {
      return error(res, 'Transfer не найден в БД', 404);
    }

    const transfer = transfers[0];

    // Получаем детальную информацию из Stripe
    try {
      const stripeTransfer = await stripe.transfers.retrieve(transfer_id);

      // Получаем связанные данные
      let requestData = null;
      if (transfer.request_id) {
        const [requests] = await pool.execute(
          'SELECT id, name, category, cost, status FROM requests WHERE id = ?',
          [transfer.request_id]
        );
        requestData = requests[0] || null;
      }

      let performerData = null;
      if (transfer.performer_user_id) {
        const [users] = await pool.execute(
          'SELECT id, email, display_name FROM users WHERE id = ?',
          [transfer.performer_user_id]
        );
        performerData = users[0] || null;
      }

      let accountData = null;
      if (stripeTransfer.destination) {
        try {
          const account = await stripe.accounts.retrieve(stripeTransfer.destination);
          accountData = {
            id: account.id,
            type: account.type,
            country: account.country,
            charges_enabled: account.charges_enabled,
            payouts_enabled: account.payouts_enabled,
            email: account.email
          };
        } catch (accountErr) {
          accountData = { error: accountErr.message };
        }
      }

      success(res, {
        db_data: transfer,
        stripe_data: {
          id: stripeTransfer.id,
          amount: stripeTransfer.amount,
          currency: stripeTransfer.currency,
          status: stripeTransfer.status,
          created: stripeTransfer.created,
          destination: stripeTransfer.destination,
          destination_payment: stripeTransfer.destination_payment,
          source_transaction: stripeTransfer.source_transaction,
          reversals: stripeTransfer.reversals,
          metadata: stripeTransfer.metadata
        },
        related_data: {
          request: requestData,
          performer: performerData,
          destination_account: accountData
        }
      });
    } catch (stripeErr) {
      return error(res, 'Ошибка при получении данных из Stripe', 500, stripeErr);
    }
  } catch (err) {
    return error(res, 'Ошибка при получении Transfer', 500, err);
  }
});

// ============================================================================
// СЕКЦИЯ 3: ACCOUNTS (Stripe Express аккаунты)
// ============================================================================

/**
 * GET /api/stripe-admin/accounts
 * Получение списка Stripe аккаунтов
 * 
 * Query параметры:
 * - user_id - фильтр по пользователю
 * - charges_enabled - может принимать платежи
 * - payouts_enabled - может получать выплаты
 * - limit - количество (по умолчанию 10, максимум 100)
 */
router.get('/accounts', async (req, res) => {
  try {
    const { user_id, charges_enabled, payouts_enabled, limit = 10 } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    let query = 'SELECT * FROM stripe_accounts WHERE 1=1';
    const params = [];

    if (user_id) {
      query += ' AND user_id = ?';
      params.push(user_id);
    }
    if (charges_enabled !== undefined) {
      query += ' AND charges_enabled = ?';
      params.push(charges_enabled === 'true' ? 1 : 0);
    }
    if (payouts_enabled !== undefined) {
      query += ' AND payouts_enabled = ?';
      params.push(payouts_enabled === 'true' ? 1 : 0);
    }

    query += ` ORDER BY created_at DESC LIMIT ${limitNum}`;

    const [accounts] = await pool.execute(query, params);

    // Получаем детальную информацию из Stripe
    const detailedAccounts = await Promise.all(
      accounts.map(async (account) => {
        try {
          const stripeAccount = await stripe.accounts.retrieve(account.account_id);

          // Получаем информацию о пользователе
          let userData = null;
          if (account.user_id) {
            const [users] = await pool.execute(
              'SELECT id, email, display_name FROM users WHERE id = ?',
              [account.user_id]
            );
            userData = users[0] || null;
          }

          return {
            ...account,
            stripe_data: {
              id: stripeAccount.id,
              type: stripeAccount.type,
              country: stripeAccount.country,
              default_currency: stripeAccount.default_currency,
              created: stripeAccount.created,
              charges_enabled: stripeAccount.charges_enabled,
              payouts_enabled: stripeAccount.payouts_enabled,
              details_submitted: stripeAccount.details_submitted,
              email: stripeAccount.email,
              business_profile: stripeAccount.business_profile,
              business_type: stripeAccount.business_type,
              individual: stripeAccount.individual ? {
                first_name: stripeAccount.individual.first_name,
                last_name: stripeAccount.individual.last_name,
                email: stripeAccount.individual.email,
                phone: stripeAccount.individual.phone
              } : null,
              requirements: stripeAccount.requirements,
              capabilities: stripeAccount.capabilities
            },
            related_data: {
              user: userData
            }
          };
        } catch (stripeErr) {
          return {
            ...account,
            stripe_error: stripeErr.message
          };
        }
      })
    );

    success(res, {
      accounts: detailedAccounts,
      total: detailedAccounts.length
    });
  } catch (err) {
    return error(res, 'Ошибка при получении Accounts', 500, err);
  }
});

/**
 * GET /api/stripe-admin/accounts/:account_id
 * Получение детальной информации о Stripe аккаунте
 */
router.get('/accounts/:account_id', async (req, res) => {
  try {
    const { account_id } = req.params;

    // Получаем из БД
    const [accounts] = await pool.execute(
      'SELECT * FROM stripe_accounts WHERE account_id = ?',
      [account_id]
    );

    if (accounts.length === 0) {
      return error(res, 'Account не найден в БД', 404);
    }

    const account = accounts[0];

    // Получаем детальную информацию из Stripe
    try {
      const stripeAccount = await stripe.accounts.retrieve(account_id);

      // Получаем информацию о пользователе
      let userData = null;
      if (account.user_id) {
        const [users] = await pool.execute(
          'SELECT id, email, display_name, created_time FROM users WHERE id = ?',
          [account.user_id]
        );
        userData = users[0] || null;
      }

      success(res, {
        db_data: account,
        stripe_data: {
          id: stripeAccount.id,
          type: stripeAccount.type,
          country: stripeAccount.country,
          default_currency: stripeAccount.default_currency,
          created: stripeAccount.created,
          charges_enabled: stripeAccount.charges_enabled,
          payouts_enabled: stripeAccount.payouts_enabled,
          details_submitted: stripeAccount.details_submitted,
          email: stripeAccount.email,
          business_profile: stripeAccount.business_profile,
          business_type: stripeAccount.business_type,
          individual: stripeAccount.individual ? {
            first_name: stripeAccount.individual.first_name,
            last_name: stripeAccount.individual.last_name,
            email: stripeAccount.individual.email,
            phone: stripeAccount.individual.phone,
            dob: stripeAccount.individual.dob,
            address: stripeAccount.individual.address
          } : null,
          company: stripeAccount.company || null,
          requirements: stripeAccount.requirements,
          capabilities: stripeAccount.capabilities,
          external_accounts: stripeAccount.external_accounts
        },
        related_data: {
          user: userData
        }
      });
    } catch (stripeErr) {
      return error(res, 'Ошибка при получении данных из Stripe', 500, stripeErr);
    }
  } catch (err) {
    return error(res, 'Ошибка при получении Account', 500, err);
  }
});

// ============================================================================
// СЕКЦИЯ 4: CHARGES (Транзакции)
// ============================================================================

/**
 * GET /api/stripe-admin/charges
 * Получение списка Charges
 * 
 * Query параметры:
 * - payment_intent_id - фильтр по PaymentIntent
 * - limit - количество (по умолчанию 10, максимум 100)
 */
router.get('/charges', async (req, res) => {
  try {
    const { payment_intent_id, limit = 10 } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    let charges = [];

    if (payment_intent_id) {
      // Получаем через PaymentIntent
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id, {
          expand: ['charges.data.payment_method', 'charges.data.balance_transaction']
        });
        charges = paymentIntent.charges?.data || [];
      } catch (stripeErr) {
        return error(res, 'Ошибка при получении Charges из Stripe', 500, stripeErr);
      }
    } else {
      // Получаем последние charges
      try {
        const chargesList = await stripe.charges.list({
          limit: limitNum
        });
        charges = chargesList.data;
      } catch (stripeErr) {
        return error(res, 'Ошибка при получении Charges из Stripe', 500, stripeErr);
      }
    }

    // Получаем связанные данные из БД
    const detailedCharges = await Promise.all(
      charges.map(async (charge) => {
        // Ищем PaymentIntent в БД
        let paymentIntentData = null;
        if (charge.payment_intent) {
          const [paymentIntents] = await pool.execute(
            'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
            [charge.payment_intent]
          );
          paymentIntentData = paymentIntents[0] || null;
        }

        // Получаем информацию о пользователе
        let userData = null;
        if (paymentIntentData?.user_id) {
          const [users] = await pool.execute(
            'SELECT id, email, display_name FROM users WHERE id = ?',
            [paymentIntentData.user_id]
          );
          userData = users[0] || null;
        }

        return {
          stripe_data: {
            id: charge.id,
            amount: charge.amount,
            currency: charge.currency,
            status: charge.status,
            created: charge.created,
            payment_intent: charge.payment_intent,
            payment_method: charge.payment_method,
            payment_method_details: charge.payment_method_details,
            billing_details: charge.billing_details,
            receipt_url: charge.receipt_url,
            receipt_email: charge.receipt_email,
            balance_transaction: charge.balance_transaction
          },
          related_data: {
            payment_intent: paymentIntentData,
            user: userData
          }
        };
      })
    );

    success(res, {
      charges: detailedCharges,
      total: detailedCharges.length
    });
  } catch (err) {
    return error(res, 'Ошибка при получении Charges', 500, err);
  }
});

/**
 * GET /api/stripe-admin/charges/:charge_id
 * Получение детальной информации о Charge
 */
router.get('/charges/:charge_id', async (req, res) => {
  try {
    const { charge_id } = req.params;

    // Получаем из Stripe
    try {
      const charge = await stripe.charges.retrieve(charge_id, {
        expand: ['payment_intent', 'balance_transaction']
      });

      // Получаем связанные данные из БД
      let paymentIntentData = null;
      if (charge.payment_intent) {
        const [paymentIntents] = await pool.execute(
          'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
          [charge.payment_intent]
        );
        paymentIntentData = paymentIntents[0] || null;
      }

      let userData = null;
      let requestData = null;
      if (paymentIntentData) {
        if (paymentIntentData.user_id) {
          const [users] = await pool.execute(
            'SELECT id, email, display_name FROM users WHERE id = ?',
            [paymentIntentData.user_id]
          );
          userData = users[0] || null;
        }

        if (paymentIntentData.request_id) {
          const [requests] = await pool.execute(
            'SELECT id, name, category, cost, status FROM requests WHERE id = ?',
            [paymentIntentData.request_id]
          );
          requestData = requests[0] || null;
        }
      }

      // Получаем информацию о балансной транзакции
      let balanceTransactionData = null;
      if (charge.balance_transaction) {
        try {
          const balanceTransaction = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
          balanceTransactionData = {
            id: balanceTransaction.id,
            amount: balanceTransaction.amount,
            currency: balanceTransaction.currency,
            fee: balanceTransaction.fee,
            net: balanceTransaction.net,
            status: balanceTransaction.status,
            type: balanceTransaction.type,
            fee_details: balanceTransaction.fee_details
          };
        } catch (btErr) {
          balanceTransactionData = { error: btErr.message };
        }
      }

      success(res, {
        stripe_data: {
          id: charge.id,
          amount: charge.amount,
          currency: charge.currency,
          status: charge.status,
          created: charge.created,
          payment_intent: charge.payment_intent,
          payment_method: charge.payment_method,
          payment_method_details: charge.payment_method_details,
          billing_details: charge.billing_details,
          receipt_url: charge.receipt_url,
          receipt_email: charge.receipt_email,
          balance_transaction: charge.balance_transaction
        },
        related_data: {
          payment_intent: paymentIntentData,
          user: userData,
          request: requestData,
          balance_transaction: balanceTransactionData
        }
      });
    } catch (stripeErr) {
      return error(res, 'Ошибка при получении данных из Stripe', 500, stripeErr);
    }
  } catch (err) {
    return error(res, 'Ошибка при получении Charge', 500, err);
  }
});

// ============================================================================
// СЕКЦИЯ 5: BALANCE TRANSACTIONS (Транзакции баланса)
// ============================================================================

/**
 * GET /api/stripe-admin/balance-transactions
 * Получение списка Balance Transactions
 * 
 * Query параметры:
 * - payment_intent_id - фильтр по PaymentIntent (через charge)
 * - type - тип транзакции (charge, payment, payout, refund, etc.)
 * - limit - количество (по умолчанию 10, максимум 100)
 */
router.get('/balance-transactions', async (req, res) => {
  try {
    const { payment_intent_id, type, limit = 10 } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    let balanceTransactions = [];

    if (payment_intent_id) {
      // Получаем через PaymentIntent -> Charge -> Balance Transaction
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id, {
          expand: ['charges.data.balance_transaction']
        });
        
        const charges = paymentIntent.charges?.data || [];
        const balanceTransactionIds = charges
          .map(charge => charge.balance_transaction)
          .filter(Boolean);

        balanceTransactions = await Promise.all(
          balanceTransactionIds.map(id => stripe.balanceTransactions.retrieve(id))
        );
      } catch (stripeErr) {
        return error(res, 'Ошибка при получении Balance Transactions из Stripe', 500, stripeErr);
      }
    } else {
      // Получаем последние транзакции
      try {
        const listParams = { limit: limitNum };
        if (type) {
          listParams.type = type;
        }
        const transactionsList = await stripe.balanceTransactions.list(listParams);
        balanceTransactions = transactionsList.data;
      } catch (stripeErr) {
        return error(res, 'Ошибка при получении Balance Transactions из Stripe', 500, stripeErr);
      }
    }

    // Получаем связанные данные из БД
    const detailedTransactions = await Promise.all(
      balanceTransactions.map(async (bt) => {
        // Пытаемся найти связанный PaymentIntent через source
        let paymentIntentData = null;
        let userData = null;
        let requestData = null;

        if (bt.source) {
          // source может быть charge_id или payment_intent_id
          try {
            // Пробуем получить как charge
            const charge = await stripe.charges.retrieve(bt.source);
            if (charge.payment_intent) {
              const [paymentIntents] = await pool.execute(
                'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
                [charge.payment_intent]
              );
              paymentIntentData = paymentIntents[0] || null;

              if (paymentIntentData) {
                if (paymentIntentData.user_id) {
                  const [users] = await pool.execute(
                    'SELECT id, email, display_name FROM users WHERE id = ?',
                    [paymentIntentData.user_id]
                  );
                  userData = users[0] || null;
                }

                if (paymentIntentData.request_id) {
                  const [requests] = await pool.execute(
                    'SELECT id, name, category FROM requests WHERE id = ?',
                    [paymentIntentData.request_id]
                  );
                  requestData = requests[0] || null;
                }
              }
            }
          } catch (chargeErr) {
            // Если не charge, возможно это payment_intent_id напрямую
            try {
              const [paymentIntents] = await pool.execute(
                'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
                [bt.source]
              );
              paymentIntentData = paymentIntents[0] || null;
            } catch (piErr) {
              // Игнорируем ошибку
            }
          }
        }

        return {
          stripe_data: {
            id: bt.id,
            amount: bt.amount,
            currency: bt.currency,
            fee: bt.fee,
            net: bt.net,
            status: bt.status,
            type: bt.type,
            created: bt.created,
            available_on: bt.available_on,
            fee_details: bt.fee_details,
            source: bt.source
          },
          related_data: {
            payment_intent: paymentIntentData,
            user: userData,
            request: requestData
          }
        };
      })
    );

    success(res, {
      balance_transactions: detailedTransactions,
      total: detailedTransactions.length
    });
  } catch (err) {
    return error(res, 'Ошибка при получении Balance Transactions', 500, err);
  }
});

/**
 * GET /api/stripe-admin/balance-transactions/:transaction_id
 * Получение детальной информации о Balance Transaction
 */
router.get('/balance-transactions/:transaction_id', async (req, res) => {
  try {
    const { transaction_id } = req.params;

    // Получаем из Stripe
    try {
      const balanceTransaction = await stripe.balanceTransactions.retrieve(transaction_id);

      // Получаем связанные данные
      let paymentIntentData = null;
      let userData = null;
      let requestData = null;

      if (balanceTransaction.source) {
        try {
          const charge = await stripe.charges.retrieve(balanceTransaction.source);
          if (charge.payment_intent) {
            const [paymentIntents] = await pool.execute(
              'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
              [charge.payment_intent]
            );
            paymentIntentData = paymentIntents[0] || null;

            if (paymentIntentData) {
              if (paymentIntentData.user_id) {
                const [users] = await pool.execute(
                  'SELECT id, email, display_name FROM users WHERE id = ?',
                  [paymentIntentData.user_id]
                );
                userData = users[0] || null;
              }

              if (paymentIntentData.request_id) {
                const [requests] = await pool.execute(
                  'SELECT id, name, category, cost, status FROM requests WHERE id = ?',
                  [paymentIntentData.request_id]
                );
                requestData = requests[0] || null;
              }
            }
          }
        } catch (chargeErr) {
          // Игнорируем ошибку
        }
      }

      success(res, {
        stripe_data: {
          id: balanceTransaction.id,
          amount: balanceTransaction.amount,
          currency: balanceTransaction.currency,
          fee: balanceTransaction.fee,
          net: balanceTransaction.net,
          status: balanceTransaction.status,
          type: balanceTransaction.type,
          created: balanceTransaction.created,
          available_on: balanceTransaction.available_on,
          fee_details: balanceTransaction.fee_details,
          source: balanceTransaction.source
        },
        related_data: {
          payment_intent: paymentIntentData,
          user: userData,
          request: requestData
        }
      });
    } catch (stripeErr) {
      return error(res, 'Ошибка при получении данных из Stripe', 500, stripeErr);
    }
  } catch (err) {
    return error(res, 'Ошибка при получении Balance Transaction', 500, err);
  }
});

// ============================================================================
// СЕКЦИЯ 6: REFUNDS (Возвраты)
// ============================================================================

/**
 * GET /api/stripe-admin/refunds
 * Получение списка Refunds
 * 
 * Query параметры:
 * - payment_intent_id - фильтр по PaymentIntent
 * - limit - количество (по умолчанию 10, максимум 100)
 */
router.get('/refunds', async (req, res) => {
  try {
    const { payment_intent_id, limit = 10 } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    let refunds = [];

    if (payment_intent_id) {
      // Получаем через PaymentIntent -> Charge -> Refunds
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id, {
          expand: ['charges.data']
        });
        
        const charges = paymentIntent.charges?.data || [];
        const refundsList = await Promise.all(
          charges.map(async (charge) => {
            try {
              const refundsForCharge = await stripe.refunds.list({
                charge: charge.id,
                limit: 100
              });
              return refundsForCharge.data;
            } catch (refundErr) {
              return [];
            }
          })
        );
        refunds = refundsList.flat();
      } catch (stripeErr) {
        return error(res, 'Ошибка при получении Refunds из Stripe', 500, stripeErr);
      }
    } else {
      // Получаем последние refunds
      try {
        const refundsList = await stripe.refunds.list({
          limit: limitNum
        });
        refunds = refundsList.data;
      } catch (stripeErr) {
        return error(res, 'Ошибка при получении Refunds из Stripe', 500, stripeErr);
      }
    }

    // Получаем связанные данные из БД
    const detailedRefunds = await Promise.all(
      refunds.map(async (refund) => {
        // Получаем charge для поиска payment_intent
        let paymentIntentData = null;
        let userData = null;
        let requestData = null;

        if (refund.charge) {
          try {
            const charge = await stripe.charges.retrieve(refund.charge);
            if (charge.payment_intent) {
              const [paymentIntents] = await pool.execute(
                'SELECT * FROM payment_intents WHERE payment_intent_id = ?',
                [charge.payment_intent]
              );
              paymentIntentData = paymentIntents[0] || null;

              if (paymentIntentData) {
                if (paymentIntentData.user_id) {
                  const [users] = await pool.execute(
                    'SELECT id, email, display_name FROM users WHERE id = ?',
                    [paymentIntentData.user_id]
                  );
                  userData = users[0] || null;
                }

                if (paymentIntentData.request_id) {
                  const [requests] = await pool.execute(
                    'SELECT id, name, category FROM requests WHERE id = ?',
                    [paymentIntentData.request_id]
                  );
                  requestData = requests[0] || null;
                }
              }
            }
          } catch (chargeErr) {
            // Игнорируем ошибку
          }
        }

        return {
          stripe_data: {
            id: refund.id,
            amount: refund.amount,
            currency: refund.currency,
            status: refund.status,
            created: refund.created,
            charge: refund.charge,
            payment_intent: refund.payment_intent,
            reason: refund.reason,
            receipt_number: refund.receipt_number,
            balance_transaction: refund.balance_transaction
          },
          related_data: {
            payment_intent: paymentIntentData,
            user: userData,
            request: requestData
          }
        };
      })
    );

    success(res, {
      refunds: detailedRefunds,
      total: detailedRefunds.length
    });
  } catch (err) {
    return error(res, 'Ошибка при получении Refunds', 500, err);
  }
});

// ============================================================================
// СЕКЦИЯ 7: ОБЩАЯ ИНФОРМАЦИЯ
// ============================================================================

/**
 * GET /api/stripe-admin/summary
 * Получение общей статистики по Stripe
 */
router.get('/summary', async (req, res) => {
  try {
    // Получаем статистику из БД
    const [paymentIntentsStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) as succeeded,
        SUM(CASE WHEN status = 'requires_capture' THEN 1 ELSE 0 END) as pending_capture,
        SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) as canceled,
        SUM(CASE WHEN type = 'donation' THEN 1 ELSE 0 END) as donations,
        SUM(CASE WHEN type = 'request_payment' THEN 1 ELSE 0 END) as request_payments
      FROM payment_intents`
    );

    const [transfersStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM transfers`
    );

    const [accountsStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN charges_enabled = 1 AND payouts_enabled = 1 THEN 1 ELSE 0 END) as fully_enabled,
        SUM(CASE WHEN charges_enabled = 1 THEN 1 ELSE 0 END) as charges_enabled_count,
        SUM(CASE WHEN payouts_enabled = 1 THEN 1 ELSE 0 END) as payouts_enabled_count
      FROM stripe_accounts`
    );

    // Получаем баланс из Stripe
    let balance = null;
    try {
      const stripeBalance = await stripe.balance.retrieve();
      balance = {
        available: stripeBalance.available.map(b => ({
          amount: b.amount,
          currency: b.currency
        })),
        pending: stripeBalance.pending.map(b => ({
          amount: b.amount,
          currency: b.currency
        }))
      };
    } catch (balanceErr) {
      balance = { error: balanceErr.message };
    }

    success(res, {
      payment_intents: paymentIntentsStats[0],
      transfers: transfersStats[0],
      accounts: accountsStats[0],
      balance
    });
  } catch (err) {
    return error(res, 'Ошибка при получении статистики', 500, err);
  }
});

// ============================================================================
// СЕКЦИЯ 8: REQUESTS WITH PAYMENTS (Заявки с платежами)
// ============================================================================

/**
 * GET /api/stripe-admin/requests/active
 * Получение активных заявок с донатами/платными
 * 
 * Активные заявки: new, inProgress, pending
 */
router.get('/requests/active', async (req, res) => {
  try {
    // Получаем активные заявки, которые платные или имеют донаты
    const [requests] = await pool.execute(`
      SELECT r.*, 
             u.email as creator_email, u.display_name as creator_name,
             COUNT(d.id) as donations_count,
             COALESCE(SUM(d.amount), 0) as total_donations
      FROM requests r
      LEFT JOIN users u ON r.created_by = u.id
      LEFT JOIN donations d ON r.id = d.request_id
      WHERE r.status IN ('new', 'inProgress', 'pending')
        AND EXISTS(SELECT 1 FROM donations WHERE request_id = r.id)
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `);

    // Получаем ID всех заявок для загрузки донатов одним запросом
    const requestIds = requests.map(r => r.id);
    const [allDonations] = await pool.execute(`
      SELECT d.*, u.email, u.display_name
      FROM donations d
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.request_id IN (${requestIds.map(() => '?').join(',')})
      ORDER BY d.created_at DESC
    `, requestIds);

    // Группируем донаты по заявкам
    const donationsByRequest = {};
    allDonations.forEach(donation => {
      if (!donationsByRequest[donation.request_id]) {
        donationsByRequest[donation.request_id] = [];
      }
      donationsByRequest[donation.request_id].push(donation);
    });

    const detailedRequests = await Promise.all(
      requests.map(async (request) => {
        // ВАЖНО: Теперь все платежи идут через донаты, включая платеж создателя
        // creator_payment больше не используется - все платежи в массиве donations

        // Получаем донаты для текущей заявки из сгруппированных данных
        const requestDonations = donationsByRequest[request.id] || [];

        const detailedDonations = await Promise.all(
          requestDonations.map(async (donation) => {
            let stripeInfo = null;
            if (donation.payment_intent_id) {
              try {
                const stripePI = await stripe.paymentIntents.retrieve(donation.payment_intent_id);
                stripeInfo = {
                  stripe_status: stripePI.status,
                  capture_method: stripePI.capture_method,
                  amount_captured: stripePI.amount_captured / 100,
                  amount_received: stripePI.amount_received / 100,
                  is_captured: stripePI.amount_received > 0
                };
              } catch (stripeErr) {
                stripeInfo = { stripe_error: stripeErr.message };
              }
            }

            return {
              user_id: donation.user_id,
              email: donation.email,
              name: donation.display_name,
              amount: donation.amount,
              payment_intent_id: donation.payment_intent_id,
              ...stripeInfo
            };
          })
        );

        return {
          id: request.id,
          name: request.name,
          category: request.category,
          status: request.status,
          created_at: request.created_at,
          updated_at: request.updated_at,
          donations: detailedDonations,
          donations_count: request.donations_count,
          total_donations: request.total_donations
        };
      })
    );

    success(res, {
      requests: detailedRequests,
      total: detailedRequests.length
    });
  } catch (err) {
    return error(res, 'Ошибка при получении активных заявок', 500, err);
  }
});

/**
 * GET /api/stripe-admin/requests/closed
 * Получение закрытых/архивных заявок с донатами/платными
 * 
 * Закрытые заявки: approved, rejected, completed
 */
router.get('/requests/closed', async (req, res) => {
  try {
    // Получаем закрытые заявки, которые платные или имеют донаты
    const [requests] = await pool.execute(`
      SELECT r.*, 
             u.email as creator_email, u.display_name as creator_name,
             COUNT(d.id) as donations_count,
             COALESCE(SUM(d.amount), 0) as total_donations
      FROM requests r
      LEFT JOIN users u ON r.created_by = u.id
      LEFT JOIN donations d ON r.id = d.request_id
      WHERE r.status IN ('approved', 'rejected', 'completed')
        AND EXISTS(SELECT 1 FROM donations WHERE request_id = r.id)
      GROUP BY r.id
      ORDER BY r.updated_at DESC
    `);

    // Получаем ID всех заявок для загрузки донатов одним запросом
    const requestIds = requests.map(r => r.id);
    const [allDonations] = await pool.execute(`
      SELECT d.*, u.email, u.display_name
      FROM donations d
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.request_id IN (${requestIds.map(() => '?').join(',')})
      ORDER BY d.created_at DESC
    `, requestIds);

    // Группируем донаты по заявкам
    const donationsByRequest = {};
    allDonations.forEach(donation => {
      if (!donationsByRequest[donation.request_id]) {
        donationsByRequest[donation.request_id] = [];
      }
      donationsByRequest[donation.request_id].push(donation);
    });

    const detailedRequests = await Promise.all(
      requests.map(async (request) => {
        // ВАЖНО: Теперь все платежи идут через донаты, включая платеж создателя
        // creator_payment больше не используется - все платежи в массиве donations

        // Получаем донаты для текущей заявки из сгруппированных данных
        const requestDonations = donationsByRequest[request.id] || [];

        const detailedDonations = await Promise.all(
          requestDonations.map(async (donation) => {
            let stripeInfo = null;
            if (donation.payment_intent_id) {
              try {
                const stripePI = await stripe.paymentIntents.retrieve(donation.payment_intent_id);
                stripeInfo = {
                  stripe_status: stripePI.status,
                  capture_method: stripePI.capture_method,
                  amount_captured: stripePI.amount_captured / 100,
                  amount_received: stripePI.amount_received / 100,
                  is_captured: stripePI.amount_received > 0
                };
              } catch (stripeErr) {
                stripeInfo = { stripe_error: stripeErr.message };
              }
            }

            return {
              user_id: donation.user_id,
              email: donation.email,
              name: donation.display_name,
              amount: donation.amount,
              payment_intent_id: donation.payment_intent_id,
              ...stripeInfo
            };
          })
        );

        // Получаем информацию о переводах (только для закрытых заявок)
        let transfers = [];
        try {
          const stripeTransfers = await stripe.transfers.list({
            transfer_group: `request_${request.id}`,
            limit: 10
          });
          
          transfers = stripeTransfers.data.map(transfer => ({
            to_user_id: transfer.metadata?.user_id || 'unknown',
            amount: transfer.amount / 100,
            transfer_id: transfer.id,
            status: transfer.status,
            created: transfer.created,
            error: transfer.failure_message || null
          }));
        } catch (transferErr) {
          // Игнорируем ошибки получения переводов
        }

        // Считаем остаток по заявке
        let requestBalance = 0;
        const totalCaptured = detailedDonations.reduce((sum, d) => sum + (d.amount_received || 0), 0);
        const totalTransferred = transfers.reduce((sum, t) => sum + t.amount, 0);
        requestBalance = totalCaptured - totalTransferred;

        return {
          id: request.id,
          name: request.name,
          category: request.category,
          status: request.status,
          created_at: request.created_at,
          updated_at: request.updated_at,
          donations: detailedDonations,
          donations_count: request.donations_count,
          total_donations: request.total_donations,
          transfers: transfers,
          request_balance: requestBalance,
          total_captured: totalCaptured,
          total_transferred: totalTransferred
        };
      })
    );

    success(res, {
      requests: detailedRequests,
      total: detailedRequests.length
    });
  } catch (err) {
    return error(res, 'Ошибка при получении закрытых заявок', 500, err);
  }
});

// ============================================================================
// СЕКЦИЯ: СОЗДАНИЕ TRANSFER ВРУЧНУЮ
// ============================================================================

/**
 * POST /api/stripe-admin/create-transfer
 * Создание Transfer вручную для заявки
 * 
 * Используется когда:
 * - Transfer не создался автоматически при одобрении заявки
 * - Нужно создать Transfer для старых заявок
 * - Нужно повторить неудачный Transfer
 */
router.post('/create-transfer', [
  body('request_id').notEmpty().withMessage('request_id is required'),
  body('performer_user_id').notEmpty().withMessage('performer_user_id is required'),
  body('amount_cents').optional().isInt({ min: 1 }).withMessage('amount_cents must be positive integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Validation error', 400, errors.array());
    }

    const { request_id, performer_user_id, amount_cents } = req.body;

    // Получаем заявку
    const [requests] = await pool.execute(
      'SELECT id, category, name, created_by FROM requests WHERE id = ?',
      [request_id]
    );

    if (requests.length === 0) {
      return error(res, 'Request not found', 404);
    }

    const request = requests[0];

    // Получаем все донаты для заявки
    const [donations] = await pool.execute(
      `SELECT d.*, pi.payment_intent_id, pi.status as payment_status
       FROM donations d
       LEFT JOIN payment_intents pi ON d.payment_intent_id = pi.payment_intent_id
       WHERE d.request_id = ? AND pi.status = 'succeeded'`,
      [request_id]
    );

    if (donations.length === 0) {
      return error(res, 'No successful donations found for this request', 400);
    }

    // Рассчитываем сумму
    const totalAmountCents = donations.reduce((sum, d) => sum + Math.round(parseFloat(d.amount) * 100), 0);
    
    // Комиссия платформы: 7%
    const platformFeeCents = Math.round(totalAmountCents * 0.07);
    
    // Комиссия Stripe: 2.9% + $0.30 за транзакцию
    const stripeFeeCents = Math.round(totalAmountCents * 0.029) + (donations.length * 30);
    
    // Сумма для Transfer (можно переопределить вручную)
    const transferAmountCents = amount_cents || (totalAmountCents - platformFeeCents - stripeFeeCents);

    if (transferAmountCents <= 0) {
      return error(res, 'Transfer amount must be positive', 400);
    }

    // Проверяем, не создан ли уже Transfer для этой заявки
    const [existingTransfers] = await pool.execute(
      'SELECT * FROM transfers WHERE request_id = ? AND performer_user_id = ?',
      [request_id, performer_user_id]
    );

    if (existingTransfers.length > 0) {
      return error(res, 'Transfer already exists for this request and performer', 400, {
        existing_transfer: existingTransfers[0]
      });
    }

    // Получаем stripe_account_id исполнителя
    const [stripeAccounts] = await pool.execute(
      'SELECT account_id FROM stripe_accounts WHERE user_id = ?',
      [performer_user_id]
    );

    if (stripeAccounts.length === 0) {
      return error(res, 'Performer Stripe account not found', 404);
    }

    const stripeAccountId = stripeAccounts[0].account_id;

    // Получаем первый PaymentIntent для source_transaction
    const [paymentIntents] = await pool.execute(
      `SELECT payment_intent_id FROM donations d
       JOIN payment_intents pi ON d.payment_intent_id = pi.payment_intent_id
       WHERE d.request_id = ? AND pi.status = 'succeeded'
       LIMIT 1`,
      [request_id]
    );

    // Создаем Transfer в Stripe
    let transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: transferAmountCents,
        currency: 'usd',
        destination: stripeAccountId,
        source_transaction: paymentIntents[0]?.payment_intent_id || undefined,
        metadata: {
          request_id: request_id,
          performer_user_id: performer_user_id,
          created_by: 'admin_manual'
        }
      });
    } catch (transferErr) {
      return error(res, 'Error creating transfer in Stripe', 500, {
        ...transferErr,
        errorDetails: {
          errorMessage: transferErr.message,
          errorType: transferErr.type,
          errorCode: transferErr.code,
          stripeAccountId: stripeAccountId,
          transferAmountCents: transferAmountCents
        }
      });
    }

    // Сохраняем transfer в базу данных
    const transferId = generateId();
    await pool.execute(
      `INSERT INTO transfers (id, transfer_id, request_id, performer_user_id, amount_cents, platform_fee_cents, stripe_fee_cents, currency, status, source_payment_intent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transferId,
        transfer.id,
        request_id,
        performer_user_id,
        transferAmountCents,
        platformFeeCents,
        stripeFeeCents,
        'usd',
        'pending',
        paymentIntents[0]?.payment_intent_id || null
      ]
    );

    // Получаем детальную информацию о Transfer из Stripe
    const stripeTransfer = await stripe.transfers.retrieve(transfer.id);

    return success(res, {
      transfer: {
        id: transferId,
        transfer_id: transfer.id,
        request_id: request_id,
        performer_user_id: performer_user_id,
        amount_cents: transferAmountCents,
        amount_dollars: (transferAmountCents / 100).toFixed(2),
        platform_fee_cents: platformFeeCents,
        platform_fee_dollars: (platformFeeCents / 100).toFixed(2),
        stripe_fee_cents: stripeFeeCents,
        stripe_fee_dollars: (stripeFeeCents / 100).toFixed(2),
        currency: 'usd',
        status: stripeTransfer.status,
        created: stripeTransfer.created,
        stripe_data: {
          destination: stripeTransfer.destination,
          source_transaction: stripeTransfer.source_transaction,
          metadata: stripeTransfer.metadata
        }
      },
      request_info: {
        id: request.id,
        category: request.category,
        name: request.name
      },
      calculations: {
        total_donations_cents: totalAmountCents,
        total_donations_dollars: (totalAmountCents / 100).toFixed(2),
        donations_count: donations.length
      }
    }, 'Transfer created successfully');

  } catch (err) {
    return error(res, 'Error creating transfer', 500, err);
  }
});

module.exports = router;
