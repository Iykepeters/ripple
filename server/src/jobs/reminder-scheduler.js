import cron from 'node-cron';
import { pool } from '../db/pool.js';
import { buildReminderMessage } from '../lib/reminder-message.js';
import { sendPush, REMINDER_PUSH_OPTIONS } from '../lib/send-push.js';

// A reminder still goes out if the server was asleep or restarting at its exact minute,
// as long as it is at most this many minutes late. Each reminder fires once per day.
export const CATCH_UP_MINUTES = 20;

// Finds every reminder that is due (in its owner's local time), and marks it as sent for
// today in the same statement. Marking first means two overlapping runs, or two server
// instances during a deploy, can never send the same reminder twice.
export async function claimDueReminders(db = pool) {
  const { rows } = await db.query(
    `UPDATE reminder_times rt
        SET last_sent_on = (NOW() AT TIME ZONE u.timezone)::date
       FROM users u
      WHERE u.id = rt.user_id
        AND rt.last_sent_on IS DISTINCT FROM (NOW() AT TIME ZONE u.timezone)::date
        AND (EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.timezone)) * 60
             + EXTRACT(MINUTE FROM (NOW() AT TIME ZONE u.timezone)))
          - (EXTRACT(HOUR FROM rt.time_of_day) * 60 + EXTRACT(MINUTE FROM rt.time_of_day))
            BETWEEN 0 AND $1
    RETURNING rt.id AS reminder_id,
              u.id AS user_id,
              u.timezone,
              u.daily_goal_ml,
              u.heat_auto,
              u.latitude,
              u.longitude,
              to_char(rt.time_of_day, 'HH24:MI') AS time_of_day,
              rt.time_of_day = (
                SELECT MIN(r2.time_of_day) FROM reminder_times r2 WHERE r2.user_id = u.id
              ) AS is_first_of_day`,
    [CATCH_UP_MINUTES]
  );
  return rows;
}

async function sendRemindersDueNow() {
  try {
    const due = await claimDueReminders();
    if (due.length === 0) return;

    for (const row of due) {
      const subsResult = await pool.query(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
        [row.user_id]
      );
      if (subsResult.rows.length === 0) continue;

      const message = await buildReminderMessage(row);
      const results = await Promise.all(
        subsResult.rows.map((sub) => sendPush(sub, message, REMINDER_PUSH_OPTIONS))
      );

      // Every attempt failed for a temporary reason: release the reminder so the next
      // run (while it is still inside the catch-up window) tries again.
      if (!results.includes('sent') && results.includes('failed')) {
        await pool.query('UPDATE reminder_times SET last_sent_on = NULL WHERE id = $1', [row.reminder_id]);
      }
    }

    console.log(`Reminder check: ${due.length} due reminder(s) processed at`, new Date().toISOString());
  } catch (err) {
    console.error('Reminder scheduler error:', err);
  }
}

export function startReminderScheduler() {
  // Runs at the top of every minute
  cron.schedule('* * * * *', sendRemindersDueNow);
  console.log(`Reminder scheduler started (checks every minute, ${CATCH_UP_MINUTES}-minute catch-up).`);
}
