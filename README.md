# Ripple — hydration tracker

Monorepo: `/server` (Node/Express + Postgres API) and `/client` (React + Vite PWA).

## Getting started

### Server
```
cd server
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, VAPID keys
npm install
npm run dev                # http://localhost:4000
```

### Client
```
cd client
npm install
npm run dev                # http://localhost:5173
```

## Build order
1. Repo scaffolding (this step)
2. Database schema (Postgres)
3. Auth (bcrypt + JWT)
4. Core API (hydration logs, reminders)
5. React frontend wired to the API
6. Web push (VAPID, service worker, subscriptions)
7. Reminder scheduler (node-cron)
8. PWA manifest + install support
9. Deployment
