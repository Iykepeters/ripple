const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

let authToken = null;

export function setToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('ripple_token', token);
  } else {
    localStorage.removeItem('ripple_token');
  }
}

export function loadStoredToken() {
  authToken = localStorage.getItem('ripple_token');
  return authToken;
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // some responses may have no body
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  signup: (username, password, dailyGoalMl, timezone) =>
    request('/auth/signup', { method: 'POST', body: { username, password, dailyGoalMl, timezone }, auth: false }),
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: { username, password }, auth: false }),
  me: () => request('/auth/me'),
  updateMe: (patch) => request('/auth/me', { method: 'PATCH', body: patch }),

  logWater: (amountMl) => request('/hydration/log', { method: 'POST', body: { amountMl } }),
  today: () => request('/hydration/today'),
  history: (days = 7) => request(`/hydration/history?days=${days}`),
  streak: () => request('/hydration/streak'),

  listReminders: () => request('/reminders'),
  addReminder: (timeOfDay) => request('/reminders', { method: 'POST', body: { timeOfDay } }),
  deleteReminder: (id) => request(`/reminders/${id}`, { method: 'DELETE' }),

  getVapidPublicKey: () => request('/push/vapid-public-key', { auth: false }),
  subscribePush: (subscription) => request('/push/subscribe', { method: 'POST', body: subscription }),
  unsubscribePush: (endpoint) => request('/push/unsubscribe', { method: 'POST', body: { endpoint } }),
  testPush: () => request('/push/test', { method: 'POST' })
};