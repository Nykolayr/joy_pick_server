const express = require('express');
const { body, validationResult } = require('express-validator');
const { success, error } = require('../utils/response');
const { authenticate, requireAdmin } = require('../middleware/auth');
const requestModerationService = require('../services/requestModerationService');

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

function mapServiceError(res, err) {
  if (err.code === 'NOT_FOUND') return error(res, err.message, 404);
  if (err.code === 'INVALID_STATUS' || err.code === 'INVALID_ACTION' || err.code === 'NO_PROPOSAL') {
    return error(res, err.message, 400);
  }
  if (err.code === 'PROPOSAL_EXISTS') return error(res, err.message, 409);
  return error(res, err.message || 'Moderation error', 500, err);
}

/**
 * GET /api/admin/requests/moderation-queue
 */
router.get('/moderation-queue', async (req, res) => {
  try {
    const data = await requestModerationService.listModerationQueue(req.query);
    success(res, data);
  } catch (err) {
    mapServiceError(res, err);
  }
});

/**
 * GET /api/admin/requests/:id/moderation
 */
router.get('/:id/moderation', async (req, res) => {
  try {
    const data = await requestModerationService.getModerationDetail(req.params.id);
    success(res, data);
  } catch (err) {
    mapServiceError(res, err);
  }
});

/**
 * POST /api/admin/requests/:id/moderation/confirm-proposed
 */
router.post('/:id/moderation/confirm-proposed', async (req, res) => {
  try {
    const result = await requestModerationService.confirmProposedModeration(
      req.params.id,
      req.user.userId
    );
    success(res, result, 'Proposed moderation confirmed');
  } catch (err) {
    mapServiceError(res, err);
  }
});

/**
 * POST /api/admin/requests/:id/moderation/cancel-proposed
 */
router.post('/:id/moderation/cancel-proposed', async (req, res) => {
  try {
    const result = await requestModerationService.cancelProposedModeration(
      req.params.id,
      req.user.userId
    );
    success(res, result, 'Proposed moderation cancelled');
  } catch (err) {
    mapServiceError(res, err);
  }
});

/**
 * POST /api/admin/requests/:id/moderation/approve
 */
router.post(
  '/:id/moderation/approve',
  async (req, res) => {
    try {
      const result = await requestModerationService.finalizeModeration(req.params.id, {
        action: 'approve',
        source: 'manual',
        adminUserId: req.user.userId,
      });
      success(res, result, 'Request approved');
    } catch (err) {
      mapServiceError(res, err);
    }
  }
);

/**
 * POST /api/admin/requests/:id/moderation/reject
 */
router.post(
  '/:id/moderation/reject',
  [
    body('rejection_reason').optional().isString(),
    body('rejection_message').optional().isString(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'Validation error', 400, errors.array());
      }
      const result = await requestModerationService.finalizeModeration(req.params.id, {
        action: 'reject',
        source: 'manual',
        adminUserId: req.user.userId,
        rejectionReason: req.body.rejection_reason,
        rejectionMessage: req.body.rejection_message,
      });
      success(res, result, 'Request rejected');
    } catch (err) {
      mapServiceError(res, err);
    }
  }
);

module.exports = router;
