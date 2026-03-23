/**
 * Континент и страна по WGS84 (lat, lon) без внешних API — та же идея, что на админ-клиенте.
 * Названия на английском; границы приблизительные (bbox), не для юридических целей.
 */

function normalizeLon(lon) {
  let x = lon;
  while (x <= -180) x += 360;
  while (x > 180) x -= 360;
  return x;
}

/**
 * Порядок правил — строго сверху вниз, первое совпадение.
 * @param {number} lat
 * @param {number} lon нормализованная долгота
 */
function continentFromLatLon(lat, lon) {
  if (lat < -60) return 'Antarctica';

  if (lat >= -50 && lat <= -10 && lon >= 110 && lon <= 155) return 'Oceania';

  if (lat > -10 && lat < 22 && lon >= 160 && lon <= 180) return 'Oceania';

  if (lat > -10 && lat < 22 && lon >= -180 && lon <= -120) return 'Oceania';

  if (lat >= 15 && lat <= 25 && lon >= -165 && lon <= -150) return 'Oceania';

  if (lat >= 50 && lat <= 73 && lon >= -180 && lon <= -168) return 'Asia';

  if (lat >= 42 && lat <= 77 && lon >= 128 && lon <= 180) return 'Asia';

  if (lat >= 15 && lat <= 45 && lon >= 26 && lon <= 63) return 'Asia';

  if (lon >= -165 && lon <= -30) {
    if (lat > -56 && lat < 17) return 'South America';
    return 'North America';
  }

  if (lat >= 36 && lat <= 72 && lon >= -25 && lon <= 40) return 'Europe';

  if (lat >= 41 && lat <= 70 && lon > 40 && lon <= 65) return 'Europe';

  if (lat >= -37 && lat <= 37 && lon >= -25 && lon <= 55) return 'Africa';

  if (lat >= -12 && lat <= 82 && lon > 40) return 'Asia';

  return 'Unknown';
}

/** [minLat, maxLat, minLon, maxLon, nameEn] — сверху вниз, первое попадание */
const COUNTRY_BBOXES = [
  // Мелкие/узкие — до крупных перекрывающихся
  [50.6, 53.7, 3.2, 7.3, 'Netherlands'],
  [49.4, 51.6, 2.5, 6.5, 'Belgium'],
  [45.7, 47.9, 5.8, 10.6, 'Switzerland'],
  [46.2, 49.2, 9.4, 17.2, 'Austria'],
  [48.5, 51.1, 12, 19, 'Czech Republic'],
  [47.5, 49.8, 16.8, 22.7, 'Slovakia'],
  [45.5, 48.6, 16, 23, 'Hungary'],
  [54.5, 57.9, 8, 13, 'Denmark'],
  [57, 71, 4, 32, 'Norway'],
  [55, 69, 10, 24, 'Sweden'],
  [59, 70, 20, 32, 'Finland'],
  [51.2, 55.5, -11, -5.5, 'Ireland'],
  [36, 42.5, -10, -6, 'Portugal'],
  [34, 42, 19, 30, 'Greece'],
  [43, 48, 20, 30, 'Romania'],
  [41, 44, 22, 28.5, 'Bulgaria'],
  [49.0, 55.5, 14.0, 24.2, 'Poland'],
  [47.0, 55.2, 5.5, 15.2, 'Germany'],
  [50.0, 59.5, -8.5, 2.0, 'United Kingdom'],
  [41.0, 51.5, -5.5, 10.0, 'France'],
  [36.0, 44.0, -10.0, 5.0, 'Spain'],
  [36.0, 47.5, 6.5, 19.0, 'Italy'],
  [44.0, 53.5, 22.0, 41.0, 'Ukraine'],
  [40.5, 55.5, 46.0, 87.5, 'Kazakhstan'],
  [35.5, 42.5, 25.5, 45.0, 'Turkey'],
  [22.0, 32.5, 24.5, 37.0, 'Egypt'],
  [16.0, 33.0, 34.0, 56.0, 'Saudi Arabia'],
  [25.0, 40.5, 44.0, 64.0, 'Iran'],
  [37.0, 42.5, 55.0, 73.5, 'Uzbekistan'],
  [29.0, 38.5, 60.5, 75.0, 'Kyrgyzstan'],
  [5.5, 20.5, 97, 106, 'Thailand'],
  [0.8, 7.8, 99, 119.5, 'Malaysia'],
  [4.5, 21.5, 116, 127, 'Philippines'],
  [5.5, 21.0, 100, 110, 'Vietnam'],
  [20.0, 26.5, 88, 93, 'Bangladesh'],
  [23.5, 37.2, 60, 77.5, 'Pakistan'],
  [29, 38.5, 60, 75, 'Afghanistan'],
  [18.0, 54.5, 73.5, 135.5, 'China'],
  [20.5, 46.5, 127.0, 146.0, 'Japan'],
  [33.0, 43.0, 124.0, 132.5, 'South Korea'],
  [6.0, 37.0, 68.0, 98.0, 'India'],
  [-11.5, 6.5, 95.0, 141.5, 'Indonesia'],
  [4, 14, 2.5, 15, 'Nigeria'],
  [21, 36, -13, -1, 'Morocco'],
  [19, 37, -9, 12, 'Algeria'],
  [-5, 6, 33, 42, 'Kenya'],
  [-12, -1, 29, 40, 'Tanzania'],
  [-35, -22, 16, 33, 'South Africa'],
  [-44.0, -9.5, 112.5, 154.5, 'Australia'],
  [-38.0, -17.5, 165.0, 179.0, 'New Zealand'],
  [24.0, 49.5, -125.0, -66.0, 'United States'],
  [41.5, 83.5, -141.0, -52.0, 'Canada'],
  [14.0, 33.5, -118.5, -86.0, 'Mexico'],
  [-4.5, 13.5, -79, -66.5, 'Colombia'],
  [-18.5, 0.5, -82, -68, 'Peru'],
  [0.5, 12.5, -74, -59, 'Venezuela'],
  [19.5, 23.5, -85, -74, 'Cuba'],
  [-34.0, 5.5, -74.5, -34.5, 'Brazil'],
  [-56.0, -21.5, -74.0, -53.0, 'Argentina'],
  [-56.0, -17.0, -76.0, -66.0, 'Chile'],
  [50.0, 72.0, 28.0, 70.0, 'Russia'],
  [50.0, 77.0, 100.0, 180.0, 'Russia'],
  [55.0, 72.0, -180.0, -168.0, 'Russia']
];

function inBbox(lat, lon, minLat, maxLat, minLon, maxLon) {
  if (lat < minLat || lat > maxLat) return false;
  if (lon < minLon || lon > maxLon) return false;
  return true;
}

/**
 * @param {number} lat
 * @param {number} lon нормализованная долгота
 * @returns {string|null}
 */
function countryFromLatLon(lat, lon) {
  for (let i = 0; i < COUNTRY_BBOXES.length; i += 1) {
    const [minLat, maxLat, minLon, maxLon, name] = COUNTRY_BBOXES[i];
    if (inBbox(lat, lon, minLat, maxLat, minLon, maxLon)) return name;
  }
  return null;
}

/**
 * Строка для UI/отладки (как на клиенте).
 * @param {string} continent
 * @param {string|null} country
 * @param {string|null|undefined} geoCodedAddress
 */
function buildLocationHint(continent, country, geoCodedAddress) {
  let base = country != null && String(country).trim() !== ''
    ? `${continent} · approx: ${country}`
    : continent;
  const g = geoCodedAddress != null ? String(geoCodedAddress).trim() : '';
  if (g !== '') base = `${base} · ${g}`;
  if (base.length > 4000) return base.slice(0, 4000);
  return base;
}

module.exports = {
  normalizeLon,
  continentFromLatLon,
  countryFromLatLon,
  buildLocationHint,
  COUNTRY_BBOXES
};
