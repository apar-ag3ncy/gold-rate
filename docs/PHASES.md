# Build Phases – copy each prompt into Claude Code, one at a time

> Tip: start Claude Code inside this folder so it reads `CLAUDE.md` automatically.

## Phase 1 – Foundation, auth, rate entry
```
Read CLAUDE.md and docs/SPEC.md. Build Phase 1:
- npm-workspaces monorepo: apps/web (Next.js + TS + Tailwind + shadcn/ui), apps/api (Express + TS), apps/worker, packages/shared.
- .env.example, .gitignore, docker-compose.yml with MongoDB for local dev, README with run steps.
- Mongoose models from SPEC §7. Zod schemas + validation rules from SPEC §5 in packages/shared (blocks only, never modifies).
- Auth (login/logout/me, argon2, httpOnly session, roles), seed script for first admin.
- Rates API (PUT draft, approve, get, list) with audit logging.
- Dashboard pages: login, rate entry form (date, 24K/22K/18K required, optional purities), rate history table.
- Tests: validation unit tests + API integration tests (mongodb-memory-server).
Update docs/PROGRESS.md at the end.
```

## Phase 2 – Creative + preview + test send
```
Build Phase 2 from docs/SPEC.md: branded creative renderer (1080x1080 feed JPEG + 1080x1920 story JPEG) using
the exact admin-entered values, caption template from settings, storage adapter (local disk in dev, S3/Cloudinary in prod),
POST /preview, POST /send/test (DRY_RUN logs only), preview panel in the dashboard. Add tests.
```

## Phase 3 – Scheduler
```
Build Phase 3 (apps/worker) per SPEC §6: node-cron in Asia/Kolkata, Mongo job lock, health check at sendTime-30min,
send only approved rate for today, rate-missing alert + 15-min re-check until admin-set cutoff, skip after cutoff,
missed-run recovery on startup, per-channel retries with backoff, idempotency keys, alerts collection.
Settings UI: automation ON/OFF, send time, cutoff time, channel toggles. Tests with fake timers for every rule.
```

## Phase 4 – Meta publishers + staff share
```
Build Phase 4: publisher interface with DRY_RUN; Instagram Graph API publisher (feed + story: create container → poll status → publish);
WhatsApp Cloud API publisher (template with image header, batched sends to opted-in subscribers, respect rate limits);
webhooks with signature verification (delivery statuses, STOP opt-out); encrypted integration tokens + token-expiry alerts;
staff PWA at /staff with web push, Web Share API, copy caption, save image, "Mark posted", 30-min reminder. Tests with mocked Meta APIs.
```

## Phase 5 – "RATE" keyword auto-reply
```
Build Phase 5: when a customer sends "RATE" (case-insensitive, also "rate today", "gold rate") on WhatsApp or Instagram DM,
reply with today's approved rate (image + caption). If today's rate is not approved yet, reply with a polite
"today's rate will be updated soon" message — never an old rate. Log each reply in deliveries (trigger=keyword). Tests.
```

## Phase 6 – Dashboard completion
```
Build Phase 6: dashboard home with today's rate, status, next scheduled send, integration status, today's delivery
status per channel, alerts with acknowledge, delivery logs with filters, Send Now with confirmation, subscribers page, audit log page.
```

## Phase 7 – Hardening + deploy
```
Build Phase 7: security review against SPEC §9, Sentry, structured logs, health endpoints, Dockerfiles,
deployment guide (API + worker on a VPS/Railway, web on Vercel, MongoDB Atlas), backup notes, runbook for
"rate missing", "token expired", "WhatsApp quality drop". Run full test suite and fix failures.
```
