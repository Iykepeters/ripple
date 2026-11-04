import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api.js';
import { enablePush, disablePush } from '../push.js';
import { getCoords } from '../location.js';
import ThemeToggle from './ThemeToggle.jsx';

const MIN_GOAL_ML = 300;
const MAX_GOAL_ML = 6000;

function fmtTime12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Dashboard() {
  const { user, logout, refreshUser } = useAuth();

  const [today, setToday] = useState(null);
  const [history, setHistory] = useState([]);
  const [streak, setStreak] = useState({ current: 0, longest: 0 });
  const [reminders, setReminders] = useState([]);
  const [customMl, setCustomMl] = useState('');
  const [newTime, setNewTime] = useState('15:00');
  const [goalDraft, setGoalDraft] = useState(user?.dailyGoalMl || 2000);
  const [toast, setToast] = useState('');
  const [loadingAll, setLoadingAll] = useState(true);
  const [notifOn, setNotifOn] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [heatBusy, setHeatBusy] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  }, []);

  const reloadProgress = useCallback(async () => {
    const [t, h, s] = await Promise.all([api.today(), api.history(7), api.streak()]);
    setToday(t);
    setHistory(h.history);
    setStreak(s);
  }, []);

  const loadAll = useCallback(async () => {
    const [t, h, s, r] = await Promise.all([
      api.today(),
      api.history(7),
      api.streak(),
      api.listReminders()
    ]);
    setToday(t);
    setHistory(h.history);
    setStreak(s);
    setReminders(r.reminders);
  }, []);

  useEffect(() => {
    loadAll().finally(() => setLoadingAll(false));
  }, [loadAll]);

  useEffect(() => {
    if (user) setGoalDraft(user.dailyGoalMl);
  }, [user]);

  // While Auto heat is on, quietly refresh the stored location (no prompt if already allowed).
  const heatSetting = today?.heatSetting;
  useEffect(() => {
    if (heatSetting !== 'auto') return;
    getCoords({ maximumAge: 6 * 60 * 60 * 1000, timeout: 8000 })
      .then((coords) => api.updateLocation(coords))
      .catch(() => {});
  }, [heatSetting]);

  async function addWater(ml) {
    try {
      const result = await api.logWater(ml);
      setToday(result);
      const [h, s] = await Promise.all([api.history(7), api.streak()]);
      setHistory(h.history);
      setStreak(s);
      showToast(`+${ml} ml logged 💧`);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleCustomAdd() {
    const v = parseInt(customMl, 10);
    if (v > 0) {
      await addWater(v);
      setCustomMl('');
    }
  }

  async function handleAddReminder() {
    try {
      await api.addReminder(newTime);
      const r = await api.listReminders();
      setReminders(r.reminders);
      showToast(`Reminder added for ${fmtTime12(newTime)}`);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleRemoveReminder(id) {
    await api.deleteReminder(id);
    const r = await api.listReminders();
    setReminders(r.reminders);
  }

  async function saveGoal(next) {
    try {
      setGoalDraft(next);
      await api.updateMe({ dailyGoalMl: next });
      await refreshUser();
      await reloadProgress();
    } catch (err) {
      setGoalDraft(user.dailyGoalMl);
      showToast(err.message);
    }
  }

  function handleGoalChange(delta) {
    const current = Number(goalDraft) || 2000;
    return saveGoal(Math.max(MIN_GOAL_ML, Math.min(MAX_GOAL_ML, current + delta)));
  }

  // Called when the person finishes typing their own goal.
  function handleGoalCommit() {
    const n = Math.round(Number(goalDraft));
    if (!Number.isFinite(n) || n < MIN_GOAL_ML || n > MAX_GOAL_ML) {
      setGoalDraft(user.dailyGoalMl);
      showToast(`Pick a goal between ${MIN_GOAL_ML} and ${MAX_GOAL_ML} ml.`);
      return;
    }
    if (n === user.dailyGoalMl) {
      setGoalDraft(n);
      return;
    }
    return saveGoal(n);
  }

  async function handleSaveEmail() {
    try {
      await api.updateMe({ email: emailDraft });
      await refreshUser();
      setEmailDraft('');
      showToast('Email saved ✉️');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleToggleMarketing() {
    const turningOn = !user.marketingOptIn;
    try {
      await api.updateMe({ marketingOptIn: turningOn });
      await refreshUser();
      showToast(turningOn ? "You'll get Ripple product updates" : 'Product update emails turned off');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleSetHeat(mode) {
    if (heatBusy || mode === today.heatSetting) return;
    setHeatBusy(true);
    try {
      const coords = mode === 'auto' ? await getCoords() : {};
      await api.setHeatMode(mode, coords);
      await reloadProgress();
      showToast(
        mode === 'auto'
          ? 'Auto heat adjustment on ☀️'
          : mode === 'manual'
            ? 'Heat mode on ☀️'
            : 'Heat adjustment off'
      );
    } catch (err) {
      showToast(err.message);
    } finally {
      setHeatBusy(false);
    }
  }

  async function handleToggleNotif() {
    setNotifBusy(true);
    try {
      if (!notifOn) {
        await enablePush(api);
        setNotifOn(true);
        showToast('Browser alerts turned on 🔔');
      } else {
        await disablePush(api);
        setNotifOn(false);
        showToast('Browser alerts turned off');
      }
    } catch (err) {
      showToast(err.message);
    } finally {
      setNotifBusy(false);
    }
  }

  async function handleTestNotif() {
    try {
      const result = await api.testPush();
      showToast(`Test sent to ${result.sent} device${result.sent === 1 ? '' : 's'}`);
    } catch (err) {
      showToast(err.message);
    }
  }

  if (loadingAll || !today) {
    return <div className="loading-shell">Loading your dashboard…</div>;
  }

  const percent = today.percent;
  const now = nowHHMM();
  const sortedReminders = [...reminders].sort((a, b) => a.time_of_day.localeCompare(b.time_of_day));
  const isAuto = today.heatSetting === 'auto';
  const showTips = today.heatSetting === 'manual' || today.heatBonusMl > 0;

  return (
    <div>
      <div className="topbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
            <path d="M12 2C12 2 5 11 5 15.5C5 19.09 8.13 22 12 22C15.87 22 19 19.09 19 15.5C19 11 12 2 12 2Z" fill="#2EC4B6" />
          </svg>
          <span>Ripple</span>
        </div>
        <div className="top-right">
          <ThemeToggle />
          <div className="streak-pill">🔥 {streak.current} day streak</div>
          <div className="user-chip">{user.username}</div>
          <button className="logout-btn" onClick={logout}>Log out</button>
        </div>
      </div>

      <main>
        <div className="hero-row">
          <div className="gauge-wrap">
            <div className="droplet-mask">
              <div className="wave-fill" style={{ height: `${percent}%` }}>
                <div className="body" />
              </div>
            </div>
            <div className="gauge-readout">
              <div className="gauge-pct"><span>{percent}</span><span className="pct-sign">%</span></div>
              <div className="gauge-sub">{today.consumedMl} / {today.goalMl} ml today</div>
            </div>
          </div>

          <div className="hero-copy">
            <h1>
              Today's hydration
              {today.heatMode && (
                <span className="heat-badge">
                  {isAuto
                    ? `☀️ Auto${today.heatBonusMl > 0 ? ` +${today.heatBonusMl} ml` : ''}`
                    : '☀️ Heat mode'}
                </span>
              )}
            </h1>
            <p>Log what you drink as you go — the droplet fills up as you get closer to today's goal.</p>
            <div className="quick-add">
              <button className="qa-btn" onClick={() => addWater(200)}>+200 ml</button>
              <button className="qa-btn" onClick={() => addWater(300)}>+300 ml</button>
              <button className="qa-btn" onClick={() => addWater(500)}>+500 ml</button>
              <div className="qa-custom">
                <input
                  type="number"
                  placeholder="ml"
                  min="10"
                  value={customMl}
                  onChange={(e) => setCustomMl(e.target.value)}
                />
                <button className="qa-btn" onClick={handleCustomAdd}>Add</button>
              </div>
            </div>
          </div>
        </div>

        {today.heatMode && (
          <section className="panel heat-panel">
            <div className="panel-head">
              <h2>{isAuto ? "Today's heat in your area" : 'Staying safe in the heat'}</h2>
              <span className="eyebrow">{isAuto ? 'Weather-adjusted' : "Based on NEMA's advisory"}</span>
            </div>

            {isAuto && (
              <p className="heat-weather">
                {today.weather ? (
                  <>
                    It feels like up to <b>{today.weather.apparentMaxC}°C</b> today, so Ripple{' '}
                    {today.heatBonusMl > 0 ? (
                      <>added <b>{today.heatBonusMl} ml</b> to</>
                    ) : (
                      'kept'
                    )}{' '}
                    your goal.
                  </>
                ) : (
                  "Couldn't reach the weather service right now, so your base goal is unchanged."
                )}
              </p>
            )}

            {showTips && (
              <ul className="heat-tips">
                <li>Limit time outdoors between 11am and 4pm. Plan tasks for early morning or late evening.</li>
                <li>Drink clean water regularly, and check on children, the elderly and others who may struggle in the heat.</li>
                <li>Seek medical help early if you feel unwell. Ripple is a reminder tool, not medical care.</li>
              </ul>
            )}

            <div className="heat-note">
              Follow NiMet and NEMA for official weather alerts.
              {isAuto && today.weather && (
                <>
                  {' '}Weather data by{' '}
                  <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a>.
                </>
              )}
            </div>
          </section>
        )}

        <div className="grid-two">
          <section className="panel">
            <div className="panel-head">
              <h2>Tide schedule</h2>
              <span className="eyebrow">{sortedReminders.length} reminder{sortedReminders.length === 1 ? '' : 's'}</span>
            </div>
            <ul className="tide-list">
              {sortedReminders.map((r) => (
                <li className="tide-row" key={r.id}>
                  <span className="tide-time">{r.time_of_day}</span>
                  <div className={`tide-status ${r.time_of_day <= now ? 'done' : 'upcoming'}`} />
                  <span className="tide-label">
                    {r.time_of_day <= now
                      ? <><b>Passed</b> — hope you had a sip</>
                      : <>Coming up at <b>{fmtTime12(r.time_of_day)}</b></>}
                  </span>
                  <button className="tide-remove" onClick={() => handleRemoveReminder(r.id)}>✕</button>
                </li>
              ))}
            </ul>
            <div className="tide-add">
              <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              <button onClick={handleAddReminder}>Add reminder</button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Your streak</h2>
              <span className="eyebrow">Last 7 days</span>
            </div>
            <div className="chain-row">
              {history.map((day) => {
                const d = new Date(day.date + 'T00:00:00');
                const label = d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
                return (
                  <div className="chain-day" key={day.date}>
                    <div className={`chain-dot ${day.hitGoal ? 'hit' : ''}`} title={`${day.date}: ${day.consumedMl}ml`} />
                    <div className="chain-label">{label}</div>
                  </div>
                );
              })}
            </div>
            <div className="stat-row">
              <div className="stat">
                <div className="num">{streak.current}</div>
                <div className="lab">Current streak</div>
              </div>
              <div className="stat">
                <div className="num">{streak.longest}</div>
                <div className="lab">Longest streak</div>
              </div>
            </div>
          </section>
        </div>

        <section className="panel">
          <div className="panel-head"><h2>Settings</h2></div>

          <div className="settings-row">
            <div>
              <div className="label">Daily goal</div>
              <div className="desc">How much water counts as a completed day. Type your own number, or use − and +.</div>
            </div>
            <div className="goal-control">
              <button onClick={() => handleGoalChange(-100)} aria-label="Lower goal by 100 ml">−</button>
              <input
                className="goal-input"
                type="number"
                inputMode="numeric"
                min={MIN_GOAL_ML}
                max={MAX_GOAL_ML}
                step="50"
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                onBlur={handleGoalCommit}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                aria-label="Daily goal in millilitres"
              />
              <span className="goal-unit">ml</span>
              <button onClick={() => handleGoalChange(100)} aria-label="Raise goal by 100 ml">+</button>
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="label">Heat adjustment ☀️</div>
              <div className="desc">
                Manual adds a fixed amount. Auto uses today's weather where you are. Your location is rounded to about 1 km, used only for this, and deleted when you turn Auto off.
              </div>
            </div>
            <div className="segmented" role="group" aria-label="Heat adjustment">
              {[
                ['off', 'Off'],
                ['manual', `+${today.manualBonusMl} ml`],
                ['auto', 'Auto']
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={today.heatSetting === value ? 'active' : ''}
                  onClick={() => handleSetHeat(value)}
                  disabled={heatBusy}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-note">
            Weather-based amounts are a rough guide. If your doctor has set a fluid limit for you, follow that instead of any goal shown here.
          </div>

          <div className="settings-row">
            <div>
              <div className="label">Browser alerts</div>
              <div className="desc">Get a real push notification at each scheduled time — works even if this tab is closed.</div>
            </div>
            <button
              className={`toggle ${notifOn ? 'on' : ''}`}
              onClick={handleToggleNotif}
              disabled={notifBusy}
              aria-label="Toggle browser alerts"
            />
          </div>
          {notifOn && (
            <div className="settings-row">
              <div>
                <div className="label">Send a test notification</div>
                <div className="desc">Confirms delivery is working right now.</div>
              </div>
              <button className="qa-btn" onClick={handleTestNotif}>Send test</button>
            </div>
          )}

          <div className="settings-row">
            <div>
              <div className="label">Email</div>
              <div className="desc">
                {user.email ? user.email : 'Add an email so we can reach you about your account.'}
              </div>
            </div>
            {!user.email && (
              <div className="email-add">
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  aria-label="Email address"
                />
                <button className="qa-btn" onClick={handleSaveEmail}>Save</button>
              </div>
            )}
          </div>

          {user.email && (
            <div className="settings-row">
              <div>
                <div className="label">Product updates by email</div>
                <div className="desc">Hydration tips and news from Ripple. You can turn this off any time.</div>
              </div>
              <button
                className={`toggle ${user.marketingOptIn ? 'on' : ''}`}
                onClick={handleToggleMarketing}
                aria-label="Toggle product update emails"
              />
            </div>
          )}
        </section>
      </main>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
