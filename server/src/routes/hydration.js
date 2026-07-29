import express from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function getUserOr404(userId, res) {
  const result = await pool.query('SELECT timezone, daily_goal_ml FROM users WHERE id = $1', [userId]);
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

// POST /api/hydration/log — log an amount of water for today
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

    const sumResult = await pool.query(
      'SELECT COALESCE(SUM(amount_ml), 0) AS total FROM hydration_logs WHERE user_id = $1 AND logged_date = $2',
      [req.userId, today]
    );
    const consumedMl = Number(sumResult.rows[0].total);
    const goalMl = user.daily_goal_ml;
    const percent = goalMl > 0 ? Math.min(100, Math.round((consumedMl / goalMl) * 100)) : 0;

    res.status(201).json({ date: today, consumedMl, goalMl, percent });
  } catch (err) {
    console.error('Log error:', err);
    res.status(500).json({ error: 'Something went wrong logging your water intake.' });
  }
});

// GET /api/hydration/today — today's progress toward the goal
router.get('/today', requireAuth, async (req, res) => {
  try {
    const user = await getUserOr404(req.userId, res);
    if (!user) return;

    const today = await getTodayForTimezone(user.timezone);

    const sumResult = await pool.query(
      'SELECT COALESCE(SUM(amount_ml), 0) AS total FROM hydration_logs WHERE user_id = $1 AND logged_date = $2',
      [req.userId, today]
    );
    const consumedMl = Number(sumResult.rows[0].total);
    const goalMl = user.daily_goal_ml;
    const percent = goalMl > 0 ? Math.min(100, Math.round((consumedMl / goalMl) * 100)) : 0;

    res.json({ date: today, consumedMl, goalMl, percent });
  } catch (err) {
    console.error('Today error:', err);
    res.status(500).json({ error: "Something went wrong fetching today's progress." });
  }
});

// GET /api/hydration/history?days=7 — daily totals for the streak chain
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
      history.push({
        date,
        consumedMl,
        goalMl: user.daily_goal_ml,
        hitGoal: user.daily_goal_ml > 0 && consumedMl >= user.daily_goal_ml
      });
    }

    res.json({ history });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Something went wrong fetching your history.' });
  }
});

// GET /api/hydration/streak — current and longest streak
router.get('/streak', requireAuth, async (req, res) => {
  try {
    const user = await getUserOr404(req.userId, res);
    if (!user) return;

    const today = await getTodayForTimezone(user.timezone);
    const goal = user.daily_goal_ml;

    const logsResult = await pool.query(
      'SELECT logged_date::text AS date, SUM(amount_ml) AS total FROM hydration_logs WHERE user_id = $1 GROUP BY logged_date',
      [req.userId]
    );
    const totalsMap = {};
    logsResult.rows.forEach(r => { totalsMap[r.date] = Number(r.total); });

    const todayMl = totalsMap[today] || 0;
    let offset = goal > 0 && todayMl >= goal ? 0 : 1;
    let current = 0;
    while (offset <= 3650) {
      const ds = addDays(today, -offset);
      const ml = totalsMap[ds] || 0;
      if (goal > 0 && ml >= goal) {
        current++;
        offset++;
      } else break;
    }

    const hitDates = Object.keys(totalsMap).filter(d => goal > 0 && totalsMap[d] >= goal).sort();
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