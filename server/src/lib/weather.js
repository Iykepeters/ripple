// Weather lookup for Auto heat adjustment.
//
// Uses Open-Meteo's free API, which is for NON-COMMERCIAL use only and requires
// CC BY 4.0 attribution (the dashboard shows it). Before charging users or showing
// ads, move to a paid Open-Meteo plan or another provider. Only this file changes.

const API_URL = 'https://api.open-meteo.com/v1/forecast';
const SUCCESS_TTL_MS = 3 * 60 * 60 * 1000; // reuse a good result for 3 hours
const FAILURE_TTL_MS = 5 * 60 * 1000;      // retry a failed lookup after 5 minutes
const cache = new Map();

// Hard ceiling on any weather-based bonus, even if the tiers below are edited later.
export const MAX_BONUS_ML = 1000;

// PLACEHOLDER tiers keyed on the "feels like" daily maximum (deg C).
// These are rough nudges, not medical figures. Validate with a health professional.
const TIERS = [
  { minC: 40, bonusMl: 750 },
  { minC: 35, bonusMl: 500 },
  { minC: 30, bonusMl: 250 }
];

export function bonusForApparentTemp(apparentMaxC) {
  if (!Number.isFinite(apparentMaxC)) return 0;
  for (const tier of TIERS) {
    if (apparentMaxC >= tier.minC) return Math.min(tier.bonusMl, MAX_BONUS_ML);
  }
  return 0;
}

function localDateString(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const round1 = (n) => Math.round(n * 10) / 10;

// Returns { apparentMaxC, tempMaxC } for today at this location, or null if unavailable.
export async function getTodayWeather(latitude, longitude, timezone) {
  const lat = latitude.toFixed(2);
  const lon = longitude.toFixed(2);
  const key = `${lat},${lon},${localDateString(timezone)}`;

  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.value;

  let value = null;
  try {
    const url = new URL(API_URL);
    url.searchParams.set('latitude', lat);
    url.searchParams.set('longitude', lon);
    url.searchParams.set('daily', 'apparent_temperature_max,temperature_2m_max');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', '1');

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Weather API responded with status ${res.status}`);

    const data = await res.json();
    const apparent = data?.daily?.apparent_temperature_max?.[0];
    const temp = data?.daily?.temperature_2m_max?.[0];

    if (Number.isFinite(apparent)) {
      value = {
        apparentMaxC: round1(apparent),
        tempMaxC: Number.isFinite(temp) ? round1(temp) : null
      };
    }
  } catch (err) {
    // Never log coordinates, only the reason.
    console.warn('Weather lookup failed:', err.message);
  }

  if (cache.size > 1000) cache.clear();
  cache.set(key, { value, expiresAt: Date.now() + (value ? SUCCESS_TTL_MS : FAILURE_TTL_MS) });
  return value;
}
