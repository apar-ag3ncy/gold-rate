# Run it on Vercel – one project, ₹0, works like localhost

The dashboard project you already have on Vercel now contains the API as well. Every `/api/*` request is handled by the same
Express code that runs on your Mac, inside a Vercel function; rate images are kept in MongoDB (no disk, no Cloudinary).
The only thing Vercel cannot do is keep a clock running, so a free cron service pokes the app once a minute (Part 3).

You need: the Vercel project (exists), MongoDB Atlas, and your Mac's Terminal once for a random string.

---

## Part 1 – Settings on the Vercel project (5 min)
Vercel → your dashboard project → **Settings → Environment Variables**. Add these for *Production* (and *Preview* if you like):

| Name | Value |
|---|---|
| `MONGO_URI` | your Atlas string: `mongodb+srv://USER:PASSWORD@gold-rate.xxxxx.mongodb.net/chheda_gold` |
| `ENCRYPTION_KEY` | copy the `ENCRYPTION_KEY=` value from `.env` on your Mac (keeps already-saved data readable). Fresh setup: Terminal → `openssl rand -base64 32` |
| `AUTO_LOGIN_EMAIL` | `admin@chhedajewellers.com` – the user that already exists in your Atlas database (no login screen) |
| `CRON_SECRET` | any long random text, 16+ characters (used in Part 3). Skip it if you will only use the manual routine |

Everything else is worked out automatically on Vercel: images go to MongoDB, the site's own https address is used for links and
security checks, `DRY_RUN` stays on (nothing is really posted until the Meta app is live – `docs/GO-LIVE.md`), IBJA is read
from the public IBJA page. Make sure there is **no** `API_INTERNAL_URL` variable on the project – that would send API calls elsewhere.

Using your own domain instead of `*.vercel.app`? Add `WEB_ORIGIN` = `https://your-domain` too.

## Part 2 – Let Vercel reach Atlas, then redeploy (3 min)
1. Atlas → **Network Access** → *Add IP address* → **Allow access from anywhere** (`0.0.0.0/0`). Vercel functions have no fixed IP; the database is still protected by its password.
2. Vercel → **Deployments** → ⋯ on the latest → **Redeploy** (variables are read at build time).
3. Open `https://<your-site>/api/health` → `{"ok":true,"db":"up",...}`. Then open the site: the Rate page loads, the IBJA card shows
   rates (press **Refresh** if empty), Save / Approve / Preview post work – exactly like localhost.
   - `"db":"down"` or a timeout → step 1 was skipped, or the Atlas password in `MONGO_URI` is wrong.
   - An error page → Vercel → the deployment → **Logs**: the message names the missing variable.

## Part 3 – The every-minute clock (5 min) – cron-job.org
Without it everything still works by hand: Refresh → Use IBJA rates → Save → Approve → **Send now**. With it the approved rate
is posted at the send time on its own, IBJA is fetched at 12:40 and 18:40, and you get the "no rate approved" alerts.
1. https://cron-job.org → free account → **Create cronjob**.
2. **URL**: `https://<your-site>/api/v1/internal/tick`
3. **Schedule**: *Every 1 minute*.
4. **Advanced → Headers** → name `Authorization`, value `Bearer <your CRON_SECRET>` (the word Bearer, a space, the secret).
5. Save. The job history shows 200 within a minute. 401 = header does not match `CRON_SECRET`; 404 = `CRON_SECRET` is not set on Vercel.

## Day to day
- Staff open the site address, no login. Keep the address private – anyone who has it acts as the admin.
- Every push to `main` redeploys. Logs: Vercel → project → **Logs**. Images live in the `media` collection in Atlas (two small JPEGs a day).
- Going live: `docs/GO-LIVE.md`. Webhook URL for the Meta app: `https://<your-site>/api/v1/webhooks/whatsapp`.

## Limits worth knowing
- The first click after a quiet spell takes a few seconds while the function wakes up. Normal for serverless.
- One request may run at most 60 s: an Instagram post plus a few hundred WhatsApp numbers fits; thousands would not.
- Vercel's free plan is meant for personal projects. If Vercel ever objects, the same code runs on a free Oracle server (`docs/DEPLOY-ORACLE.md`).
- Local development is unchanged: `.env.local` points the dashboard at the separate API on port 4000.
