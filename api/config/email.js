const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * Создание транспортера для отправки email
 * Поддерживает несколько способов конфигурации:
 * 1. SMTP (Gmail, Outlook, Yandex и т.д.)
 * 2. SendGrid
 * 3. Mailgun
 */
function createTransporter() {
  // Способ 1: SMTP (Gmail, Outlook, Yandex и т.д.)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const config = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true', // true для 465, false для других портов
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    };
    
    // Для Gmail добавляем дополнительные настройки
    if (process.env.SMTP_HOST.includes('gmail.com')) {
      config.requireTLS = true;
      config.secure = false; // Для порта 587 должно быть false
      config.tls = {
        ciphers: 'SSLv3',
        rejectUnauthorized: false
      };
    }
    
    return nodemailer.createTransport(config);
  }

  // Способ 2: Gmail OAuth2 (если используется)
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.GMAIL_USER,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      },
    });
  }

  // Способ 3: SendGrid
  if (process.env.SENDGRID_API_KEY) {
    return nodemailer.createTransport({
      service: 'SendGrid',
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  }

  // Способ 4: Mailgun (через SMTP)
  if (process.env.MAILGUN_SMTP_USER && process.env.MAILGUN_SMTP_PASS) {
    return nodemailer.createTransport({
      host: 'smtp.mailgun.org',
      port: 587,
      secure: false,
      auth: {
        user: process.env.MAILGUN_SMTP_USER,
        pass: process.env.MAILGUN_SMTP_PASS,
      },
    });
  }

  // Если ничего не настроено, возвращаем null (email не будет отправляться)
  console.warn('⚠️ Email не настроен. Установите переменные окружения для SMTP, Gmail, SendGrid или Mailgun.');
  return null;
}

const transporter = createTransporter();

function buildDefaultHtml(appName, code, logoUrl) {
  const logoBlock = logoUrl
    ? `<div style="text-align:center;margin-bottom:20px;"><img src="${logoUrl}" alt="${appName}" style="max-width:200px;height:auto;" /></div>`
    : '';
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background-color: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }
        .code { background-color: #fff; border: 2px dashed #4CAF50; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 5px; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">${logoBlock}<h1>${appName}</h1></div>
        <div class="content">
          <h2>Код верификации</h2>
          <p>Здравствуйте!</p>
          <p>Вы зарегистрировались в ${appName}. Для подтверждения вашего email адреса используйте следующий код:</p>
          <div class="code">${code}</div>
          <p>Этот код действителен в течение 10 минут.</p>
          <p>Если вы не регистрировались в ${appName}, просто проигнорируйте это письмо.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${appName}. Все права защищены.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function buildDefaultText(appName, code) {
  return `
Здравствуйте!

Вы зарегистрировались в ${appName}. Для подтверждения вашего email адреса используйте следующий код:

${code}

Этот код действителен в течение 10 минут.

Если вы не регистрировались в ${appName}, просто проигнорируйте это письмо.

© ${new Date().getFullYear()} ${appName}. Все права защищены.
  `.trim();
}

/** URL логотипа в письме (полный URL). Используется app_logo.png из корня проекта, отдаётся по /email-logo.png. Либо задать EMAIL_LOGO_URL в .env. */
function getEmailLogoUrl() {
  if (process.env.EMAIL_LOGO_URL) return process.env.EMAIL_LOGO_URL;
  const base = (process.env.APP_URL || process.env.BASE_URL || '').replace(/\/$/, '');
  if (base) return `${base}/email-logo.png`;
  return null;
}

/**
 * Отправка email с кодом верификации.
 * @param {String} email - Email получателя
 * @param {String} code - Код верификации
 * @param {Object} [options] - Текст письма с фронта (по языку): subject, html, text. Плейсхолдеры: {{code}}, {{logo_url}}
 */
async function sendVerificationCode(email, code, options = {}) {
  if (!transporter) {
    return {
      success: false,
      error: 'Email transporter not configured',
      message: 'Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env',
      details: {
        smtpHost: process.env.SMTP_HOST || 'not set',
        smtpUser: process.env.SMTP_USER ? process.env.SMTP_USER.substring(0, 3) + '***' : 'not set',
        smtpPass: process.env.SMTP_PASS ? 'set' : 'not set'
      }
    };
  }

  const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@joypick.com';
  const appName = process.env.APP_NAME || 'Joy Pick';
  const logoUrl = getEmailLogoUrl();

  const replacePlaceholders = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/\{\{code\}\}/g, code)
      .replace(/\{\{logo_url\}\}/g, logoUrl || '');
  };

  const subject = options.subject != null
    ? replacePlaceholders(options.subject)
    : `Код верификации для ${appName}`;
  const htmlContent = options.html != null
    ? replacePlaceholders(options.html)
    : buildDefaultHtml(appName, code, logoUrl);
  const textContent = options.text != null
    ? replacePlaceholders(options.text)
    : buildDefaultText(appName, code);

  const mailOptions = {
    from: `"${appName}" <${fromEmail}>`,
    to: email,
    subject,
    html: htmlContent,
    text: textContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email с кодом верификации отправлен успешно!');
    console.log('✅ Message ID:', info.messageId);
    console.log('✅ Response:', info.response);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Ошибка отправки email:');
    console.error('❌ Код ошибки:', error.code);
    console.error('❌ Сообщение:', error.message);
    console.error('❌ Команда:', error.command);
    console.error('❌ Response:', error.response);
    console.error('❌ Response Code:', error.responseCode);
    console.error('❌ Stack:', error.stack);
    
    // Возвращаем детальную информацию об ошибке
    return {
      success: false,
      error: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode
    };
  }
}

module.exports = {
  sendVerificationCode,
  getEmailLogoUrl,
  transporter,
};

