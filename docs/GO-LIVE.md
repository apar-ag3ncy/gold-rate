# Go-live plan

## Pre-flight checklist (all must be ✅ before step 2)
- [ ] Meta app in **Live** mode; permissions approved (`instagram_business_content_publish`, `instagram_business_manage_messages`, `whatsapp_business_messaging`, `whatsapp_business_management`)
- [ ] WhatsApp templates **approved**: `daily_gold_rate` (image header + 4 or 5 body params, category Marketing) and `admin_alert` (Utility, 2 params)
- [ ] Tokens saved on Settings → Connections; **Test connection** = Connected on both; expiry shows "never" (permanent System User token)
- [ ] Webhooks subscribed (WhatsApp + Instagram `messages`) and verified (Meta shows a green tick)
- [ ] Subscribers imported with opt-in proof (source column filled); every number in E.164
- [ ] Settings reviewed: send time, cut-off, caption template, WhatsApp template name/language, keyword triggers, reminder minutes
- [ ] Admin alert email + WhatsApp number set; a test alert received (trigger: Send now while today's rate is a draft → "rate missing" alert)
- [ ] Staff trained on `/staff`: app on Home Screen, notifications ON, Share → Mark posted walked through once
- [ ] Sentry receiving events; uptime monitor on `/health`; backups cron ran once (`/var/log/chheda/backup.log`)
- [ ] Production `.env` passes `node apps/api/scripts/check-env.mjs .env`; `DRY_RUN=true`

## Step 1 – Trial (1–2 weeks, DRY_RUN=true, automation ON)
Nothing is really posted; every step is executed and logged as if it were.
Daily: enter + approve the rate before the send time. Then check:
- Dashboard banner "Today is handled" by 07:05; Deliveries shows ig_feed / ig_story / wa_customers as success (dry run) with today's image.
- Staff got the push and marked all three channels posted; reminder fired if they didn't.
- Alerts page: only alerts you expect (e.g. the day you deliberately forget the rate – do this once to see the rate-missing alert + email + WhatsApp).
- Worker log shows the 06:30 health check and the 07:00 send; `/ready` is 200.
Fix anything odd before step 2. Rates entered during the trial are real – keep entering the true rate daily.

## Step 2 – Instagram live (3–5 days)
1. `DRY_RUN=false` on the VPS → `sudo systemctl restart chheda-api chheda-worker`.
2. Settings → Channels: **Instagram Feed ON, Story ON, WhatsApp customers OFF**.
3. Dashboard → Send now (if after the send time) → check the post and story on the Instagram account; media ids appear in Deliveries.
4. Check daily for 3–5 days. Keyword replies now go out for real on Instagram DMs ("gold rate").

## Step 3 – WhatsApp with a small group (2–3 days)
1. Subscribers → keep only 5–10 test numbers active (staff + family); mark the rest opted out temporarily (or import them later).
2. Settings → Channels: **WhatsApp customers ON**.
3. Next send: confirm each test phone receives the image template with the exact values; statuses in Deliveries move to delivered/read.
4. Send "rate" from a test phone → auto-reply arrives; send it 4× → 4th is skipped.

## Step 4 – All subscribers
1. Import / re-activate the full opted-in list. Check the count on the Dashboard WhatsApp card.
2. Watch the first full send: sent/failed counts, Meta quality rating on the Connections card, opt-outs (STOP) on the Subscribers page.
3. Keep the daily 2-minute check from the runbook.

## Rollback at any step
`DRY_RUN=true` + restart → everything logs only; or Dashboard → Automation OFF → nothing sends. Neither loses data.
