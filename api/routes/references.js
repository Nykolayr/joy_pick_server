const express = require('express');
const { success, error } = require('../utils/response');

const router = express.Router();

/**
 * Справочник валют для выбора в админке (партнёр: валюта скидки за коины).
 * Код валюты (code) сохраняется в partners.currency.
 */
const CURRENCIES = [
  { code: 'USD', name: 'Доллар США' },
  { code: 'CAD', name: 'Канадский доллар' },
  { code: 'EUR', name: 'Евро' },
  { code: 'GBP', name: 'Фунт стерлингов' },
  { code: 'CHF', name: 'Швейцарский франк' },
  { code: 'AUD', name: 'Австралийский доллар' },
  { code: 'NZD', name: 'Новозеландский доллар' },
  { code: 'JPY', name: 'Японская иена' },
  { code: 'CNY', name: 'Китайский юань' },
  { code: 'HKD', name: 'Гонконгский доллар' },
  { code: 'SGD', name: 'Сингапурский доллар' },
  { code: 'KRW', name: 'Южнокорейская вона' },
  { code: 'INR', name: 'Индийская рупия' },
  { code: 'RUB', name: 'Российский рубль' },
  { code: 'UAH', name: 'Гривна' },
  { code: 'BYN', name: 'Белорусский рубль' },
  { code: 'KZT', name: 'Тенге' },
  { code: 'TRY', name: 'Турецкая лира' },
  { code: 'BRL', name: 'Бразильский реал' },
  { code: 'MXN', name: 'Мексиканское песо' },
  { code: 'ZAR', name: 'Южноафриканский ранд' },
  { code: 'PLN', name: 'Польский злотый' },
  { code: 'CZK', name: 'Чешская крона' },
  { code: 'SEK', name: 'Шведская крона' },
  { code: 'NOK', name: 'Норвежская крона' },
  { code: 'DKK', name: 'Датская крона' },
  { code: 'THB', name: 'Тайский бат' },
  { code: 'IDR', name: 'Индонезийская рупия' },
  { code: 'MYR', name: 'Малайзийский ринггит' },
  { code: 'PHP', name: 'Филиппинское песо' },
  { code: 'AED', name: 'Дирхам ОАЭ' },
  { code: 'SAR', name: 'Саудовский риял' },
  { code: 'ILS', name: 'Новый израильский шекель' },
  { code: 'EGP', name: 'Египетский фунт' }
];

/**
 * GET /api/references/currencies
 * Список валют для выбора в админке (без авторизации).
 */
router.get('/currencies', (req, res) => {
  try {
    success(res, { currencies: CURRENCIES });
  } catch (err) {
    error(res, 'Ошибка при получении справочника валют', 500, err);
  }
});

module.exports = router;
