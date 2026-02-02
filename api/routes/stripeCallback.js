const express = require('express');
const pool = require('../config/database');
const stripe = require('../config/stripe.js');

const router = express.Router();

/**
 * GET /stripeCallback
 * Обработка редиректа от Stripe после онбординга
 * Проверяет статус аккаунта через API и показывает результат
 */
router.get('/', async (req, res) => {
  const { stripe: status } = req.query;
  
  // Простая HTML страница с результатом
  // Статус будет проверен на фронтенде через API
  const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stripe Onboarding</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: #f5f5f5;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-width: 400px;
        }
        .success { color: #4caf50; }
        .refresh { color: #ff9800; }
        .loading { color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Stripe Onboarding</h1>
        <p class="${status === 'success' ? 'success' : status === 'refresh' ? 'refresh' : 'loading'}">
            ${status === 'success' ? '✅ Onboarding завершен!' : status === 'refresh' ? '🔄 Завершите onboarding' : '⏳ Проверка статуса...'}
        </p>
        <p>Вы можете закрыть это окно</p>
    </div>
</body>
</html>
  `;
  
  res.send(html);
});

module.exports = router;

