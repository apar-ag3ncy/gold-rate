# Chheda Jewellers – Gold Rate Automation

Admin enters the daily gold rate → approves → the system sends it automatically at the scheduled time
(Instagram Feed/Story + WhatsApp opted-in customers; staff 1-tap share for Instagram Broadcast & WhatsApp Channel).

**Current status: Phase 4A done** (login, rate entry, validation, approval, branded image preview, caption template, Test Send, scheduler worker with alerts, official Instagram + WhatsApp publishers, webhooks, encrypted subscribers, Connections page). Publishing stays in DRY_RUN until Meta credentials are entered – see the go-live checklist in `docs/PROGRESS.md`. See `docs/PROGRESS.md`.

## Requirements
- Node.js 20+
- MongoDB 7 (local via Docker, or MongoDB Atlas)

## First-time setup
```bash
npm install
cp .env.example .env              # then fill in values
docker compose up -d              # local MongoDB (skip if using Atlas)
npm run seed                      # creates the first admin from SEED_ADMIN_* in .env
```
Password rule: 10+ characters with upper-case, lower-case and a number. Remove `SEED_ADMIN_PASSWORD` from `.env` after seeding.

## Run (two terminals)
```bash
npm run dev:api     # http://localhost:4000  (health: /health)
npm run dev:web     # http://localhost:3000  → log in
npm run dev:worker  # scheduler: sends the approved rate at the configured time (DRY_RUN logs only)
```

## Tests
```bash
npm test            # shared validation + API integration tests (in-memory MongoDB)
npm run typecheck
npm run build:web
```
Rendered images are written to `MEDIA_DIR` (default `./uploads`, git-ignored) and served at `http://localhost:4000/media/…`.

## Layout
```
apps/api          Express API (auth, rates, settings, audit, preview, test send, deliveries)
apps/api/assets   Bundled fonts (SIL OFL) used by the creative renderer
apps/web          Next.js admin dashboard
apps/worker       Scheduler worker (node-cron, Asia/Kolkata, Mongo job lock)
packages/shared   Validation rules + types shared by API and web
docs/             Spec, phases, progress
```

## Key rules (see CLAUDE.md)
- The admin-entered rate is published exactly as typed – nothing is calculated or changed.
- If today's rate is not approved, nothing is sent and the admin is alerted.
- Official Meta APIs only. `DRY_RUN=true` until real credentials are added.
