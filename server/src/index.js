import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import hydrationRoutes from './routes/hydration.js';
import reminderRoutes from './routes/reminders.js';
import pushRoutes from './routes/push.js';
import { startReminderScheduler } from './jobs/reminder-scheduler.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'ripple-server', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/hydration', hydrationRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/push', pushRoutes);

app.listen(PORT, () => {
  console.log(`Ripple server listening on http://localhost:${PORT}`);
});

startReminderScheduler();