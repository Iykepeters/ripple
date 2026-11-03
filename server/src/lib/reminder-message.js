import { getTodayWeather, bonusForApparentTemp } from './weather.js';

// Builds the notification text for a due reminder.
// Only the FIRST reminder of a user's day carries the weather note, and only when
// Auto heat is on and today's heat adds to their goal. Anything else (cool day, weather
// service down, Manual or Off) gets the normal reminder, so a reminder never fails.
export async function buildReminderMessage(row) {
  const standard = {
    kind: 'standard',
    title: 'Ripple reminder',
    body: `It's ${row.time_of_day} — time for a glass of water 💧`
  };

  if (!row.is_first_of_day || !row.heat_auto || row.latitude == null || row.longitude == null) {
    return standard;
  }

  try {
    const weather = await getTodayWeather(Number(row.latitude), Number(row.longitude), row.timezone);
    if (!weather) return standard;

    const bonusMl = bonusForApparentTemp(weather.apparentMaxC);
    if (bonusMl <= 0) return standard;

    const goalMl = row.daily_goal_ml + bonusMl;
    return {
      kind: 'heat',
      title: 'Hot day ahead ☀️',
      body: `It feels like up to ${weather.apparentMaxC}°C today, so your goal is ${goalMl} ml. Start with a glass now 💧`
    };
  } catch {
    return standard;
  }
}