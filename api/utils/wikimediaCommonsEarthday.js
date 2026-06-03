/**
 * Поиск превью изображений Wikimedia Commons по данным строки earthday_cleanups.
 * Общая логика для GET /earthday-cleanups-admin/:id/wikimedia-preview и пакетного создания заявок.
 */

function parseWikimediaLimit(raw) {
  if (raw == null || String(raw).trim() === '') return { value: 18 };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { error: 'limit: ожидается целое число в диапазоне 1..50' };
  }
  if (n < 1 || n > 50) {
    return { error: 'limit: допустимо 1..50' };
  }
  return { value: n };
}

function appendBitmapFiletypeFilter(srsearch) {
  const s = String(srsearch).trim();
  if (/filetype:\s*bitmap\b/i.test(s)) return s;
  return `${s} filetype:bitmap`.trim();
}

const COMMONS_SEARCHABLE_MAX = 290;

const COMMONS_AUGMENT_COMPACT =
  ' (cleanup OR litter OR trash OR beach OR shore OR volunteer OR park OR trail OR landscape OR forest OR river OR lake OR nature OR wildlife)'
  + ' -satellite -NASA -ISS -Landsat -MODIS -orthophoto -"View of Earth"'
  + ' -church -museum -hospital -Depot -Plaza -"Historic District" -Episcopal'
  + ' -taxidermy -aquarium -specimen -indoor -diorama -banding';

function finalizeCommonsImageSearch(srsearch) {
  const raw = String(srsearch).trim();
  const ncRe = /^(nearcoord:\d+(?:\.\d+)?km,-?[\d.]+,-?[\d.]+)/i;
  const ncMatch = raw.match(ncRe);

  let nearPart = '';
  let textPart = raw;
  if (ncMatch) {
    nearPart = ncMatch[1];
    textPart = raw.slice(ncMatch[0].length).replace(/^\s+/, '');
  }

  const aug = COMMONS_AUGMENT_COMPACT;
  const room = COMMONS_SEARCHABLE_MAX - aug.length;
  let core = textPart.trim();
  if (core.length > room) {
    core = core.slice(0, Math.max(0, room));
    const ls = core.lastIndexOf(' ');
    if (ls > Math.floor(room * 0.35)) {
      core = core.slice(0, ls);
    }
    core = core.trim();
  }

  const searchable = `${core}${aug}`.trim();
  const joined = [nearPart, searchable].filter(Boolean).join(' ');
  return appendBitmapFiletypeFilter(joined);
}

function shuffleArrayInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function isLikelySatelliteOrOrthoTitle(title) {
  if (title == null || typeof title !== 'string') return false;
  const t = title.replace(/^File:/i, '');
  if (/\bISS\d{3}\s*-\s*E\s*-\s*\d+/i.test(t)) return true;
  if (/\bISS\s*[_\s-]?\s*\d{2,3}\b/i.test(t)) return true;
  if (/view\s+of\s+earth/i.test(t)) return true;
  if (/\bfrom\s+(the\s+)?ISS\b/i.test(t)) return true;
  if (/\bInternational\s+Space\s+Station\b/i.test(t)) return true;
  if (/\bNASA\b/i.test(t)) return true;
  if (/\bNOAA\b/i.test(t) && /(satellite|GOES|POES|orbiting)/i.test(t)) return true;
  if (/\b(astronaut|cosmonaut)\b.*\b(earth|orbit)\b/i.test(t)) return true;
  if (/earth\s+at\s+night|city\s+lights|night\s+lights.*\b(earth|orbit|space)\b|from\s+orbit/i.test(t)) return true;
  if (/crew\s+earth\s+observation/i.test(t)) return true;
  if (/\bDSCOVR\b|\bEPIC\b.*\bearth\b|\bblue\s+marble\b/i.test(t)) return true;
  if (/satellite|landsat|sentinel|modis|orthophoto|worldview|quickbird|ikonos|geoeye|\bgoes\b|himawari|copernicus|skysat|planet[\s_-]?labs|\bnaip\b|aerial[\s_-]?survey|orthophotomap|earth[\s_-]?observation|spaceborn|space[\s_-]?imagery/i.test(t)) {
    return true;
  }
  return false;
}

function isLikelyBuildingOrUrbanTitle(title) {
  if (title == null || typeof title !== 'string') return false;
  const t = title.replace(/^File:/i, '');

  if (/iNaturalist|observation\.org|Wikispecies|GBIF\.org/i.test(t)) return false;
  if (/\b(darter|minnow|sunfish|bass|trout|salamander|newt|frog|toad|snake|turtle|lizard)\b/i.test(t)) {
    return false;
  }
  if (/\b(butterfly|moth|beetle|dragonfly|bee|wasp|spider)\b/i.test(t)) return false;
  if (/\b(wildflower|rosemallow|trillium|orchid|fern|moss|lichen|fungus|mushroom)\b/i.test(t)) {
    return false;
  }

  if (/\b(church|cathedral|chapel|basilica|episcopal|baptist|methodist|presbyterian|lutheran)\b/i.test(t)) {
    return true;
  }
  if (/\b(mosque|synagogue|temple|shrine)\b/i.test(t)) return true;
  if (/\b(museum|hospital|clinic|courthouse|memorial\s+hospital)\b/i.test(t)) return true;
  if (/\bfire\s+department\b/i.test(t)) return true;
  if (/\b(county\s+health|health\s+unit)\b/i.test(t)) return true;
  if (/\bhistoric\s+district|commercial\s+district\b/i.test(t)) return true;
  if (/\b(mercantile|plaza\b|railway\s+depot|\bdepot\.|train\s+station)\b/i.test(t)) return true;
  if (/\b(school|university|college|academy|library|post\s+office|city\s+hall)\b/i.test(t)) return true;
  if (/\([^)]+\s+House\)/i.test(t)) return true;
  if (/\bchurch\b.*\b\d+\s+of\s+\d+|\bdistrict\b.*\b\d+\s+of\s+\d+/i.test(t)) return true;
  if (/\b(old\s+)?US[\s_-]*\d{1,3}\b|_approach\.|\binterstate\b|\bI-?\d{1,3}\b/i.test(t)
    && !/state\s+park|national\s+forest|wildlife|nature|trailhead|recreation\s+area/i.test(t)) {
    return true;
  }
  return false;
}

function validEarthdayCoords(lat, lng) {
  if (lat == null || lng == null) return false;
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  if (Math.abs(la) < 1e-9 && Math.abs(lo) < 1e-9) return false;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return false;
  return true;
}

function isLikelyIndoorOrIrrelevantTitle(title) {
  if (title == null || typeof title !== 'string') return false;
  const t = title.replace(/^File:/i, '');
  if (/\b(taxidermy|stuffed|diorama|specimen|mounted|skull|herbarium|banding|ringed|telemetry)\b/i.test(t)) {
    return true;
  }
  if (/\b(indoor|interior|inside|exhibit|display\s+case|visitor\s+center|nature\s+center|aquarium)\b/i.test(t)) {
    return true;
  }
  if (/\b(zoo\b.*\b(indoor|exhibit)|museum\b)/i.test(t)) return true;
  return false;
}

/** Выше — лучше для обложки cleanup/event. */
function scoreCommonsTitle(title) {
  if (!title || typeof title !== 'string') return -999;
  const t = title.replace(/^File:/i, '').toLowerCase();
  let score = 0;
  if (/\b(cleanup|clean-up|litter|trash|garbage|rubbish|beach\s+clean|shoreline|coastal)\b/.test(t)) {
    score += 50;
  }
  if (/\b(volunteer|beach|shore|coast|park|trail|forest|river|lake|preserve|refuge|wetland)\b/.test(t)) {
    score += 25;
  }
  if (/\b(landscape|nature|wildlife|habitat|outdoor)\b/.test(t)) score += 10;
  if (isLikelySatelliteOrOrthoTitle(title)) score -= 120;
  if (isLikelyBuildingOrUrbanTitle(title)) score -= 80;
  if (isLikelyIndoorOrIrrelevantTitle(title)) score -= 100;
  return score;
}

function sortCommonsTitlesByScore(titles) {
  return titles.slice().sort((a, b) => scoreCommonsTitle(b) - scoreCommonsTitle(a));
}

function isRasterPhotoCommonsTitle(title) {
  if (title == null || typeof title !== 'string') return false;
  const t = title.replace(/^File:/i, '');
  if (/\.(pdf|djvu?|svg|epub|ps|tex|gz|zip|tar|mp4|webm|ogg|ogv|mp3|wav|mid|flac)$/i.test(t)) {
    return false;
  }
  return /\.(jpe?g|png|gif|webp)$/i.test(t);
}

function buildWikimediaSearchAttempts(row) {
  const geo = row.GeoCodedAddress != null ? String(row.GeoCodedAddress).trim() : '';
  const locationHint = row.location_hint != null ? String(row.location_hint).trim() : '';
  const country = row.country != null ? String(row.country).trim() : '';
  const locName = row.name_of_cleanup_location != null ? String(row.name_of_cleanup_location).trim() : '';
  const lat = row.lat;
  const lng = row.lng;

  const attempts = [];

  if (validEarthdayCoords(lat, lng)) {
    const km = process.env.WIKIMEDIA_NEARRADIUS_KM != null
      ? Math.min(80, Math.max(5, Number(process.env.WIKIMEDIA_NEARRADIUS_KM) || 25))
      : 25;
    attempts.push({
      label: 'nearcoord_bitmap',
      srsearch: finalizeCommonsImageSearch(`nearcoord:${km}km,${Number(lat)},${Number(lng)}`)
    });
  }

  if (geo !== '') {
    const text = country && !geo.includes(country) ? `${geo} ${country}`.trim() : geo;
    attempts.push({
      label: 'address_bitmap',
      srsearch: finalizeCommonsImageSearch(text)
    });
  }

  if (locName !== '' && geo !== '') {
    attempts.push({
      label: 'location_name_address_bitmap',
      srsearch: finalizeCommonsImageSearch(`${locName} ${geo}`)
    });
  }

  if (locationHint !== '') {
    const text = country && !locationHint.includes(country) ? `${locationHint} ${country}`.trim() : locationHint;
    attempts.push({
      label: 'location_hint_bitmap',
      srsearch: finalizeCommonsImageSearch(text)
    });
  }

  if (country !== '' && attempts.length === 0) {
    attempts.push({
      label: 'country_bitmap',
      srsearch: finalizeCommonsImageSearch(country)
    });
  }

  const seen = new Set();
  return attempts.filter((a) => {
    if (seen.has(a.srsearch)) return false;
    seen.add(a.srsearch);
    return true;
  });
}

function buildImageItemFromPage(page) {
  if (!page || page.missing != null || page.invalid != null) return null;
  const imageInfo = Array.isArray(page.imageinfo) && page.imageinfo.length > 0 ? page.imageinfo[0] : null;
  if (!imageInfo) return null;
  const thumbUrl = imageInfo.thumburl || imageInfo.url || null;
  if (!thumbUrl) return null;
  const title = page.title || null;
  const encodedTitle = title ? encodeURIComponent(title.replace(/ /g, '_')) : null;
  const pageUrl = encodedTitle ? `https://commons.wikimedia.org/wiki/${encodedTitle}` : null;
  const fullUrl = imageInfo.url || thumbUrl;
  return {
    thumb_url: thumbUrl,
    full_url: fullUrl,
    title,
    page_url: pageUrl
  };
}

async function fetchWikimediaPreviewByAttempts(attempts, limit) {
  const endpoint = 'https://commons.wikimedia.org/w/api.php';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  const userAgent = process.env.WIKIMEDIA_USER_AGENT
    || 'JoyPickServer/1.0 (contact: support@joypick.app)';

  const fetchOpts = {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': userAgent
    },
    signal: controller.signal
  };

  const seenFull = new Set();
  const items = [];
  let strategyUsed = null;
  let srsearchUsed = null;

  try {
    const offsetCap = Number(process.env.WIKIMEDIA_RANDOM_OFFSET_MAX) || 500;

    const runListSearch = async (att, srlimit, sroffset) => {
      const searchUrl = new URL(endpoint);
      searchUrl.searchParams.set('action', 'query');
      searchUrl.searchParams.set('format', 'json');
      searchUrl.searchParams.set('list', 'search');
      searchUrl.searchParams.set('srsearch', att.srsearch);
      searchUrl.searchParams.set('srnamespace', '6');
      searchUrl.searchParams.set('srlimit', String(srlimit));
      if (sroffset > 0) {
        searchUrl.searchParams.set('sroffset', String(sroffset));
      }
      const searchRes = await fetch(searchUrl.toString(), fetchOpts);
      if (!searchRes.ok) {
        return { ok: false, status: searchRes.status };
      }
      const searchData = await searchRes.json();
      if (searchData && searchData.error) {
        return {
          ok: false,
          status: 502,
          errMsg: searchData.error.info || searchData.error.code || 'Wikimedia search error'
        };
      }
      return { ok: true, searchData };
    };

    for (const att of attempts) {
      if (items.length >= limit) break;

      const need = limit - items.length;
      const srlimit = Math.min(50, Math.max(need * 8, 24));

      let first = await runListSearch(att, srlimit, 0);
      if (!first.ok) {
        return {
          error: first.errMsg || `Wikimedia search HTTP ${first.status}`,
          status: first.status >= 400 && first.status < 600 ? first.status : 502
        };
      }
      let { searchData } = first;

      const totalhitsRaw = searchData && searchData.query && searchData.query.searchinfo
        ? searchData.query.searchinfo.totalhits
        : null;
      const totalhits = Number(totalhitsRaw);
      if (Number.isFinite(totalhits) && totalhits > srlimit) {
        const maxStart = Math.max(0, Math.min(totalhits - srlimit, offsetCap));
        if (maxStart > 0) {
          const sroffset = Math.floor(Math.random() * (maxStart + 1));
          const second = await runListSearch(att, srlimit, sroffset);
          if (second.ok) {
            searchData = second.searchData;
          }
        }
      }

      const hits = (searchData && searchData.query && Array.isArray(searchData.query.search))
        ? searchData.query.search
        : [];
      let titles = hits
        .map((h) => h && h.title)
        .filter((t) => typeof t === 'string' && t.length > 0)
        .filter(isRasterPhotoCommonsTitle)
        .filter((t) => !isLikelySatelliteOrOrthoTitle(t))
        .filter((t) => !isLikelyBuildingOrUrbanTitle(t))
        .filter((t) => !isLikelyIndoorOrIrrelevantTitle(t));

      if (titles.length === 0) continue;

      titles = sortCommonsTitlesByScore(titles);
      const titleChunk = titles.slice(0, 50);
      const infoUrl = new URL(endpoint);
      infoUrl.searchParams.set('action', 'query');
      infoUrl.searchParams.set('format', 'json');
      infoUrl.searchParams.set('titles', titleChunk.join('|'));
      infoUrl.searchParams.set('prop', 'imageinfo');
      infoUrl.searchParams.set('iiprop', 'url|thumburl');
      infoUrl.searchParams.set('iiurlwidth', '280');
      infoUrl.searchParams.set('redirects', '1');

      const infoRes = await fetch(infoUrl.toString(), fetchOpts);
      if (!infoRes.ok) {
        return { error: `Wikimedia imageinfo HTTP ${infoRes.status}`, status: 502 };
      }
      const infoData = await infoRes.json();
      const pages = infoData && infoData.query && infoData.query.pages
        ? Object.values(infoData.query.pages)
        : [];
      const byTitle = new Map();
      for (const p of pages) {
        if (p && p.title) byTitle.set(p.title, p);
      }

      for (const title of titleChunk) {
        if (items.length >= limit) break;
        const page = byTitle.get(title);
        const item = buildImageItemFromPage(page);
        if (!item) continue;
        if (seenFull.has(item.full_url)) continue;
        seenFull.add(item.full_url);
        items.push(item);
        if (!strategyUsed) {
          strategyUsed = att.label;
          srsearchUsed = att.srsearch;
        }
      }
    }

    shuffleArrayInPlace(items);
    return { items, strategy_used: strategyUsed, srsearch_used: srsearchUsed };
  } catch (e) {
    const message = e && e.name === 'AbortError'
      ? 'Wikimedia request timeout'
      : (e.message || 'Wikimedia request failed');
    return { error: message, status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  parseWikimediaLimit,
  buildWikimediaSearchAttempts,
  fetchWikimediaPreviewByAttempts,
  validEarthdayCoords,
  shuffleArrayInPlace,
  scoreCommonsTitle,
  sortCommonsTitlesByScore,
};
