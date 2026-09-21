# Chheda Jewellers – Gold Rate Automation

Admin enters the daily gold rate (or takes the IBJA benchmark) → approves → the system posts it automatically at the scheduled time
(Instagram Feed/Story + WhatsApp opted-in customers).

**Current status: all 7 phases done** – see `docs/DEPLOYMENT.md`, `docs/GO-LIVE.md`, `docs/RUNBOOK.md`.

The dashboard has two screens: **Rate** (24K / 22K / 18K per gram, IBJA pre-fill, save → approve, post preview) and **Automation** (on/off, send time, channels, IBJA auto-draft, Instagram/WhatsApp connections, WhatsApp recipients). Under the hood: blocking validation, branded image rendering, scheduler worker with alerts, official Instagram + WhatsApp publishers, webhooks, encrypted subscribers and tokens. Publishing stays in DRY_RUN until Meta credentials are entered.

## Requirements
- Node.js 20+
- MongoDB 7 (local via Docker, or MongoDB Atlas)

## First-time setup
```bash
npm install
cp .env.example .env              # then fill in values
docker compose up -d              # local MongoDB (skip if using Atlas)
# no Docker? run `npm run dev:mongo` in its own terminal instead (in-memory, data lost on stop)
npm run seed                      # creates the first admin from SEED_ADMIN_* in .env
```
Password rule: 10+ characters with upper-case, lower-case and a number (locally you can override with `SEED_ALLOW_WEAK_PASSWORD=true`;
`SEED_RESET_PASSWORD=true` changes an existing admin's password). `SEED_ADMIN_EMAIL` may be a plain username. Remove `SEED_ADMIN_PASSWORD` from `.env` after seeding.

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
