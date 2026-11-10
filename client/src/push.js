// Browser-side push helpers. The key idea: the dashboard's toggle must always reflect what
// is really true on this device, and a subscription that has lapsed should be quietly
// re-created without the person having to notice.

const WANTED_PREFIX = 'ripple_alerts_';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// "This person turned alerts on for this device." Stored per account, so one person's
// choice never switches alerts on for someone else who logs in on the same browser.
function setWanted(userId, on) {
  try {
    if (on) localStorage.setItem(WANTED_PREFIX + userId, '1');
    else localStorage.removeItem(WANTED_PREFIX + userId);
  } catch {
    /* private mode: ignore */
  }
}
function isWanted(userId) {
  try {
    return localStorage.getItem(WANTED_PREFIX + userId) === '1';
  } catch {
    return false;
  }
}

function supported() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser.');
  }
  return navigator.serviceWorker.register('/sw.js');
}

// Returns 'unsupported' | 'blocked' | 'off' | 'on' | 'unknown' (couldn't reach the server).
export async function getPushStatus(api) {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';

  const subscription = await currentSubscription();
  if (!subscription) return 'off';

  try {
    const { subscribed } = await api.pushStatus(subscription.endpoint);
    return subscribed ? 'on' : 'off';
  } catch {
    return 'unknown';
  }
}

export async function enablePush(api, userId) {
  if (!supported()) {
    throw new Error('Push notifications are not supported in this browser.');
  }

  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    throw new Error('Notifications are blocked for Ripple. Allow them in your browser or phone settings, then try again.');
  }
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  await registerServiceWorker();
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.getVapidPublicKey();

  // Always start from a fresh subscription: an older one may be stale or expired.
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    try {
      await existing.unsubscribe();
    } catch {
      /* ignore */
    }
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  await api.subscribePush(subscription.toJSON());
  setWanted(userId, true);
  return subscription;
}

export async function disablePush(api, userId) {
  setWanted(userId, false);
  if (!('serviceWorker' in navigator)) return;

  const subscription = await currentSubscription();
  if (!subscription) return;
  try {
    await api.unsubscribePush(subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}

// Used on logout: stop this device receiving the account's reminders, but keep the
// person's choice remembered so alerts come back by themselves when they log in again.
export async function detachPush(api) {
  if (!('serviceWorker' in navigator)) return;
  const subscription = await currentSubscription();
  if (subscription) await api.unsubscribePush(subscription.endpoint);
}

// Called whenever the dashboard opens or the tab becomes visible again. Reports the real
// status, and if this person had alerts on but the subscription has lapsed (expired,
// cleared by the browser, or removed at logout) it quietly sets it up again.
export async function syncPush(api, userId) {
  const status = await getPushStatus(api);
  if (status !== 'off') return status;

  if (isWanted(userId) && Notification.permission === 'granted') {
    try {
      await enablePush(api, userId);
      return 'on';
    } catch {
      return 'off';
    }
  }
  return 'off';
}
