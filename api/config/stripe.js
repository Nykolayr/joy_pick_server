const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  timeout: 20000, // 20 секунд таймаут для всех запросов к Stripe
  maxNetworkRetries: 2
});

module.exports = stripe;

