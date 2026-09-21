# Chheda Jewellers – Gold Rate Automation

Production system: admin enters the daily gold rate → at a scheduled time (default 07:00 IST) the
approved rate is auto-posted to Instagram (Feed + Story) and WhatsApp (opted-in customers via Cloud API).
Instagram Broadcast Channel + WhatsApp Channel/Community get a **1-tap staff share** (no official API exists).

Full spec: `docs/SPEC.md` · Build order + prompts: `docs/PHASES.md` · Progress log: `docs/PROGRESS.md`

## Non-negotiable rules
1. **The admin-approved rate is the only thing that is ever sent.** Never calculate, derive, round or modify a rate;
   22K/18K are never computed from 24K. The one permitted external source is the **IBJA benchmark** (999 → 24K, 916 → 22K,
   750 → 18K; IBJA publishes per 10 g, converted ÷ 10 as an exact decimal shift), which may pre-fill the form or create a
   *draft*. Approval by the admin still gates sending unless `settings.ibja.autoApprove` is explicitly switched on.
   No other rate API, no margins, no rounding.
2. **Never send an old rate as today's rate.** Scheduler sends only a rate with `date == today (Asia/Kolkata)`
   and `status == approved`. If missing → send nothing, alert admin, re-check until the admin-set cutoff.
3. **Official Meta APIs only.** No WhatsApp Web automation (whatsapp-web.js, Baileys), no instagram-private-api,
   no browser/phone automation, no scraping.
4. **Validation blocks, never edits.** Reject bad input with a clear message; store exactly what was typed.
5. **No duplicate posts.** Every delivery uses an idempotency key `YYYY-MM-DD:channel` (unique index).
6. **Secrets never reach the browser or git.** Meta tokens encrypted at rest (AES-256-GCM); `.env` in `.gitignore`.
7. **All times are Asia/Kolkata.** Store dates as `YYYY-MM-DD` strings in IST; timestamps in UTC.
8. Default to `DRY_RUN=true` for publishers until real Meta credentials are configured.

## Stack
- Monorepo (npm workspaces): `apps/web` (Next.js App Router, TypeScript, Tailwind, shadcn/ui),
  `apps/api` (Express, TypeScript), `apps/worker` (scheduler), `packages/shared` (Zod schemas, types).
- MongoDB (Mongoose). node-cron in the worker with a Mongo job lock.
- Creative: HTML/SVG → JPEG (sharp or Puppeteer) → S3/Cloudinary (public URL needed by Instagram).
- Auth: httpOnly session cookie, argon2 passwords, roles (admin / staff / viewer), optional TOTP.
- Logging: Pino; errors: Sentry. Tests: Vitest + Supertest; mongodb-memory-server for integration tests.

## Working style
- Build one phase at a time from `docs/PHASES.md`; finish with passing tests before moving on.
- After each phase, update `docs/PROGRESS.md` (what's done, how to run, open questions).
- Ask before adding new dependencies beyond the stack above.
- Keep business rules in `packages/shared` / services, not in route handlers or React components.
