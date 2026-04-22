const express = require('express');
const { body, validationResult } = require('express-validator');
const { success, error } = require('../utils/response');
const { transporter } = require('../config/email');

const router = express.Router();

const LANDING_CONTACT_EMAIL = process.env.LANDING_CONTACT_EMAIL || 'rail.demarco@gmail.com';
const APP_NAME = process.env.APP_NAME || 'Joy Pick';
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * POST /api/landing/contact
 * Отправка сообщения с контактной формы лендинга.
 * Поля: email, name, phone_number (optional), message
 */
router.post('/contact', [
  body('email').isEmail().withMessage('Invalid email'),
  body('name').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Name must be 2-120 chars'),
  body('phone_number').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }).withMessage('Phone number is too long'),
  body('message').isString().trim().isLength({ min: 1, max: 5000 }).withMessage('Message must be 1-5000 chars')
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return error(res, 'Validation error', 400, validationErrors.array());
    }

    if (!transporter) {
      return error(res, 'Email transporter not configured', 500, {
        message: 'Set SMTP credentials in environment variables',
        recipient: LANDING_CONTACT_EMAIL
      });
    }

    const email = String(req.body.email || '').trim();
    const name = String(req.body.name || '').trim();
    const phoneNumber = String(req.body.phone_number || '').trim();
    const message = String(req.body.message || '').trim();
    const submittedAt = new Date().toISOString();
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safePhoneNumber = escapeHtml(phoneNumber || '-');
    const safeMessage = escapeHtml(message);

    const subject = `[${APP_NAME}] Landing contact form`;
    const html = `
      <!doctype html>
      <html>
      <body style="font-family: Arial, sans-serif; line-height:1.5; color:#222;">
        <h2>Новое сообщение с лендинга</h2>
        <p><strong>Имя:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        <p><strong>Телефон:</strong> ${safePhoneNumber}</p>
        <p><strong>Время отправки (UTC):</strong> ${submittedAt}</p>
        <hr />
        <p><strong>Сообщение:</strong></p>
        <p style="white-space: pre-wrap;">${safeMessage}</p>
      </body>
      </html>
    `;
    const text = [
      'Новое сообщение с лендинга',
      '',
      `Имя: ${name}`,
      `Email: ${email}`,
      `Телефон: ${phoneNumber || '-'}`,
      `Время отправки (UTC): ${submittedAt}`,
      '',
      'Сообщение:',
      message
    ].join('\n');

    const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@joypick.com';
    await transporter.sendMail({
      from: `"${APP_NAME}" <${fromEmail}>`,
      to: LANDING_CONTACT_EMAIL,
      replyTo: email,
      subject,
      html,
      text
    });

    return success(res, {
      sent: true,
      recipient: LANDING_CONTACT_EMAIL,
      submittedAt
    }, 'Message sent successfully');
  } catch (err) {
    return error(res, 'Failed to send landing form message', 500, err);
  }
});

module.exports = router;
