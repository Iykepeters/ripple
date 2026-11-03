import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';

export default function AuthScreen() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [goal, setGoal] = useState(2000);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        await signup(username, password, Number(goal), timezone);
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

        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. amara"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {mode === 'signup' && (
            <div className="field">
              <label htmlFor="goal">Daily hydration goal (ml)</label>
              <input
                id="goal"
                type="number"
                min="500"
                step="100"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>
          )}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </form>

        <div className="switch-line">
          <span>{mode === 'login' ? 'New to Ripple?' : 'Already have an account?'}</span>
          <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Create an account' : 'Log in instead'}
          </button>
        </div>
      </div>
    </div>
  );
}54