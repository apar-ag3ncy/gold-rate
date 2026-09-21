# Run everything on Vercel (₹0, no server to manage)

The app becomes **two Vercel projects from the same GitHub repo**: the dashboard (you already have this one) and the API as a
serverless function. Images are kept in MongoDB, so no Cloudinary and no disk. The every-minute clock that posts at the send time
comes from a free cron service. Total: ₹0. (Vercel's free "Hobby" plan is meant for personal projects; if Vercel ever objects,
the same code runs on a free Oracle server – `docs/DEPLOY-ORACLE.md`.)

What you need open: GitHub (already connected to Vercel), MongoDB Atlas, your Mac's Terminal for two random strings.

---

## Part 1 – The API project (10 min)
1. Vercel → **Add New… → Project** → pick the `gold-rate` repo again → **Import**.
2. **Project Name**: `gold-rate-api` (if Vercel says it is taken, pick another; you will use `https://<that name>.vercel.app` below).
3. **Root Directory** → Edit → `apps/api`.
4. **Framework Preset**: *Other*. Build and install commands are already set by `apps/api/vercel.json`; leave them.
5. **Environment Variables** – add these (all for Production):

   | Name | Value |
   |---|---|
   | `MONGO_URI` | your Atlas string, e.g. `mongodb+srv://USER:PASSWORD@gold-rate.xxxxx.mongodb.net/chheda_gold` |
   | `WEB_ORIGIN` | the dashboard's address, e.g. `https://gold-rate-xxxx.vercel.app` (Vercel → your dashboard project → Domains; no trailing slash) |
   | `MEDIA_BASE_URL` | this API project's address: `https://gold-rate-api.vercel.app` (same name as step 2) |
   | `STORAGE_DRIVER` | `mongo` |
   | `ENCRYPTION_KEY` | copy the `ENCRYPTION_KEY=` line from `.env` on your Mac (keeps already-saved data readable). New setup: run `openssl rand -base64 32` in Terminal |
   | `AUTO_LOGIN_EMAIL` | `admin@chhedajewellers.com` (the user that already exists in your Atlas database; no login screen) |
   | `DRY_RUN` | `true` (nothing is really posted until the Meta app is live – see `docs/GO-LIVE.md`) |
   | `META_WEBHOOK_VERIFY_TOKEN` | any long random text, e.g. from `openssl rand -hex 24` |
   | `CRON_SECRET` | another long random text (16+ characters) – you paste the same value into the cron service in Part 3 |
   | `IBJA_SOURCE` | `website` |

6. **Deploy**. When it finishes, open `https://gold-rate-api.vercel.app/health` → you should see `{"ok":true,"db":"up",...}`.
   - `"db":"down"` or a timeout → Atlas → **Network Access** → Add IP address → **Allow access from anywhere** (`0.0.0.0/0`).
     Vercel functions do not have a fixed IP, so Atlas must accept all; the database is still protected by its password.
   - A red error page → Vercel → the deployment → **Logs**: the message lists the missing/invalid variable.

## Part 2 – Point the dashboard at the API (2 min)
1. Vercel → your **dashboard** project → **Settings → Environment Variables** → add `API_INTERNAL_URL` = `https://gold-rate-api.vercel.app`.
2. **Deployments → ⋯ on the latest → Redeploy** (the address is baked in at build time, so a redeploy is required).
3. Open the dashboard → the Rate page loads, the IBJA card shows rates (press **Refresh** if it is empty), Save / Approve / Preview work.

## Part 3 – The every-minute clock (5 min) – cron-job.org
Without this, everything still works by hand: Refresh → Use IBJA rates → Save → Approve → **Send now**. With it, the approved
rate is posted at the send time automatically, IBJA is fetched at 12:40 and 18:40, and you get the "no rate approved" alerts.
1. https://cron-job.org → create a free account → **Create cronjob**.
2. **URL**: `https://gold-rate-api.vercel.app/api/v1/internal/tick`
3. **Schedule**: *Every 1 minute*.
4. **Advanced → Headers** → add `Authorization` with value `Bearer <your CRON_SECRET>` (the word Bearer, a space, then the secret).
5. Save. The history should show status 200 within a minute. 401 = the header does not match `CRON_SECRET`; 404 = `CRON_SECRET` is not set on the API project.

## Day to day
- Nothing changes for the staff: open the dashboard address, no login. Keep the address private (anyone who has it acts as the admin).
- Every push to `main` redeploys both projects automatically.
- Logs: Vercel → project → **Logs**. Rendered images are stored in the `media` collection in Atlas (two small JPEGs a day).
- Going live: `docs/GO-LIVE.md`. Webhook URL for the Meta app: `https://gold-rate-api.vercel.app/api/v1/webhooks/whatsapp`.

## Limits worth knowing
- The first click after a quiet spell takes a few seconds (the function wakes up). Normal for serverless.
- One request may run at most 60 s. Posting to Instagram and sending to a few hundred WhatsApp numbers fits; thousands would not.
- Free cron services are usually on time to the second, but the app also catches up on its own if a minute is missed.
