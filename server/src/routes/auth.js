import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    dailyGoalMl: row.daily_goal_ml,
    timezone: row.timezone,
    createdAt: row.created_at
  };
}

router.post('/signup', async (req, res) => {
  const { username, password, dailyGoalMl, timezone } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const cleanUsername = username.trim().toLowerCase();

  try {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [cleanUsername]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const goal = Number.isFinite(dailyGoalMl) && dailyGoalMl >= 300 ? dailyGoalMl : 2000;
    const tz = typeof timezone === 'string' && timezone.length > 0 ? timezone : 'UTC';

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, daily_goal_ml, timezone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, daily_goal_ml, timezone, created_at`,
      [cleanUsername, passwordHash, goal, tz]
    );

    const user = result.rows[0];
    const token = signToken(user.id);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const cleanUsername = username.trim().toLowerCase();

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [cleanUsername]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Username or password is incorrect.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Username or password is incorrect.' });
    }

    const token = signToken(user.id);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong logging you in.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, daily_goal_ml, timezone, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Something went wrong fetching your profile.' });
  }
});

router.patch('/me', requireAuth, async (req, res) => {
  const { dailyGoalMl, timezone } = req.body;
  const updates = [];
  const values = [];
  let i = 1;

  if (dailyGoalMl !== undefined) {
    if (!Number.isFinite(dailyGoalMl) || dailyGoalMl < 300) {
      return res.status(400).json({ error: 'dailyGoalMl must be at least 300.' });
    }
    updates.push(`daily_goal_ml = $${i++}`);
    values.push(Math.round(dailyGoalMl));
  }
  if (timezone !== undefined) {
    if (typeof timezone !== 'string' || timezone.length === 0) {
      return res.status(400).json({ error: 'timezone must be a non-empty string.' });
    }
    updates.push(`timezone = $${i++}`);
    values.push(timezone);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Provide dailyGoalMl and/or timezone to update.' });
  }

  values.push(req.userId);

  try {
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, username, daily_goal_ml, timezone, created_at`,
      values
    );
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error('Update me error:', err);
    res.status(500).json({ error: 'Something went wrong updating your profile.' });
  }
});

export default router;