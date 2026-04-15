/**
 * HTML-страница: попытка открыть joypick:// + ссылки в App Store / Google Play, если приложения нет.
 * Конфиг через env: APP_STORE_URL, PLAY_STORE_URL, DEEPLINK_AUTO_STORE_MS (0 = только кнопки).
 * Язык: по Accept-Language — приоритет русскому (ru, ru-RU…), иначе английский.
 */

const DEFAULT_APP_STORE =
  process.env.APP_STORE_URL || 'https://apps.apple.com/us/app/joypick/id6738702836';
const DEFAULT_PLAY_STORE =
  process.env.PLAY_STORE_URL ||
  'https://play.google.com/store/apps/details?id=com.mycompany.garbage';

const _autoRaw = process.env.DEEPLINK_AUTO_STORE_MS;
const AUTO_MS =
  _autoRaw === undefined || _autoRaw === ''
    ? 2500
    : Math.max(0, parseInt(_autoRaw, 10) || 0);

/** @param {string|undefined} acceptLanguage */
function pickLocaleFromAcceptLanguage(acceptLanguage) {
  if (!acceptLanguage || typeof acceptLanguage !== 'string') {
    return 'en';
  }
  const tokens = acceptLanguage.split(',').map((part) => part.trim().split(';')[0].toLowerCase());
  for (const t of tokens) {
    if (t.startsWith('ru')) {
      return 'ru';
    }
  }
  return 'en';
}

const COPY = {
  ru: {
    headline: 'JoyPick',
    headlineNews: 'JoyPick — новость',
    lead: 'Открываем приложение… Если не открылось, установите JoyPick из магазина.',
    hintAuto:
      'Через несколько секунд откроется страница магазина, если приложение не запустилось.'
  },
  en: {
    headline: 'JoyPick',
    headlineNews: 'JoyPick — news',
    lead: 'Opening the app… If nothing happens, install JoyPick from the store.',
    hintAuto: 'The store page will open in a few seconds if the app did not launch.'
  }
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{ appScheme: string, acceptLanguage?: string, page?: 'request' | 'news', pageUrl?: string }} opts
 */
function renderAppOpenLandingPage(opts) {
  const { appScheme, acceptLanguage, page = 'request', pageUrl } = opts;
  const locale = pickLocaleFromAcceptLanguage(acceptLanguage);
  const t = COPY[locale];
  const headline = page === 'news' ? t.headlineNews : t.headline;
  const htmlLang = locale === 'ru' ? 'ru' : 'en';
  const safePageUrl = pageUrl ? escapeHtml(pageUrl) : '';

  const cfg = {
    app: appScheme,
    apple: DEFAULT_APP_STORE,
    play: DEFAULT_PLAY_STORE,
    autoMs: AUTO_MS,
    hintAuto: t.hintAuto
  };
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(headline)}</title>
  ${safePageUrl ? `<link rel="canonical" href="${safePageUrl}" />` : ''}
  ${safePageUrl ? `<meta property="og:url" content="${safePageUrl}" />` : ''}
  <meta property="og:title" content="${escapeHtml(headline)}" />
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:24px;max-width:420px;margin:0 auto;background:#f6f7f9;color:#111;}
    h1{font-size:1.25rem;margin:0 0 8px;}
    p{color:#444;font-size:0.95rem;line-height:1.45;margin:0 0 20px;}
    .btn{display:block;width:100%;box-sizing:border-box;text-align:center;padding:14px 16px;margin:10px 0;border-radius:12px;font-weight:600;text-decoration:none;color:#fff;}
    .btn-apple{background:#000;}
    .btn-play{background:#01875f;}
    .hint{font-size:0.85rem;color:#666;margin-top:20px;}
  </style>
</head>
<body>
  <h1>${escapeHtml(headline)}</h1>
  <p>${escapeHtml(t.lead)}</p>
  <a class="btn btn-apple" href="${escapeHtml(cfg.apple)}">App Store</a>
  <a class="btn btn-play" href="${escapeHtml(cfg.play)}">Google Play</a>
  <p class="hint" id="auto"></p>
  <script type="application/json" id="deeplink-cfg">${json}</script>
  <script>
(function(){
  var el = document.getElementById('deeplink-cfg');
  var cfg = JSON.parse(el.textContent);
  function tryOpenApp(){
    try { window.location.href = cfg.app; } catch(e) {}
    try {
      var f = document.createElement('iframe');
      f.style.display = 'none';
      f.src = cfg.app;
      document.body.appendChild(f);
      setTimeout(function(){ try { document.body.removeChild(f); } catch(x) {} }, 2000);
    } catch(e2) {}
  }
  tryOpenApp();

  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/i.test(ua);
  var isAndroid = /Android/i.test(ua);
  var auto = document.getElementById('auto');

  if (cfg.autoMs > 0 && (isIOS || isAndroid)) {
    var done = false;
    function goStore(){
      if (done) return;
      done = true;
      if (document.visibilityState === 'hidden') return;
      window.location.href = isIOS ? cfg.apple : cfg.play;
    }
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'hidden') done = true;
    });
    setTimeout(goStore, cfg.autoMs);
    auto.textContent = cfg.hintAuto || '';
  }
})();
  </script>
</body>
</html>`;
}

module.exports = {
  renderAppOpenLandingPage,
  pickLocaleFromAcceptLanguage,
  DEFAULT_APP_STORE,
  DEFAULT_PLAY_STORE
};
