const express = require('express');
const path = require('path');
const fs = require('fs');
const { loadPublicSharePage } = require('../services/requestSocialShareService');
const { renderSocialSharePage } = require('../utils/socialSharePage');

const router = express.Router();
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidRequestId(id) {
  return typeof id === 'string' && UUID_RE.test(id.trim());
}

/**
 * GET /social/:requestId — публичная HTML-страница (OG для Telegram/WhatsApp/Facebook).
 */
router.get('/social/:requestId', async (req, res) => {
  try {
    const requestId = String(req.params.requestId || '').trim();
    if (!isValidRequestId(requestId)) {
      return res.status(404).type('text/plain').send('Not found');
    }

    const localeQuery = req.query.locale;
    const data = await loadPublicSharePage(requestId, {
      locale: localeQuery,
      acceptLanguage: req.get('accept-language'),
    });
    if (!data) {
      return res.status(404).type('text/plain').send('Not found');
    }

    const html = renderSocialSharePage(data);
    res
      .status(200)
      .type('html')
      .set('Cache-Control', 'public, max-age=300')
      .send(html);
  } catch (e) {
    console.error('[socialShare]', e.message);
    res.status(500).type('text/plain').send('Error');
  }
});

/**
 * GET /social/:requestId/og.jpg — fallback, если нужен отдельный URL (основной — /uploads/social/.../og.jpg).
 */
router.get('/social/:requestId/og.jpg', async (req, res) => {
  try {
    const requestId = String(req.params.requestId || '').trim();
    if (!isValidRequestId(requestId)) {
      return res.status(404).type('text/plain').send('Not found');
    }

    const data = await loadPublicSharePage(requestId, {});
    if (!data) {
      return res.status(404).type('text/plain').send('Not found');
    }

    const diskPath = path.join(UPLOADS_ROOT, 'social', requestId, 'og.jpg');
    if (!fs.existsSync(diskPath)) {
      return res.status(404).type('text/plain').send('Not found');
    }

    res
      .status(200)
      .type('jpeg')
      .set('Cache-Control', 'public, max-age=31536000, immutable')
      .sendFile(diskPath);
  } catch (e) {
    console.error('[socialShare][og]', e.message);
    res.status(500).type('text/plain').send('Error');
  }
});

module.exports = router;
