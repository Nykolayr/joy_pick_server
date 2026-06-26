const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function renderSocialSharePage(data) {
  const {
    shareUrl,
    locale,
    ui,
    requestName,
    city,
    categoryLabel,
    articleText,
    beforePhotoUrl,
    afterPhotoUrl,
    ogImageUrl,
    deepLinkUrl,
    ogDescription,
    ogTitle,
  } = data;

  const htmlLang = locale === 'ru' ? 'ru' : 'en';
  const safeTitle = escapeHtml(ogTitle);
  const safeDesc = escapeHtml(ogDescription);
  const safeShareUrl = escapeHtml(shareUrl);
  const safeOgImage = escapeHtml(ogImageUrl);
  const safeName = escapeHtml(requestName);
  const safeCity = city ? escapeHtml(city) : '';
  const safeCategory = escapeHtml(categoryLabel);
  const safeArticle = escapeHtml(articleText);
  const safeBefore = escapeHtml(beforePhotoUrl);
  const safeAfter = escapeHtml(afterPhotoUrl);
  const safeDeepLink = escapeHtml(deepLinkUrl);
  const safeSupportIntro = escapeHtml(ui.supportIntro);
  const safeSupportLink = escapeHtml(ui.supportLinkText);

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${safeShareUrl}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:image" content="${safeOgImage}" />
  <meta property="og:site_name" content="JoyPick" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="${safeOgImage}" />
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f7f5;
      --card: #ffffff;
      --text: #1a2e1f;
      --muted: #5a6b5f;
      --accent: #2e7d32;
      --border: rgba(0,0,0,0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .wrap {
      max-width: 720px;
      margin: 0 auto;
      padding: 24px 16px 48px;
    }
    .card {
      background: var(--card);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.06);
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .content { padding: 20px 20px 24px; }
    h1 {
      margin: 0 0 8px;
      font-size: 1.5rem;
      line-height: 1.25;
    }
    .meta {
      color: var(--muted);
      font-size: 0.95rem;
      margin-bottom: 16px;
    }
    .article {
      font-size: 1rem;
      margin-bottom: 12px;
    }
    .support {
      font-size: 1rem;
      margin: 0;
    }
    .support a {
      color: var(--accent);
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .photos {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 20px;
    }
    .photos figure { margin: 0; }
    .photos img {
      width: 100%;
      aspect-ratio: 4/3;
      object-fit: cover;
      border-radius: 10px;
      background: #ddd;
    }
    .photos figcaption {
      font-size: 0.8rem;
      color: var(--muted);
      margin-top: 4px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="content">
        <h1>${safeName}</h1>
        <div class="meta">${safeCategory}${safeCity ? ` · ${escapeHtml(ui.cityPrefix)} ${safeCity}` : ''}</div>
        <div class="photos">
          <figure>
            <img src="${safeBefore}" alt="${escapeHtml(ui.beforeLabel)}" loading="lazy" />
            <figcaption>${escapeHtml(ui.beforeLabel)}</figcaption>
          </figure>
          <figure>
            <img src="${safeAfter}" alt="${escapeHtml(ui.afterLabel)}" loading="lazy" />
            <figcaption>${escapeHtml(ui.afterLabel)}</figcaption>
          </figure>
        </div>
        <p class="article">${safeArticle}</p>
        <p class="support">${safeSupportIntro} <a href="${safeDeepLink}">${safeSupportLink}</a>.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { renderSocialSharePage };
