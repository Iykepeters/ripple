import express from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/reminders: list this user's reminder times
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, to_char(time_of_day, 'HH24:MI') AS time_of_day
       FROM reminder_times WHERE user_id = $1 ORDER BY time_of_day`,
      [req.userId]
    );
    res.json({ reminders: result.rows });
  } catch (err) {
    console.error('List reminders error:', err);
    res.status(500).json({ error: 'Something went wrong fetching reminders.' });
  }
});

// POST /api/reminders: add a reminder time, e.g. { "timeOfDay": "08:00" }
router.post('/', requireAuth, async (req, res) => {
  const { timeOfDay } = req.body;
  if (typeof timeOfDay !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
    return res.status(400).json({ error: 'timeOfDay must be a valid time in HH:MM format.' });
  }

  try {
    // A time that has already passed today is marked as done for today, so adding it
    // doesn't fire an instant "late" notification. It starts counting tomorrow.
    const result = await pool.query(
      `INSERT INTO reminder_times (user_id, time_of_day, last_sent_on)
       SELECT u.id,
              $2::time,
              CASE WHEN $2::time <= (NOW() AT TIME ZONE u.timezone)::time
                   THEN (NOW() AT TIME ZONE u.timezone)::date END
         FROM users u
        WHERE u.id = $1
       ON CONFLICT (user_id, time_of_day) DO NOTHING
       RETURNING id, to_char(time_of_day, 'HH24:MI') AS time_of_day`,
      [req.userId, timeOfDay]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'That reminder time already exists.' });
    }
    res.status(201).json({ reminder: result.rows[0] });
  } catch (err) {
    console.error('Add reminder error:', err);
    res.status(500).json({ error: 'Something went wrong adding the reminder.' });
  }
});

// DELETE /api/reminders/:id: remove one of this user's reminder times
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid reminder id.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM reminder_times WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reminder not found.' });
    }
    res.json({ deleted: true, id });
  } catch (err) {
    console.error('Delete reminder error:', err);
    res.status(500).json({ error: 'Something went wrong deleting the reminder.' });
  }
});

export default router;
