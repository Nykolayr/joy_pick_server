const express = require('express');
const crypto = require('crypto');
const { body, param, query, validationResult } = require('express-validator');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { SUPPORTED_LOCALES } = require('../services/translateNews');
const {
  STATUSES,
  listTickets,
  getTicketById,
  createTicket,
  updateDraftTicket,
  submitForReview,
  reopenTicket,
  deleteDraftTicket,
  listAgentQueue,
  agentCompleteTicket
} = require('../services/supportAiReviewService');

const router = express.Router();

function timingSafeReviewAgentSecret(provided, expected) {
  if (!provided || !expected || typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function reviewAgentSecretMiddleware(req, res, next) {
  const expectedSecret = String(process.env.SUPPORT_REVIEW_AGENT_SECRET || '').trim();
  if (!expectedSecret) {
    return error(res, 'Not found', 404);
  }
  const provided = String(req.get('X-Support-Review-Agent-Secret') || '').trim();
  if (!timingSafeReviewAgentSecret(provided, expectedSecret)) {
    return error(res, 'Forbidden', 403);
  }
  return next();
}

function handleServiceError(res, err) {
  const status = err.statusCode || 500;
  if (status >= 500) {
    return error(res, err.message || 'Internal error', status, err);
  }
  return error(res, err.message || 'Bad request', status);
}

/**
 * GET /api/admin/support-ai-reviews/agent-queue
 * Очередь pending_review для агента (Cursor). Секрет: X-Support-Review-Agent-Secret.
 */
router.get('/agent-queue', reviewAgentSecretMiddleware, async (req, res) => {
  try {
    const items = await listAgentQueue();
    return success(res, { items, count: items.length }, 'Support AI review agent queue');
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/admin/support-ai-reviews/:id/agent-complete
 * Запись answer_after_fix после verify на проде.
 */
router.patch(
  '/:id/agent-complete',
  reviewAgentSecretMiddleware,
  [
    param('id').isUUID().withMessage('id must be UUID'),
    body('answer_after_fix').isString().trim().isLength({ min: 1, max: 16000 }),
    body('sources_after_fix').optional().isArray(),
    body('fix_notes').optional().isString().trim().isLength({ max: 4000 }),
    body('model').optional().isString().trim().isLength({ max: 128 })
  ],
  async (req, res) => {
    try {
      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return error(res, 'Validation error', 400, validationErrors.array());
      }
      const data = await agentCompleteTicket(req.params.id, req.body);
      return success(res, data, 'Support AI review ticket completed');
    } catch (err) {
      return handleServiceError(res, err);
    }
  }
);

router.use(authenticate);
router.use(requireAdmin);

/**
 * GET /api/admin/support-ai-reviews
 */
router.get(
  '/',
  [
    query('status').optional().isString().trim().isIn(STATUSES),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('offset').optional().isInt({ min: 0 })
  ],
  async (req, res) => {
    try {
      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return error(res, 'Validation error', 400, validationErrors.array());
      }
      const data = await listTickets({
        status: req.query.status,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return success(res, data, 'Support AI review tickets');
    } catch (err) {
      return handleServiceError(res, err);
    }
  }
);

/**
 * GET /api/admin/support-ai-reviews/:id
 */
router.get('/:id', [param('id').isUUID()], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }
    const data = await getTicketById(req.params.id);
    if (!data) {
      return error(res, 'Ticket not found', 404);
    }
    return success(res, data, 'Support AI review ticket');
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * POST /api/admin/support-ai-reviews
 */
router.post(
  '/',
  [
    body('question').isString().trim().isLength({ min: 1, max: 2000 }),
    body('ai_answer').isString().trim().isLength({ min: 1, max: 16000 }),
    body('ai_sources').optional().isArray(),
    body('locale').optional().isString().trim().isIn(SUPPORTED_LOCALES),
    body('model').optional().isString().trim().isLength({ max: 128 })
  ],
  async (req, res) => {
    try {
      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return error(res, 'Validation error', 400, validationErrors.array());
      }
      const data = await createTicket(req.user.userId, req.body);
      return success(res, data, 'Support AI review ticket created', 201);
    } catch (err) {
      return handleServiceError(res, err);
    }
  }
);

/**
 * PATCH /api/admin/support-ai-reviews/:id — только draft
 */
router.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('question').optional().isString().trim().isLength({ min: 1, max: 2000 }),
    body('ai_answer').optional().isString().trim().isLength({ min: 1, max: 16000 }),
    body('ai_sources').optional().isArray(),
    body('locale').optional().isString().trim().isIn(SUPPORTED_LOCALES),
    body('model').optional().isString().trim().isLength({ max: 128 })
  ],
  async (req, res) => {
    try {
      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return error(res, 'Validation error', 400, validationErrors.array());
      }
      const data = await updateDraftTicket(req.params.id, req.user.userId, req.body);
      return success(res, data, 'Support AI review ticket updated');
    } catch (err) {
      return handleServiceError(res, err);
    }
  }
);

/**
 * POST /api/admin/support-ai-reviews/:id/submit
 */
router.post(
  '/:id/submit',
  [
    param('id').isUUID(),
    body('admin_remark').isString().trim().isLength({ min: 1, max: 8000 })
  ],
  async (req, res) => {
    try {
      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return error(res, 'Validation error', 400, validationErrors.array());
      }
      const data = await submitForReview(req.params.id, req.user.userId, req.body.admin_remark);
      return success(res, data, 'Support AI review ticket submitted');
    } catch (err) {
      return handleServiceError(res, err);
    }
  }
);

/**
 * POST /api/admin/support-ai-reviews/:id/reopen
 */
router.post(
  '/:id/reopen',
  [
    param('id').isUUID(),
    body('admin_remark').isString().trim().isLength({ min: 1, max: 8000 }),
    body('question').optional().isString().trim().isLength({ min: 1, max: 2000 })
  ],
  async (req, res) => {
    try {
      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return error(res, 'Validation error', 400, validationErrors.array());
      }
      const data = await reopenTicket(req.params.id, req.user.userId, req.body);
      return success(res, data, 'Support AI review ticket reopened');
    } catch (err) {
      return handleServiceError(res, err);
    }
  }
);

/**
 * DELETE /api/admin/support-ai-reviews/:id — только draft
 */
router.delete('/:id', [param('id').isUUID()], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }
    const data = await deleteDraftTicket(req.params.id);
    return success(res, data, 'Support AI review ticket deleted');
  } catch (err) {
    return handleServiceError(res, err);
  }
});

module.exports = router;
