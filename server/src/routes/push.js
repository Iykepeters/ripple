import express from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { webpush } from '../lib/webpush-config.js';
import { buildReminderMessage } from '../lib/reminder-message.js';

const router = express.Router();

// Public: the client needs this to subscribe
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Save (or update) this browser's push subscription for the logged-in user
router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Invalid subscription object.' });
  }

  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [req.userId, endpoint, keys.p256dh, keys.auth]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Something went wrong saving your subscription.' });
  }
});

// Remove a subscription (e.g. user turns alerts off)
router.post('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required.' });

  try {
    await pool.query(
      'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
      [endpoint, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).json({ error: 'Something went wrong removing your subscription.' });
  }
});

// Send a one-off test notification to every device this user has subscribed.
// With Auto heat on and a hot day, the test previews the real morning alert.
router.post('/test', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No push subscriptions found for this account yet.' });
    }

    const userResult = await pool.query(
      'SELECT timezone, daily_goal_ml, heat_auto, latitude, longitude FROM users WHERE id = $1',
      [req.userId]
    );
    const preview = await buildReminderMessage({
      ...userResult.rows[0],
      time_of_day: '',
      is_first_of_day: true
    });
    const message =
      preview.kind === 'heat'
        ? preview
        : {
            title: 'Ripple test notification',
            body: 'If you can see this, push notifications are working! 💧'
          };

    const payload = JSON.stringify({ title: message.title, body: message.body });

    const sendResults = await Promise.allSettled(
      result.rows.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    );

    const failures = sendResults.filter(r => r.status === 'rejected');
    res.json({ sent: sendResults.length - failures.length, failed: failures.length });
  } catch (err) {
    console.error('Test push error:', err);
    res.status(500).json({ error: 'Something went wrong sending the test notification.' });
  }
});

export default router;