import express from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { buildReminderMessage } from '../lib/reminder-message.js';
import { sendPush, TEST_PUSH_OPTIONS } from '../lib/send-push.js';

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

// Does the server have this device's subscription saved for the logged-in user?
// The dashboard uses this so the alerts toggle always shows the truth.
router.post('/status', requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'endpoint is required.' });
  }

  try {
    const result = await pool.query(
      'SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
      [endpoint, req.userId]
    );
    res.json({ subscribed: result.rows.length > 0 });
  } catch (err) {
    console.error('Push status error:', err);
    res.status(500).json({ error: 'Something went wrong checking your alert status.' });
  }
});

// Remove a subscription (e.g. user turns alerts off, or logs out)
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
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
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

    const outcomes = await Promise.all(
      result.rows.map((sub) => sendPush(sub, message, TEST_PUSH_OPTIONS))
    );

    res.json({
      sent: outcomes.filter((o) => o === 'sent').length,
      expired: outcomes.filter((o) => o === 'expired').length,
      failed: outcomes.filter((o) => o === 'failed').length
    });
  } catch (err) {
    console.error('Test push error:', err);
    res.status(500).json({ error: 'Something went wrong sending the test notification.' });
  }
});

export default router;
