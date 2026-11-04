import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const MIN_GOAL_ML = 300;
const MAX_GOAL_ML = 6000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_COLUMNS = 'id, username, email, marketing_opt_in, daily_goal_ml, timezone, created_at';

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    marketingOptIn: row.marketing_opt_in,
    dailyGoalMl: row.daily_goal_ml,
    timezone: row.timezone,
    createdAt: row.created_at
  };
}

// Returns a trimmed, lower-cased email, or null if it isn't a plausible address.
function cleanEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

router.post('/signup', async (req, res) => {
  const { username, password, email, marketingOptIn, timezone } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const cleanedEmail = cleanEmail(email);
  if (!cleanedEmail) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  // Marketing consent must be an explicit "true". It is never assumed.
  const wantsMarketing = marketingOptIn === true;

  try {
    const nameTaken = await pool.query('SELECT 1 FROM users WHERE username = $1', [cleanUsername]);
    if (nameTaken.rows.length > 0) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    const emailTaken = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [cleanedEmail]);
    if (emailTaken.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists. Try logging in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const tz = typeof timezone === 'string' && timezone.length > 0 ? timezone : 'UTC';

    // The daily goal is not collected here: it defaults to 2000 ml and is set on the dashboard.
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, timezone, email, marketing_opt_in, marketing_consent_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${USER_COLUMNS}`,
      [cleanUsername, passwordHash, tz, cleanedEmail, wantsMarketing, wantsMarketing ? new Date() : null]
    );

    const user = result.rows[0];
    res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That username or email is already in use.' });
    }
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

// Login uses only a username and password.
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const cleanUsername = String(username).trim().toLowerCase();

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

    res.json({ token: signToken(user.id), user: publicUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong logging you in.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Something went wrong fetching your profile.' });
  }
});

router.patch('/me', requireAuth, async (req, res) => {
  const { dailyGoalMl, timezone, email, marketingOptIn } = req.body;
  const updates = [];
  const values = [];
  let i = 1;

  if (dailyGoalMl !== undefined) {
    if (!Number.isFinite(dailyGoalMl) || dailyGoalMl < MIN_GOAL_ML || dailyGoalMl > MAX_GOAL_ML) {
      return res.status(400).json({ error: `Daily goal must be between ${MIN_GOAL_ML} and ${MAX_GOAL_ML} ml.` });
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
  if (email !== undefined) {
    const cleaned = cleanEmail(email);
    if (!cleaned) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    updates.push(`email = $${i++}`);
    values.push(cleaned);
  }
  if (marketingOptIn !== undefined) {
    if (typeof marketingOptIn !== 'boolean') {
      return res.status(400).json({ error: 'marketingOptIn must be true or false.' });
    }
    updates.push(`marketing_opt_in = $${i++}`);
    values.push(marketingOptIn);
    // Records when the choice was last changed (given or withdrawn).
    updates.push('marketing_consent_at = NOW()');
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  try {
    // Product-update emails need an address on file (already saved, or sent in this request).
    if (marketingOptIn === true && email === undefined) {
      const current = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId]);
      if (!current.rows[0] || !current.rows[0].email) {
        return res.status(400).json({ error: 'Add an email address before turning on product updates.' });
      }
    }

    values.push(req.userId);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING ${USER_COLUMNS}`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That email is already used by another account.' });
    }
    console.error('Update me error:', err);
    res.status(500).json({ error: 'Something went wrong updating your profile.' });
  }
});

export default router;