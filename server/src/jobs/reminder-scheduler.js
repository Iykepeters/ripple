import cron from 'node-cron';
import { pool } from '../db/pool.js';
import { webpush } from '../lib/webpush-config.js';
import { buildReminderMessage } from '../lib/reminder-message.js';

async function sendRemindersDueNow() {
  try {
    const { rows } = await pool.query(`
      SELECT rt.id AS reminder_id,
             u.id AS user_id,
             u.timezone,
             u.daily_goal_ml,
             u.heat_auto,
             u.latitude,
             u.longitude,
             to_char(rt.time_of_day, 'HH24:MI') AS time_of_day,
             rt.time_of_day = (
               SELECT MIN(r2.time_of_day) FROM reminder_times r2 WHERE r2.user_id = u.id
             ) AS is_first_of_day
      FROM reminder_times rt
      JOIN users u ON u.id = rt.user_id
      WHERE to_char((NOW() AT TIME ZONE u.timezone), 'HH24:MI') = to_char(rt.time_of_day, 'HH24:MI')
    `);

    if (rows.length === 0) return;

    for (const row of rows) {
      const subsResult = await pool.query(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
        [row.user_id]
      );

      if (subsResult.rows.length === 0) continue;

      const message = await buildReminderMessage(row);
      const payload = JSON.stringify({ title: message.title, body: message.body });

      for (const sub of subsResult.rows) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            // Subscription expired or the user unsubscribed on the browser side: clean it up
            await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
          } else {
            console.error('Push send error for subscription', sub.id, err.message);
          }
        }
      }
    }

    console.log(`Reminder check: ${rows.length} due reminder(s) processed at`, new Date().toISOString());
  } catch (err) {
    console.error('Reminder scheduler error:', err);
  }
}

export function startReminderScheduler() {
  // Runs at the top of every minute
  cron.schedule('* * * * *', sendRemindersDueNow);
  console.log('Reminder scheduler started (checks every minute).');
}