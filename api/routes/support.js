const express = require('express');
const crypto = require('crypto');
const { body, param, validationResult } = require('express-validator');
const { success, error } = require('../utils/response');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const { SUPPORTED_LOCALES } = require('../services/translateNews');
const { getSupportAiAnswer } = require('../services/supportAiService');
const { guestKeyFromRequest } = require('../utils/supportGuestKey');
const {
  createPendingSupportMessage,
  completePendingSupportMessage,
  failPendingSupportMessage,
  getSupportMessageById,
  listRecentSupportConversationContext,
  listSupportMessages,
  countSupportMessages,
  clearSupportMessages
} = require('../services/supportAiHistory');
const {
  createPendingGuestSupportMessage,
  completePendingGuestSupportMessage,
  failPendingGuestSupportMessage,
  getGuestSupportMessageById,
  listRecentGuestConversationContext,
  listGuestSupportMessages,
  countGuestSupportMessages,
  clearGuestSupportMessages
} = require('../services/supportAiGuestHistory');

const router = express.Router();

function timingSafeEvalSecret(provided, expected) {
  if (!provided || !expected || typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function processSupportMessageAsync(ctx) {
  const { messageId, message, locale, mode, userId, guestKey } = ctx;
  Promise.resolve()
    .then(async () => {
      const conversationContext =
        mode === 'guest'
          ? await listRecentGuestConversationContext(guestKey, {
              limit: Number(process.env.AI_SUPPORT_CONTEXT_TURNS || 8),
              excludeMessageId: messageId
            })
          : await listRecentSupportConversationContext(userId, {
              limit: Number(process.env.AI_SUPPORT_CONTEXT_TURNS || 8),
              excludeMessageId: messageId
            });
      const data = await getSupportAiAnswer({ message, locale, conversationContext });
      if (mode === 'guest') {
        await completePendingGuestSupportMessage(messageId, guestKey, {
          answer: data.answer,
          answerEn: data.answer_en,
          locale: data.locale,
          model: data.model,
          sources: data.sources,
          translationFallback: data.translation_fallback
        });
      } else {
        await completePendingSupportMessage(messageId, userId, {
          answer: data.answer,
          answerEn: data.answer_en,
          locale: data.locale,
          model: data.model,
          sources: data.sources,
          translationFallback: data.translation_fallback
        });
      }
    })
    .catch(async (err) => {
      const reason = err?.message || String(err) || 'ai_generation_failed';
      try {
        if (mode === 'guest') {
          await failPendingGuestSupportMessage(messageId, guestKey, reason);
        } else {
          await failPendingSupportMessage(messageId, userId, reason);
        }
      } catch {
        // intentionally ignore
      }
    });
}

/**
 * POST /api/support/eval-reply
 * Синхронный ответ Support AI для проверки качества (скрипты, Cursor). Только если задан SUPPORT_EVAL_SECRET в .env.
 * Заголовок: X-Support-Eval-Secret (тот же секрет). Без записи в БД истории.
 */
router.post(
  '/eval-reply',
  [
    body('message')
      .isString()
      .trim()
      .isLength({ min: 1, max: 2000 })
      .withMessage('message must be 1-2000 chars'),
    body('locale')
      .optional()
      .isString()
      .trim()
      .isIn(SUPPORTED_LOCALES)
      .withMessage(`locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`)
  ],
  async (req, res) => {
    try {
      const expectedSecret = String(process.env.SUPPORT_EVAL_SECRET || '').trim();
      if (!expectedSecret) {
        return error(res, 'Not found', 404);
      }
      const provided = String(req.get('X-Support-Eval-Secret') || '').trim();
      if (!timingSafeEvalSecret(provided, expectedSecret)) {
        return error(res, 'Forbidden', 403);
      }

      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return error(res, 'Validation error', 400, validationErrors.array());
      }

      const message = String(req.body.message || '').trim();
      const locale = String(req.body.locale || 'en').trim();
      const data = await getSupportAiAnswer({ message, locale, conversationContext: [] });
      return success(res, data, 'Support AI eval reply');
    } catch (err) {
      return error(res, 'Support AI eval failed', 500, err);
    }
  }
);

router.post(
  '/chat',
  [
    optionalAuthenticate,
    body('message')
      .isString()
      .trim()
      .isLength({ min: 1, max: 2000 })
      .withMessage('message must be 1-2000 chars'),
    body('locale')
      .optional()
      .isString()
      .trim()
      .isIn(SUPPORTED_LOCALES)
      .withMessage(`locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`)
  ],
  async (req, res) => {
    try {
      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return error(res, 'Validation error', 400, validationErrors.array());
      }

      const message = String(req.body.message || '').trim();
      const locale = String(req.body.locale || 'en').trim();
      const guestKey = guestKeyFromRequest(req);

      if (req.user && req.user.userId) {
        const userId = req.user.userId;
        const messageId = await createPendingSupportMessage({
          userId,
          userMessage: message,
          locale
        });
        processSupportMessageAsync({
          mode: 'user',
          messageId,
          userId,
          message,
          locale
        });
        return success(
          res,
          { message_id: messageId, status: 'accepted' },
          'Support AI request accepted'
        );
      }

      if (guestKey) {
        const messageId = await createPendingGuestSupportMessage({
          guestKey,
          userMessage: message,
          locale
        });
        processSupportMessageAsync({
          mode: 'guest',
          messageId,
          guestKey,
          message,
          locale
        });
        return success(
          res,
          { message_id: messageId, status: 'accepted' },
          'Support AI request accepted'
        );
      }

      return error(
        res,
        'Sign in with Bearer token or send header X-Support-Guest-Id (UUID v4)',
        401
      );
    } catch (err) {
      return error(res, 'Failed to accept support AI request', 500, err);
    }
  }
);

/**
 * GET /api/support/chat/messages/:messageId
 */
router.get(
  '/chat/messages/:messageId',
  [
    optionalAuthenticate,
    param('messageId')
      .isString()
      .trim()
      .isLength({ min: 8, max: 64 })
      .withMessage('messageId is invalid')
  ],
  async (req, res) => {
    try {
      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return error(res, 'Validation error', 400, validationErrors.array());
      }

      const messageId = String(req.params.messageId || '').trim();
      const guestKey = guestKeyFromRequest(req);

      if (req.user && req.user.userId) {
        const item = await getSupportMessageById(req.user.userId, messageId);
        if (!item) {
          return error(res, 'Support AI message not found', 404);
        }
        return success(res, item, 'Support AI message status');
      }

      if (guestKey) {
        const item = await getGuestSupportMessageById(guestKey, messageId);
        if (!item) {
          return error(res, 'Support AI message not found', 404);
        }
        return success(res, item, 'Support AI message status');
      }

      return error(res, 'Authorization or X-Support-Guest-Id required', 401);
    } catch (err) {
      return error(res, 'Failed to load support AI message status', 500, err);
    }
  }
);

/**
 * GET /api/support/chat/history
 * JWT или X-Support-Guest-Id; без обоих — пустая история.
 */
router.get(
  '/chat/history',
  [optionalAuthenticate],
  async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
      const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
      const guestKey = guestKeyFromRequest(req);

      if (req.user && req.user.userId) {
        const userId = req.user.userId;
        const [items, total] = await Promise.all([
          listSupportMessages(userId, { limit, offset }),
          countSupportMessages(userId)
        ]);
        return success(res, { items, total, limit, offset }, 'Support AI history');
      }

      if (guestKey) {
        const [items, total] = await Promise.all([
          listGuestSupportMessages(guestKey, { limit, offset }),
          countGuestSupportMessages(guestKey)
        ]);
        return success(res, { items, total, limit, offset }, 'Support AI history');
      }

      return success(res, { items: [], total: 0, limit, offset }, 'Support AI history');
    } catch (err) {
      return error(res, 'Failed to load support AI history', 500, err);
    }
  }
);

/**
 * DELETE /api/support/chat/history
 * JWT или X-Support-Guest-Id
 */
router.delete(
  '/chat/history',
  [optionalAuthenticate],
  async (req, res) => {
    try {
      const guestKey = guestKeyFromRequest(req);

      if (req.user && req.user.userId) {
        const deleted = await clearSupportMessages(req.user.userId);
        return success(res, { deleted }, 'Support AI history cleared');
      }

      if (guestKey) {
        const deleted = await clearGuestSupportMessages(guestKey);
        return success(res, { deleted }, 'Support AI history cleared');
      }

      // Лендинг: нет JWT и гость ещё не создал UUID — очистка и так no-op, не 401
      return success(res, { deleted: 0 }, 'Support AI history cleared');
    } catch (err) {
      return error(res, 'Failed to clear support AI history', 500, err);
    }
  }
);

module.exports = router;
