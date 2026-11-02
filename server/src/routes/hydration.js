import express from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Extra water (ml) added to today's goal while Heat mode is on.
// Placeholder default: worth validating with a health professional before promoting it.
const HEAT_BONUS_ML = 500;

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function getUserOr404(userId, res) {
  const result = await pool.query(
    'SELECT timezone, daily_goal_ml, heat_mode FROM users WHERE id = $1',
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

// Heat mode only raises TODAY's target, so turning it on never breaks past streak days.
function todaysGoal(user) {
  return user.daily_goal_ml + (user.heat_mode ? HEAT_BONUS_ML : 0);
}

function summarize(user, date, consumedMl) {
  const goalMl = todaysGoal(user);
  const percent = goalMl > 0 ? Math.min(100, Math.round((consumedMl / goalMl) * 100)) : 0;
  return { date, consumedMl, goalMl, percent, heatMode: user.heat_mode, heatBonusMl: HEAT_BONUS_ML };
}

async function sumForDate(userId, date) {
  const result = await pool.query(
    'SELECT COALESCE(SUM(amount_ml), 0) AS total FROM hydration_logs WHERE user_id = $1 AND logged_date = $2',
    [userId, date]
  );
  return Number(result.rows[0].total);
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

    const consumedMl = await sumForDate(req.userId, today);
    res.status(201).json(summarize(user, today, consumedMl));
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
    const consumedMl = await sumForDate(req.userId, today);
    res.json(summarize(user, today, consumedMl));
  } catch (err) {
    console.error('Today error:', err);
    res.status(500).json({ error: "Something went wrong fetching today's progress." });
  }
});

// POST /api/hydration/heat-mode: turn Heat mode on or off
router.post('/heat-mode', requireAuth, async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be true or false.' });
  }

  try {
    await pool.query('UPDATE users SET heat_mode = $1 WHERE id = $2', [enabled, req.userId]);
    res.json({ heatMode: enabled });
  } catch (err) {
    console.error('Heat mode error:', err);
    res.status(500).json({ error: 'Something went wrong updating Heat mode.' });
  }
});

// GET /api/hydration/history?days=7: daily totals for the streak chain
router.get('/history', requireAuth, async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 7, 365);

  try {
    const user = await getUserOr404(req.userId, res);
    if (!user) return;

    const today = await getTodayForTimezone(user.timezone);

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
      const goalMl = date === today ? todaysGoal(user) : user.daily_goal_ml;
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

    const logsResult = await pool.query(
      'SELECT logged_date::text AS date, SUM(amount_ml) AS total FROM hydration_logs WHERE user_id = $1 GROUP BY logged_date',
      [req.userId]
    );
    const totalsMap = {};
    logsResult.rows.forEach(r => { totalsMap[r.date] = Number(r.total); });

    const goalFor = (d) => (d === today ? todaysGoal(user) : user.daily_goal_ml);
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