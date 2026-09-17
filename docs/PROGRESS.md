# Progress

| Phase | Status | Notes |
|---|---|---|
| 1 Foundation, auth, rate entry | ✅ done (17 Sep 2026) | 12 validation + 22 API tests passing; web build OK; browser walkthrough OK |
| 2 Creative + preview + test send | ✅ done (17 Sep 2026) | 23 shared + 41 API tests passing; typecheck + web build OK; browser walkthrough OK |
| 3 Scheduler | ✅ done (17 Sep 2026) | 35 shared + 60 API tests passing (fake-clock scheduler suite); typecheck + web build OK; worker smoke-run OK; dashboard verified |
| 4A Meta publishers, webhooks, integrations, subscribers | ✅ done (17 Sep 2026) | 41 shared + 78 API tests passing (all Meta HTTP mocked); typecheck + web build OK; DRY_RUN stays default |
| 4B Staff share PWA (/staff) | not started | web push, Web Share API, Mark posted, 30-min reminder |
| 5 RATE auto-reply | not started | |
| 6 Dashboard | not started | |
| 7 Hardening + deploy | not started | |

## Decisions
- Manual rate entry only (per gram); no gold-rate API.
- Same admin enters and approves.
- Send time and late cutoff are admin-configurable (default 07:00 IST).
- Instagram Broadcast Channel + WhatsApp Channel/Community via 1-tap staff share.
- "RATE" keyword auto-reply included.
- Creative is rendered with **sharp** from an SVG template using fonts bundled in the repo
  (`apps/api/assets/fonts`: Poppins + Marcellus, SIL Open Font License) – no system fonts, identical output on every machine.
- sharp is pinned to `^0.35` because its macOS libvips build ships the fontconfig backend (0.33 only had CoreText, which
  ignores bundled fonts). The renderer sets `PANGOCAIRO_BACKEND=fontconfig` + a private `FONTCONFIG_FILE` before the first render.
- Test Send uses channel `wa_admin` (never a customer channel) and is always DRY_RUN until the WhatsApp publisher exists (Phase 4).

## Phase 1 – what was built
- Monorepo: `apps/api`, `apps/web`, `apps/worker` (placeholder), `packages/shared`.
- Auth: argon2id passwords, httpOnly SameSite=Strict session cookie (only a hash of the token stored), roles admin/staff/viewer,
  lockout after 5 failures (15 min), login rate limit, CSRF header + origin check, login audit.
- Rates API: `PUT /api/v1/rates/:date` (draft), `POST …/approve`, `POST …/cancel`, `POST …/check`, `GET /rates`, `GET /rates/summary`, `GET /rates/:date`.
  Values stored exactly as typed; 24K/22K/18K required; optional extra purities. Validation only blocks
  (₹/g range, 24K>22K>18K, big % change needs override reason, no past dates). Editing an approved rate → back to draft.
  Sent rates are locked. Revision history per rate + audit log.
- Settings: automation ON/OFF (default OFF), send time (default 07:00), admin-set late cut-off (must be after send time), channel toggles, safety limits.
- Dashboard: login, today/tomorrow cards with missing-rate warning, rate entry with text preview, history with filters, settings.

## Phase 2 – what was built
**Creative renderer** – `apps/api/src/services/creative/`
- `template.ts`: SVG for feed 1080×1080 and story 1080×1920. Dark `#1d1a14` + gold `#c9a449`, serif brand mark, lotus ornament,
  three main rate rows, extra purities (0–10) in a pill grid that adapts (1–3 columns; layout throws instead of overflowing),
  footer "Rates per gram · Excl. GST & making charges". User text is XML-escaped.
- `render.ts`: sharp → JPEG (q92, 4:4:4). `fonts.ts`: bundled-font bootstrap.
- Values come from `formatPerGram()` in `packages/shared/src/format.ts` – exact digits with Indian grouping, **never rounded**
  (`10305.5 → "₹10,305.5 /g"`, `"10305.50" → "₹10,305.50"`). Date in words: `"Fri, 18 Sept 2026"`.

**Caption builder** – `packages/shared/src/caption.ts`
- Placeholders `{date} {k24} {k22} {k18} {extras}`; `validateCaptionTemplate()` blocks unknown placeholders, empty/too-long
  templates and templates missing `{k24}/{k22}/{k18}`. `buildCaption()` fills exact values; the `{extras}` line disappears when there are none.
- Template lives in `settings.captionTemplate` (default in `DEFAULT_CAPTION_TEMPLATE`); `PUT /settings` validates it (422 with the reason).

**Storage** – `apps/api/src/services/storage/`
- `StorageAdapter { save, exists, publicUrl }`. `LocalStorage` writes under `MEDIA_DIR` with `wx` (never overwrites) and the API serves
  `/media/*` (immutable cache, `Cross-Origin-Resource-Policy: cross-origin`, dotfiles denied, 404 JSON). `S3Storage` is a configured stub
  (env: `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_PREFIX`, `S3_PUBLIC_BASE_URL`) that throws until Phase 7.
- Keys: `creative/<date>/feed-<date>-<sha256:16>.jpg` (saved rates) / `preview/<date>/…` (unsaved values). Same content → same file.

**API** (all admin-only + rate-limited unless noted)
- `POST /api/v1/preview/:date` → renders the saved rate (draft/approved/sent; cancelled → 409) and returns `{feedUrl, storyUrl, caption, status, saved:true}`.
  URLs + caption are remembered on the rate (`creativeUrls`, `caption`) unless it is already `sent`.
- `POST /api/v1/preview` body `{date, k24, k22, k18, extraPurities?, overrideReason?}` → same Zod + business validation as saving; nothing is saved.
- `POST /api/v1/send/test` body `{date?}` (default today IST) → renders and records a **DRY_RUN** delivery to the requesting admin only.
  Returns `{delivery, rendered, dryRun:true, rateStatus}`; writes an audit row `send_test`. With `DRY_RUN=false` it refuses (503) until Phase 4.
- `GET /api/v1/deliveries?date=` (any logged-in user) → deliveries for a day.
- New `deliveries` collection (SPEC §7) with `idempotencyKey` unique+sparse. Keys from `deliveryIdempotencyKey()` in shared:
  cron/send_now → `YYYY-MM-DD:channel` (one real post per day per channel); test/keyword → `…:test:<uuid>` (repeatable, never blocks a real send).

**Dashboard** (UI restyled 17 Sep 2026 to match chheda-jewellers-pi.vercel.app: deep emerald `#0b3a2d` / cream `#f7f3ec` / copper `#c68d61`,
Cormorant headings + Montserrat tracked uppercase labels via `next/font/google`, floating cream pill header, pill buttons. Earlier glass pass: gold-gradient primary + frosted-glass secondary buttons, glass cards on a warm
gradient background, sticky dark header with pill nav, step indicator on Enter Rate, dark preview panel, toggle switches in Settings)
- Enter Rate: **Preview image** (saved rate if the form matches it, otherwise unsaved values – clearly labelled), feed + story side by side,
  caption with **Copy caption**; **Test Send** with confirmation and result panel; live caption preview in the sidebar uses the settings template.
- Home: **Today's delivery** card (test entries for now).
- Settings: caption template editor with placeholder help, live validation, live preview (today's rate or sample values), reset to default.

## Phase 3 – what was built
**Rules** – `packages/shared/src/scheduler.ts` (pure, unit-tested): send/re-check minutes (send time, then every 15 min until the cutoff),
health-check minute (send − 30), cutoff minute, `decideSend()` (only *today + approved* is ever sent; cron honours automation ON/OFF and the
cutoff, Send Now ignores those two but never the approval rule), `backoffDelayMs` (1 s / 4 s / 16 s), `retryWithBackoff`.

**Run logic** – `apps/api/src/services/scheduler.ts` (shared by worker + API):
- `tick(now)` every minute → `healthCheck` at send−30 (alert `health_check` once/day if the rate is not approved, automation is off or the creative fails to render);
  `attemptSend` at the send minute and every 15 min; `closeDay` at the cutoff (SendDay → `skipped`, alert `day_skipped`) unless already sent.
- `attemptSend` runs under a Mongo job lock (`send:<date>`, `job_locks`), records progress in `send_days`, raises **one** `rate_missing` alert per day
  (dedupeKey), and sends only when `Rate.status === 'approved'` for today (IST).
- Per channel: idempotent `deliveries` row (`YYYY-MM-DD:channel`, unique), up to 3 attempts with exponential backoff, `success` never repeated.
  Manual channels (`ig_broadcast_manual`, `wa_channel_manual`) get `pending_manual` rows for the staff app (Phase 4).
- Rate → `sent` only when every enabled automatic channel succeeded; otherwise SendDay `partial` + alert `send_failed`. **Send Now** retries just the failed channels.
- `recoverMissedRun(now)` on worker start: inside today's window and not sent → run immediately.
- Publishers: `services/publishers` interface + `DryRunPublisher` (logs only). Real Meta publishers plug in here in Phase 4.

**Day status** – `GET /deliveries?date=` also returns `day` (`send_days` row: pending / rate_missing / partial / sent / skipped + reason,
last check, sent time); the dashboard's delivery card shows it as a badge + scheduler note. A send time before 00:30 runs its health check the
evening before, for the next day. Cutoff after a *partial* send closes the day with a "use Send Now" hint instead of "nothing sent".

**Worker** – `apps/worker/src/index.ts`: node-cron `* * * * *` in Asia/Kolkata, 50 s `scheduler-tick` lock so multiple instances never double-run,
graceful SIGINT/SIGTERM. Imports API code through `@chheda/api/*` package exports. Run: `npm run dev:worker`.

**API** – `GET /alerts?status=`, `POST /alerts/:id/ack` (admin/staff), `POST /send/now` (admin; 409 when today is not approved, 423 when locked).
New models: `Alert` (dedupeKey unique), `JobLock`, `SendDay`.

**Dashboard** – open-alerts card with Acknowledge, **Send now** button (admin, only when today's rate is approved), "Next send" time on the Automation card.
Settings UI for automation / send time / cutoff / channels already existed from Phase 1.

**Tests** – `apps/api/test/scheduler.test.ts` uses `vi.useFakeTimers({ toFake: ['Date'] })` + explicit IST instants: every rule above has a test
(timing, automation off, rate missing + single alert + 15-min re-check, old rate never sent, cancelled, cutoff, toggles, health check, retries/backoff,
partial failure, Send Now retry, job lock under concurrency, missed-run recovery, alerts API). `packages/shared/test/scheduler.test.ts` covers the pure rules and backoff with fake timers.

## Phase 4A – what was built
**Publisher framework** – `apps/api/src/services/publishers/index.ts`: `Publisher.publish({date, feedUrl, storyUrl, caption, rate}) → {externalId, stats?}`;
errors are `MetaApiError` / `PublishError` with `retryable` (throttling, 5xx, network) vs permanent (bad token 190, bad params, limit reached).
The Phase 3 pipeline keeps its idempotency keys and backoff but now stops retrying on permanent errors (`shouldRetry`).
`createPublishers(cfg)`: DRY_RUN=true → log-only publishers (WhatsApp still walks the subscriber list and writes per-recipient rows with
`dry-run:` ids, no HTTP); DRY_RUN=false → live publishers **only** for channels whose integration is `connected`, otherwise a
`NotConnectedPublisher` fails permanently with a clear message. Graph version comes from `META_GRAPH_VERSION` in one place (`services/meta/client.ts`).

**Instagram** – `publishers/instagram.ts`: `GET /{ig-user-id}/content_publishing_limit` (permanent error when quota used up) →
`POST /{ig-user-id}/media` (feed: image_url + caption; story: media_type=STORIES) → poll `status_code` with backoff 2/4/8… s up to
`IG_PUBLISH_TIMEOUT_MS` (never finishes → retryable error) → `POST /{ig-user-id}/media_publish` → media id stored as `externalId`.

**WhatsApp** – `publishers/whatsapp.ts`: approved template from settings (`whatsapp.templateName/templateLanguage/includeExtrasParam`),
image header = feed URL, body params = `buildWhatsAppBodyParams()` (exact digits, `{{1}}` date … `{{4}}` 18K, optional `{{5}}` extras).
One delivery row per subscriber, key `date:wa_cloud:<phoneHash>`; success rows are skipped on retry, permanent recipient errors
(131026/131047/131052/…) mark the subscriber `invalid` and store `metaErrorCode/Message`; retryable ones stay `queued` (max 3 attempts).
Bounded concurrency (`WA_SEND_CONCURRENCY`) + pause (`WA_SEND_DELAY_MS`). Channel row gets `stats {total,sent,failed,skipped}`;
`GET /deliveries` returns `whatsapp` counts (sent/failed/delivered/read) which the dashboard shows.

**Subscribers** – `wa_subscribers`: phone AES-256-GCM encrypted (`lib/crypto.ts`, key = `ENCRYPTION_KEY`) + keyed SHA-256 lookup hash +
masked display; the plain number is never stored, returned or logged. API: `GET /subscribers`, `POST /subscribers`, `POST /subscribers/import`
(CSV `phone,optInSource[,name]`, E.164 validation, opt-in source required, row-level errors), `DELETE /subscribers/:id`.
Dashboard page **Subscribers** (counts, masked list, add, CSV import, remove).

**Webhooks** – `/api/v1/webhooks/whatsapp|instagram`, mounted outside the session/CSRF router. GET = hub.challenge with
`META_WEBHOOK_VERIFY_TOKEN`; POST = `X-Hub-Signature-256` HMAC-SHA256 with `META_APP_SECRET` over the raw body (timing-safe) → 401 otherwise.
Responds 200 first, processes on `setImmediate`. Idempotent via `webhook_events.eventKey` (unique, 7-day TTL). WhatsApp: statuses
sent/delivered/read/failed update the per-recipient row (monotonic, failed stores the Meta error); JOIN → opt-in (+ confirmation reply),
STOP → opt-out (+ reply), RATE → logged for Phase 5. Instagram events are stored/deduplicated only (Phase 5).

**Integrations** – `integrations` collection (token encrypted, `select:false`; tail shown as "…a1b2"), `GET /integrations` (never the token),
`PUT /integrations/:channel` (write-only token, ids), `DELETE`, `POST /integrations/:channel/test` (IG: `/{ig-user-id}?fields=id,username`;
WA: `/{phone-number-id}?fields=display_phone_number,verified_name,quality_rating`; plus `debug_token` for expiry when META_APP_ID/SECRET are set).
Daily health check (send − 30) re-tests every configured connection → alert `token_expiring` (≤ 7 days) or immediately on an invalid token.
Dashboard: **Settings → Connections** page; Instagram/WhatsApp cards show real status, expiry warnings and today's WhatsApp counts.

**Tests** – `apps/api/test/meta.test.ts` (all HTTP through an injected fetch mock, no network): IG happy path / story / never-finishes / limit
reached / error mapping; WA batch success, partial failure + invalid marking, retry without double-send, concurrency; live pipeline via the
scheduler (permanent error → 1 attempt) and "not connected" failure; webhook verify token, signatures, status updates (order + duplicates),
JOIN/STOP/duplicates; integrations API (token never in responses / DB / audit), test connection, health alerts; subscribers API + CSV import; settings template validation.

## How to run / test
```bash
npm install
npm test              # 23 shared + 41 API tests (creative, caption, preview, test send, deliveries)
npm run typecheck
NEXT_DIST_DIR=.next-build npm run build:web   # build without clobbering a running `next dev`
npm run dev:api       # needs MongoDB (docker compose up -d) and .env; images land in ./uploads
npm run dev:web
npm run dev:worker   # scheduler (Phase 3)
```
Browser: log in → Enter Rate → save a rate → **Preview image** → **Copy caption** → **Test Send** (confirm) → Dashboard shows the test delivery.
Settings → edit the caption template (try an unknown placeholder to see it blocked) → Save.

## Go-live checklist (Phase 4A)
1. `.env`: `ENCRYPTION_KEY` (openssl rand -base64 32), `META_GRAPH_VERSION`, `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`,
   `MEDIA_BASE_URL` = public https URL of the API (Instagram fetches the JPEGs from it).
2. Meta: business verification; app with `instagram_business_content_publish` + WhatsApp permissions approved; IG Business account linked;
   WABA + phone number id; permanent System User token with both scopes; daily-rate template approved (image header, 4 or 5 body params).
3. Dashboard → Settings → Connections: paste the token + IG user id (Instagram) and token + WABA id + phone number id (WhatsApp) → **Test connection** → both "Connected".
4. Settings: WhatsApp template name/language (+ 5th-param checkbox), channel toggles, send time, automation ON.
5. Meta app dashboard → Webhooks: subscribe `https://<api>/api/v1/webhooks/whatsapp` (field `messages`) with the verify token.
6. Subscribers: import the opted-in list (CSV) – every row needs an opt-in source.
7. Set `DRY_RUN=false`, restart API + worker, use **Test Send** then **Send Now** on an approved rate and watch Today's delivery.

## Open questions
- Admin notification for alerts (email + WhatsApp utility template) is Phase 4; today alerts appear on the dashboard and in the worker log.
- Admin's WhatsApp number for real test sends (Phase 4): store in settings (encrypted like subscriber phones) or in the integration record?
- S3 vs Cloudinary for production images – decide in Phase 7 (the adapter interface is in place).
- Story safe zones: the design keeps content inside Instagram's top/bottom UI bands; confirm on a real phone once posting works.

## Notes
- `apps/api/test/setup.ts` accepts `TEST_MONGO_URI` to test against an existing DB instead of the in-memory one.
- `next build` writes to `apps/web/.next`, the same folder `next dev` uses – building while the dev server runs blanks the site.
  Set `NEXT_DIST_DIR=.next-build` for the build (git-ignored) or stop the dev server first.
- No Docker on the dev Mac used for the walkthrough: an in-memory MongoDB (`mongodb-memory-server` on port 27017) was used instead.
