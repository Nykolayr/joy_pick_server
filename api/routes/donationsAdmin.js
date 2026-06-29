const express = require('express');
const pool = require('../config/database');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

function parsePositiveInt(value, fallback, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, n);
}

function parseNonNegativeInt(value, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * GET /api/admin/donations
 * Список донатов с фильтрами rail_code, provider, request_id, user_id
 */
router.get('/', async (req, res) => {
  try {
    const {
      rail_code,
      provider,
      request_id,
      user_id,
      page = 1,
      limit = 50,
    } = req.query;

    const safeLimit = parsePositiveInt(limit, 50, 200);
    const safeOffset = parseNonNegativeInt(
      (parsePositiveInt(page, 1, 100000) - 1) * safeLimit,
      0
    );

    const where = [];
    const params = [];

    if (rail_code) {
      where.push('d.rail_code = ?');
      params.push(String(rail_code).trim().toUpperCase());
    }
    if (provider) {
      where.push('d.provider = ?');
      params.push(String(provider).trim().toLowerCase());
    }
    if (request_id) {
      where.push('d.request_id = ?');
      params.push(String(request_id).trim());
    }
    if (user_id) {
      where.push('d.user_id = ?');
      params.push(String(user_id).trim());
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT d.id, d.request_id, d.user_id, d.amount, d.payment_intent_id,
              d.provider, d.rail_code, d.created_at,
              r.name AS request_name, r.category AS request_category, r.status AS request_status,
              u.display_name AS donor_display_name, u.email AS donor_email
       FROM donations d
       LEFT JOIN requests r ON r.id = d.request_id
       LEFT JOIN users u ON u.id = d.user_id
       ${whereSql}
       ORDER BY d.created_at DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM donations d ${whereSql}`,
      params
    );

    success(res, {
      donations: rows,
      pagination: {
        page: parsePositiveInt(page, 1, 100000),
        limit: safeLimit,
        total: Number(countRows[0]?.total || 0),
      },
    });
  } catch (err) {
    console.error('admin donations list:', err);
    error(res, 'Error fetching donations', 500, err);
  }
});

/**
 * GET /api/admin/donations/summary
 * Агрегаты по рельсам и провайдерам
 */
router.get('/summary', async (req, res) => {
  try {
    const [byRail] = await pool.execute(
      `SELECT rail_code, provider,
              COUNT(*) AS donations_count,
              COALESCE(SUM(amount), 0) AS total_amount
       FROM donations
       GROUP BY rail_code, provider
       ORDER BY rail_code, provider`
    );

    const [totals] = await pool.execute(
      `SELECT COUNT(*) AS donations_count,
              COALESCE(SUM(amount), 0) AS total_amount
       FROM donations`
    );

    const [payoutProfiles] = await pool.execute(
      `SELECT
         COALESCE(payout_rail, 'unset') AS payout_rail,
         COUNT(*) AS users_count,
         SUM(CASE WHEN manual_payout_details IS NOT NULL THEN 1 ELSE 0 END) AS with_manual_details,
         SUM(CASE WHEN can_receive_payouts = 1 THEN 1 ELSE 0 END) AS can_receive_payouts_count
       FROM users
       GROUP BY COALESCE(payout_rail, 'unset')
       ORDER BY users_count DESC`
    );

    const [recentBlockedEstimate] = await pool.execute(
      `SELECT COUNT(*) AS requests_without_stripe_executor
       FROM requests r
       WHERE r.status NOT IN ('archived', 'rejected', 'cancelled')
         AND r.category IN ('wasteLocation', 'speedCleanup')
         AND r.joined_user_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM users u
           INNER JOIN stripe_accounts sa ON sa.user_id = u.id
           WHERE u.id = r.joined_user_id AND u.can_receive_payouts = 1
         )`
    );

    success(res, {
      totals: {
        donations_count: Number(totals[0]?.donations_count || 0),
        total_amount: Number(totals[0]?.total_amount || 0),
      },
      by_rail: byRail.map((row) => ({
        rail_code: row.rail_code,
        provider: row.provider,
        donations_count: Number(row.donations_count),
        total_amount: Number(row.total_amount),
      })),
      payout_profiles: payoutProfiles.map((row) => ({
        payout_rail: row.payout_rail,
        users_count: Number(row.users_count),
        with_manual_details: Number(row.with_manual_details),
        can_receive_payouts_count: Number(row.can_receive_payouts_count),
      })),
      hints: {
        active_requests_executor_no_stripe: Number(
          recentBlockedEstimate[0]?.requests_without_stripe_executor || 0
        ),
      },
    });
  } catch (err) {
    console.error('admin donations summary:', err);
    error(res, 'Error fetching donations summary', 500, err);
  }
});

/**
 * GET /api/admin/donations/payout-profiles
 * Список пользователей с настройками выплат (для админки)
 */
router.get('/payout-profiles', async (req, res) => {
  try {
    const { payout_rail, page = 1, limit = 50, search = '' } = req.query;
    const safeLimit = parsePositiveInt(limit, 50, 200);
    const safeOffset = parseNonNegativeInt(
      (parsePositiveInt(page, 1, 100000) - 1) * safeLimit,
      0
    );

    const where = [];
    const params = [];

    if (payout_rail) {
      if (String(payout_rail).toLowerCase() === 'unset') {
        where.push('u.payout_rail IS NULL');
      } else {
        where.push('u.payout_rail = ?');
        params.push(String(payout_rail).trim().toLowerCase());
      }
    }

    if (search) {
      where.push('(u.email LIKE ? OR u.display_name LIKE ? OR u.id = ?)');
      const pattern = `%${String(search).trim()}%`;
      params.push(pattern, pattern, String(search).trim());
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.display_name, u.country,
              u.payout_rail, u.manual_payout_verified_at,
              u.stripe_account_status, u.can_receive_payouts,
              (u.manual_payout_details IS NOT NULL) AS has_manual_payout_details,
              (SELECT COUNT(*) FROM stripe_accounts sa WHERE sa.user_id = u.id) > 0 AS has_stripe_account
       FROM users u
       ${whereSql}
       ORDER BY u.updated_at DESC, u.created_time DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
      params
    );

    success(res, {
      profiles: rows,
      pagination: {
        page: parsePositiveInt(page, 1, 100000),
        limit: safeLimit,
        total: Number(countRows[0]?.total || 0),
      },
    });
  } catch (err) {
    console.error('admin payout profiles:', err);
    error(res, 'Error fetching payout profiles', 500, err);
  }
});

module.exports = router;
