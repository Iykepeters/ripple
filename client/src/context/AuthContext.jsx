import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setToken, loadStoredToken } from '../api.js';
import { detachPush } from '../push.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = loadStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api.me()
      .then(data => setUser(data.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const signup = useCallback(async (username, password, email, marketingOptIn, timezone) => {
    const data = await api.signup(username, password, email, marketingOptIn, timezone);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api.login(username, password);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    // Stop this device receiving the account's reminders. Never block logging out if it fails.
    try {
      await detachPush(api);
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await api.me();
    setUser(data.user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
