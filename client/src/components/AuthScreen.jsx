import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';

export default function AuthScreen() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [marketing, setMarketing] = useState(false); // never pre-ticked
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isSignup = mode === 'signup';

  function switchMode() {
    setMode(isSignup ? 'login' : 'signup');
    setError('');
    setConfirm('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (isSignup) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isSignup) {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        await signup(username, password, email, marketing, timezone);
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-theme"><ThemeToggle /></div>
      <div className="auth-card">
        <div className="brand">
          <svg viewBox="0 0 24 24" fill="none" width="30" height="30">
            <path d="M12 2C12 2 5 11 5 15.5C5 19.09 8.13 22 12 22C15.87 22 19 19.09 19 15.5C19 11 12 2 12 2Z" fill="#2EC4B6" />
          </svg>
          <span>Ripple</span>
        </div>
        <p className="tag">Small sips, on schedule.</p>

        <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. amara"
              autoComplete="username"
              required
            />
          </div>

          {isSignup && (
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
              <div className="field-hint">Used for important messages about your account.</div>
            </div>
          )}

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
            />
            {isSignup && <div className="field-hint">At least 8 characters.</div>}
          </div>

          {isSignup && (
            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </div>
          )}

          {isSignup && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
              />
              <span>
                Send me hydration tips, product news and updates from Ripple by email.
                Optional. You can turn this off any time in Settings.
              </span>
            </label>
          )}

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Please wait…' : isSignup ? 'Sign up' : 'Log in'}
          </button>
        </form>

        <div className="switch-line">
          <span>{isSignup ? 'Already have an account?' : 'New to Ripple?'}</span>
          <button type="button" onClick={switchMode}>
            {isSignup ? 'Log in instead' : 'Create an account'}
          </button>
        </div>
      </div>
    </div>
  );
}
