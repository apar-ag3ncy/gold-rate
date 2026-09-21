# Specification – Chheda Gold Rate Automation

## 1. Goal
ADMIN ENTERS RATE (or accepts the IBJA benchmark draft) → SAVE & APPROVE → SCHEDULER (default 07:00 IST) → AUTO-POST → INSTAGRAM + WHATSAPP → LOGS.

## 2. Destinations (verified against Meta docs, Sept 2026 – re-check before launch)
| Destination | Mode | Mechanism |
|---|---|---|
| Instagram Feed post | AUTO | Instagram Graph API content publishing (`instagram_business_content_publish`) |
| Instagram Story | AUTO | Instagram Graph API (media_type=STORIES) |
| WhatsApp – opted-in customers | AUTO | WhatsApp Cloud API, approved image-header template (likely Marketing category, per-message pricing) |
| "RATE" keyword auto-reply | AUTO | Instagram Messaging API + WhatsApp Cloud API webhooks; reply inside the customer-initiated window |
| Instagram Broadcast Channel | 1-TAP STAFF | No API exists |
| WhatsApp Channel / Community | 1-TAP STAFF | No API exists |
| WhatsApp Groups API | NOT USED | OBA-only, max 8 participants |

## 3. Admin dashboard (Next.js)
1. Enter rate: **date** (default: tomorrow), **24K, 22K, 18K per gram (all required)**, optional extra purities (label + value)
2. Save / Update → validation result + message preview (image + caption)
3. Approve (same admin may approve; logged)
4. Test Send (admin's own WhatsApp number / preview only – never to customers)
5. Send Now (same checks as scheduler)
6. Automation ON/OFF
7. Scheduled send time (default 07:00) and **late cutoff time** (admin-configurable, e.g. 11:00)
8. Channel toggles (IG feed, IG story, WA customers, staff share, RATE reply)
9. Integration status: Instagram / WhatsApp connected, token expiry
10. Today's delivery status per channel (queued / success / failed / pending_manual / skipped)
11. Rate history (filter by date range), delivery logs, alerts, audit log
12. Subscribers: count, opt-in source, opt-outs

## 4. Staff share app (Next.js PWA route `/staff`)
- Web push notification at send time: "Today's rate is ready to share".
- Share page: image + caption; caption auto-copied; **Share** button uses Web Share API (files);
  fallback: "Save image" + "Copy caption" + deep links to WhatsApp / Instagram.
- "Mark posted" per manual channel (ig_broadcast_manual, wa_channel_manual). Reminder after 30 min if not done.

## 5. Validation (blocks only, never modifies)
- 24K, 22K, 18K required; positive numbers; max 2 decimals.
- 24K > 22K > 18K.
- Sane per-gram range (configurable, e.g. ₹3,000 – ₹50,000) → catches extra/missing zero.
- Day-to-day change beyond ±X% (configurable, default 5%) requires a written override reason.
- Date must be today or future when saving; past dates read-only.
- After status `sent`, edits locked; correction requires explicit "Correct rate" action (logged, re-send is manual).

## 6. Scheduler rules (apps/worker)
- node-cron every minute; fires when IST time == settings.sendTime. Mongo job lock (`job_locks`).
- 06:30 (sendTime − 30 min) health check: rate present & approved? tokens valid? creative renders? → alert admin if not.
- At sendTime: if automation OFF → log skipped. If no approved rate for today → **send nothing**, alert admin
  (email + WhatsApp utility template to admin), status `rate_missing`.
- Re-check every 15 min until **cutoff**; send as soon as approved. After cutoff → mark day skipped, log reason.
- Missed-run recovery: on worker start, if now is between sendTime and cutoff and today not sent → run.
- Per-channel independent execution, 3 retries with exponential backoff, idempotency keys.
- Rate status → `sent` only when all auto channels succeed; partial failures raise alerts and can be retried via Send Now
  (already-successful channels are skipped).

## 7. Data model (MongoDB)
- **rates**: date (unique), unit:"per_gram", k24, k22, k18, extraPurities[{label,value}], status(draft|approved|sent|cancelled),
  enteredBy, approvedBy, approvedAt, overrideReason, validation{errors,warnings}, revisions[{at,by,from,to}], creativeUrls{feed,story}, caption
- **deliveries**: rateId, date, channel, trigger(cron|send_now|test|keyword), idempotencyKey (unique, sparse), status,
  externalId, error, attempts, postedBy (manual), timestamps
- **wa_subscribers**: phone (encrypted + hashed for lookup), optInAt, optInSource, optOutAt, status, lastDeliveryStatus
- **settings** (singleton): automationOn, sendTime, cutoffTime, timezone, channels{}, captionTemplate, maxDailyChangePct, priceRange{min,max}, ibja{enabled, autoDraft, autoApprove, draftFor, preferSession, fetchTimes}
- **ibja_rates**: rateDate + session (AM|PM, unique), per10g{999,995,916,750,585,silver999,platinum999} (exact digits), perGram{k24,k22,k18} (÷10 exact), source(api|website), fetchedAt · **ibja_fetches**: attempt log (90-day TTL)
- **rates** additionally carry `source` (admin|ibja) and `ibja{rateDate, session, fetchedAt, source}` when drafted from the benchmark
- **integrations**: channel, encryptedToken, accountId/phoneNumberId, expiresAt, lastHealthCheck, status
- **users**: email, passwordHash, role, mfaSecret?, lastLoginAt, disabled
- **alerts**: type(rate_missing|send_failed|token_expiring|manual_pending), message, severity, status, ackBy
- **audit_logs**: userId, action, entity, before, after, ip, at
- **job_locks**: name, lockedUntil, owner

## 8. API (Express, /api/v1)
auth: POST /auth/login, POST /auth/logout, GET /auth/me
rates: GET /rates?from&to, GET /rates/:date, PUT /rates/:date (create/update draft), POST /rates/:date/approve, POST /rates/:date/correct
preview: POST /preview (returns image URLs + caption for a draft or unsaved values)
send: POST /send/test, POST /send/now
deliveries: GET /deliveries?date, GET /deliveries/keyword (RATE auto-reply log), POST /deliveries/:id/mark-posted
settings: GET/PUT /settings (incl. keywordReply{triggers,maxPerSenderPerDay,notReadyMessage})
integrations: GET /integrations, POST /integrations/:channel/test
alerts: GET /alerts, POST /alerts/:id/ack
ibja: GET /ibja/latest, GET /ibja/history, POST /ibja/refresh (admin, ≤6/h), POST /ibja/draft (admin)
subscribers: GET /subscribers, POST /subscribers/import
webhooks: GET/POST /webhooks/whatsapp, GET/POST /webhooks/instagram (verify X-Hub-Signature-256)

## 9. Security
argon2, httpOnly+Secure+SameSite cookies, CSRF protection, Helmet, CORS allowlist, rate-limit login,
role checks on every route, AES-256-GCM for tokens/phones (key from env/secret manager), audit every write,
no secrets in logs, webhook signature verification, input validation with Zod on every endpoint.

## 10a. IBJA benchmark (optional source for the daily rate)
- Source A (go-live): official **IBJA Rates API** – subscription via indiagoldratesapi.com (email nagaraj.iyer@ibja.in); `IBJA_SOURCE=api`, `IBJA_API_TOKEN`; 40 hits/day, rates refreshed ~12:10 (AM) and ~18:10 (PM).
- Source B (trial/fallback): the public ibjarates.com page (server-rendered table `lblGold999_AM/PM`…); IBJA advises commercial pricing use to go through the API.
- Worker fetches at `settings.ibja.fetchTimes` (default 12:40, 18:40 IST, with catch-up), stores every AM/PM snapshot, optionally drafts `draftFor` (default tomorrow) from `preferSession` (default PM). Drafts never overwrite a rate a person entered/approved; validation (range, ordering, % change) still applies; failures raise `ibja_fetch_failed`, drafts raise `ibja_draft_ready`.

## 10. Meta setup checklist (owner: Chheda)
- Meta Business verification; developer app; App Review for Instagram publishing + messaging permissions
- Instagram Business/Creator account linked
- Dedicated WhatsApp number (not on WhatsApp app), WABA, permanent System User token
- Approved templates: daily rate (image header), admin alert (utility)
- Customer opt-in: in-store QR, website form, "JOIN" keyword; opt-out on "STOP"
- Brand assets: logo, colours, fonts (see `BANNER CHHEDA.png` on Desktop for reference)
