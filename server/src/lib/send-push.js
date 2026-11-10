import { webpush } from './webpush-config.js';
import { pool } from '../db/pool.js';

// Reminders: ask the push service to deliver immediately (urgency 'high' helps phones in
// battery-saving mode), drop the message if it can't be delivered within 30 minutes (a stale
// reminder is worse than none), and let a newer reminder replace an undelivered older one.
export const REMINDER_PUSH_OPTIONS = { TTL: 30 * 60, urgency: 'high', topic: 'ripple-reminder' };

// Test messages: short-lived, and they never replace a real reminder.
export const TEST_PUSH_OPTIONS = { TTL: 60, urgency: 'high' };

// Sends one notification to one saved subscription and reports what happened:
//   'sent'    delivered to the push service
//   'expired' the browser says this subscription is gone, so it is deleted
//   'failed'  a temporary problem (the subscription is kept so we can try again)
export async function sendPush(sub, message, options = REMINDER_PUSH_OPTIONS) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: message.title, body: message.body }),
      options
    );
    return 'sent';
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      return 'expired';
    }
    console.error('Push send error for subscription', sub.id, err.statusCode || '', err.message);
    return 'failed';
  }
}
