import express from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { getTodayWeather, bonusForApparentTemp } from '../lib/weather.js';

const router = express.Router();

// Fixed bonus (ml) used by the Manual heat setting.
// Placeholder default: worth validating with a health professional.
const MANUAL_HEAT_BONUS_ML = 500;

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function getUserOr404(userId, res) {
  const result = await pool.query(
    `SELECT timezone, daily_goal_ml, heat_mode, heat_auto, latitude, longitude
     FROM users WHERE id = $1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return null;
  }
  return user;
}

async function getTodayForTimezone(timezone) {
  const { rows } = await pool.query(
    `SELECT to_char((NOW() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today`,
    [timezone]
  );
  return rows[0].today;
}

// Works out today's extra water. If the weather service fails in Auto mode,
// the bonus is simply 0 and the app carries on with the base goal.
async function getHeatAdjustment(user) {
  if (user.heat_auto && user.latitude !== null && user.longitude !== null) {
    const weather = await getTodayWeather(Number(user.latitude), Number(user.longitude), user.timezone);
    return {
      mode: 'auto',
      bonusMl: weather ? bonusForApparentTemp(weather.apparentMaxC) : 0,
      weather
    };
  }
  if (user.heat_mode) {
    return { mode: 'manual', bonusMl: MANUAL_HEAT_BONUS_ML, weather: null };
  }
  return { mode: 'off', bonusMl: 0, weather: null };
}

function summarize(user, adj, date, consumedMl) {
  const goalMl = user.daily_goal_ml + adj.bonusMl;
  const percent = goalMl > 0 ? Math.min(100, Math.round((consumedMl / goalMl) * 100)) : 0;
  return {
    date,
    consumedMl,
    goalMl,
    percent,
    heatMode: adj.mode !== 'off',
    heatSetting: adj.mode,
    heatBonusMl: adj.bonusMl,
    manualBonusMl: MANUAL_HEAT_BONUS_ML,
    weather: adj.weather ? { apparentMaxC: adj.weather.apparentMaxC, source: 'Open-Meteo' } : null
  };
}

async function sumForDate(userId, date) {
  const result = await pool.query(
    'SELECT COALESCE(SUM(amount_ml), 0) AS total FROM hydration_logs WHERE user_id = $1 AND logged_date = $2',
    [userId, date]
  );
  return Number(result.rows[0].total);
}

// Validates and rounds coordinates to 2 decimals (about 1 km) before anything is stored.
function cleanCoords(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    latitude: Math.round(latitude * 100) / 100,
    longitude: Math.round(longitude * 100) / 100
  };
}

// POST /api/hydration/log: log an amount of water for today
router.post('/log', requireAuth, async (req, res) => {
  const { amountMl } = req.body;
  if (!Number.isFinite(amountMl) || amountMl <= 0) {
    return res.status(400).json({ error: 'amountMl must be a positive number.' });
  }

  try {
    const user = await getUserOr404(req.userId, res);
    if (!user) return;

    const today = await getTodayForTimezone(user.timezone);

    await pool.query(
      'INSERT INTO hydration_logs (user_id, logged_date, amount_ml) VALUES ($1, $2, $3)',
      [req.userId, today, Math.round(amountMl)]
    );

    const adj = await getHeatAdjustment(user);
    const consumedMl = await sumForDate(req.userId, today);
    res.status(201).json(summarize(user, adj, today, consumedMl));
  } catch (err) {
    console.error('Log error:', err);
    res.status(500).json({ error: 'Something went wrong logging your water intake.' });
  }
});

// GET /api/hydration/today: today's progress toward the goal
router.get('/today', requireAuth, async (req, res) => {
  try {
    const user = await getUserOr404(req.userId, res);
    if (!user) return;

    const today = await getTodayForTimezone(user.timezone);
    const adj = await getHeatAdjustment(user);
    const consumedMl = await sumForDate(req.userId, today);
    res.json(summarize(user, adj, today, consumedMl));
  } catch (err) {
    console.error('Today error:', err);
    res.status(500).json({ error: "Something went wrong fetching today's progress." });
  }
});

// POST /api/hydration/heat-mode: body { mode: 'off' | 'manual' | 'auto', latitude?, longitude? }
// (The older { enabled: true/false } form is still accepted.)
router.post('/heat-mode', requireAuth, async (req, res) => {
  let { mode, enabled, latitude, longitude } = req.body;
  if (mode === undefined && typeof enabled === 'boolean') {
    mode = enabled ? 'manual' : 'off';
  }
  if (!['off', 'manual', 'auto'].includes(mode)) {
    return res.status(400).json({ error: "mode must be 'off', 'manual' or 'auto'." });
  }

  try {
    if (mode === 'auto') {
      const coords = cleanCoords(latitude, longitude);
      if (!coords) {
        return res.status(400).json({ error: 'A valid location is required for Auto mode.' });
      }
      await pool.query(
        'UPDATE users SET heat_mode = FALSE, heat_auto = TRUE, latitude = $1, longitude = $2 WHERE id = $3',
        [coords.latitude, coords.longitude, req.userId]
      );
    } else {
      // Off and Manual never keep a location on file.
      await pool.query(
        'UPDATE users SET heat_mode = $1, heat_auto = FALSE, latitude = NULL, longitude = NULL WHERE id = $2',
        [mode === 'manual', req.userId]
      );
    }
    res.json({ heatSetting: mode });
  } catch (err) {
    console.error('Heat mode error:', err);
    res.status(500).json({ error: 'Something went wrong updating your heat setting.' });
  }
});

// POST /api/hydration/location: refresh the stored location (only while Auto is on)
router.post('/location', requireAuth, async (req, res) => {
  const coords = cleanCoords(req.body.latitude, req.body.longitude);
  if (!coords) {
    return res.status(400).json({ error: 'A valid location is required.' });
  }

  try {
    await pool.query(
      'UPDATE users SET latitude = $1, longitude = $2 WHERE id = $3 AND heat_auto = TRUE',
      [coords.latitude, coords.longitude, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Location error:', err);
    res.status(500).json({ error: 'Something went wrong updating your location.' });
  }
});

// GET /api/hydration/history?days=7: daily totals for the streak chain
router.get('/history', requireAuth, async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 7, 365);

  try {
    const user = await getUserOr404(req.userId, res);
    if (!user) return;

    const today = await getTodayForTimezone(user.timezone);
    const adj = await getHeatAdjustment(user);

    const totalsResult = await pool.query(
      `SELECT logged_date::text AS date, SUM(amount_ml) AS total
       FROM hydration_logs
       WHERE user_id = $1 AND logged_date >= ($2::date - ($3 - 1))
       GROUP BY logged_date`,
      [req.userId, today, days]
    );
    const totalsMap = {};
    totalsResult.rows.forEach(r => { totalsMap[r.date] = Number(r.total); });

    const history = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(today, -i);
      const consumedMl = totalsMap[date] || 0;
      // The heat bonus only applies to today, so it never breaks past streak days.
      const goalMl = date === today ? user.daily_goal_ml + adj.bonusMl : user.daily_goal_ml;
      history.push({ date, consumedMl, goalMl, hitGoal: goalMl > 0 && consumedMl >= goalMl });
    }

    res.json({ history });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Something went wrong fetching your history.' });
  }
});

// GET /api/hydration/streak: current and longest streak
router.get('/streak', requireAuth, async (req, res) => {
  try {
    const user = await getUserOr404(req.userId, res);
    if (!user) return;

    const today = await getTodayForTimezone(user.timezone);
    const adj = await getHeatAdjustment(user);

    const logsResult = await pool.query(
      'SELECT logged_date::text AS date, SUM(amount_ml) AS total FROM hydration_logs WHERE user_id = $1 GROUP BY logged_date',
      [req.userId]
    );
    const totalsMap = {};
    logsResult.rows.forEach(r => { totalsMap[r.date] = Number(r.total); });

    const goalFor = (d) => (d === today ? user.daily_goal_ml + adj.bonusMl : user.daily_goal_ml);
    const hit = (d) => {
      const g = goalFor(d);
      return g > 0 && (totalsMap[d] || 0) >= g;
    };

    let offset = hit(today) ? 0 : 1;
    let current = 0;
    while (offset <= 3650) {
      if (hit(addDays(today, -offset))) {
        current++;
        offset++;
      } else break;
    }

    const hitDates = Object.keys(totalsMap).filter(hit).sort();
    let longest = 0, run = 0, prevDate = null;
    for (const d of hitDates) {
      run = (prevDate && addDays(prevDate, 1) === d) ? run + 1 : 1;
      longest = Math.max(longest, run);
      prevDate = d;
    }
    longest = Math.max(longest, current);

    res.json({ current, longest });
  } catch (err) {
    console.error('Streak error:', err);
    res.status(500).json({ error: 'Something went wrong calculating your streak.' });
  }
});

export default router;
