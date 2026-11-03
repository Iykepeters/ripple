import { useState, useEffect, useCallback } from 'react';

const KEY = 'ripple_theme';

function readSaved() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function save(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* private mode: ignore */ }
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B1A20' : '#0F4C5C');
}
function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);

  // Follow the device setting until the person picks a theme themselves.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => {
      if (readSaved()) return;
      const next = e.matches ? 'dark' : 'light';
      applyTheme(next);
      setTheme(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    save(next);
    applyTheme(next);
    setTheme(next);
  }, [theme]);

  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {isDark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
