import webpush from 'web-push';

webpush.setVapidDetails(
  process.env.VAPID_CONTACT_EMAIL || 'mailto:you@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export { webpush };