# Runbook – what to do when something happens

Written for the shop owner/admin. Dashboard = `https://rate.chhedajewellers.com`. Times are IST.

## "Today's rate is missing" (red banner / alert / email)
The system **never** sends yesterday's rate. Nothing goes out until today's rate is saved **and approved**.
1. Dashboard → **+ Enter rate** → type today's 24K / 22K / 18K → **Save rate** → **Approve**.
2. If it is before the cut-off (default 11:00), the scheduler sends it within 15 minutes. After the cut-off, press **Send now** on the Dashboard.
3. Acknowledge the alert on the Alerts page.

## "A send failed" / "Sent on some channels only"
1. Dashboard → Today's deliveries → read the error next to the failed channel.
   - *not connected / token invalid* → see "Instagram token expired" below.
   - *publishing limit reached* → Instagram allows 100 posts a day; wait and press **Retry** later.
   - *Recipient unavailable / undeliverable* (WhatsApp) → that customer is marked invalid automatically; nothing to do.
2. Press **Retry** (or **Send now**). Channels that already succeeded are never sent twice.
3. If it still fails, copy the error text and the request id from the Deliveries page details and send it to the developer.

## "Instagram token expired" / "WhatsApp connection failed"
1. Meta Business Suite → System Users → generate a new **permanent** token with the same permissions.
2. Dashboard → Settings → **Connections** → paste the new token → **Save** → **Test connection** → "Connected".
3. Dashboard → **Send now** if today's rate did not go out. You get a warning 7 days before a token expires – do this then.

## "WhatsApp quality rating dropped" (email from Meta / Connections page shows quality LOW)
Meta lowers quality when customers block or report messages. Messaging limits shrink.
1. Settings → Channels → switch off **WhatsApp – opted-in customers** for a few days (Instagram keeps going).
2. Subscribers page → remove anyone who complained; make sure every number has real opt-in proof.
3. Keep the message exactly the approved template (never edit its text in Meta without re-approval).
4. Re-enable when Meta shows the rating back at Medium/High.

## "Staff didn't mark the share posted" (reminder push / "manual pending" alert)
1. Open `/staff` on the phone → **Mark posted** for the channels that were actually posted.
2. If the staff phone never got the notification: Staff app → **Turn on notifications** (iPhone: must be added to the Home Screen first).
3. Change the reminder delay in Settings → Staff share & admin alerts.

## "How to pause everything"
- Dashboard → **Automation** toggle → OFF. Nothing is sent automatically (Send now still works when you want it).
- To also stop keyword auto-replies: Settings → "RATE" keyword auto-reply → OFF.
- Emergency full stop on the server: `sudo systemctl stop chheda-worker` (the dashboard keeps working).

## "How to change the send time"
Settings → Automation → **Daily send time** and **Late-send cut-off** (cut-off must be later than the send time) → Save. Takes effect on the next minute.

## "How to add a new staff member"
1. Dashboard → **Users** → Add user (email, name, role **staff**) → copy the one-time password from the dialog and share it privately.
2. They log in at the dashboard URL → they land on `/staff` → Add to Home Screen → Turn on notifications.
3. Ask them to change the password (Users → Reset password if they forget it). Disable the user when they leave.

## "The dashboard says my session ended"
Sessions last 12 hours. Just log in again. If it happens repeatedly within minutes, someone reset your password or disabled the account – check with the other admin.

## Daily 2-minute check (during the trial and after)
Dashboard banner green ("Today is handled") · 0 open alerts · Staff share all ✓ · WhatsApp counts sent ≈ subscribers.

## Who to contact
| Problem | Contact |
|---|---|
| Rate / approval / staff questions | shop admin |
| Dashboard errors, deploys, tokens, "it says request id …" | developer (send the request id + screenshot) |
| Template rejected, quality rating, permissions | Meta Business Support (business.facebook.com → Help) |
| Site down (health check red) | VPS provider status page, then developer |
