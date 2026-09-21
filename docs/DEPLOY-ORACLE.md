# Put it online for ₹0 – one free Oracle Cloud server

Everything (dashboard + API + worker) runs on **one small Linux server** that Oracle gives away free, for as long as you keep the account.
You will need about 45 minutes, a card for Oracle's identity check (nothing is charged), and your MongoDB Atlas connection string.

What you end up with: `https://<your-name>.duckdns.org` → the Rate and Automation screens, posting at the send time every day,
IBJA fetched at 12:40 and 18:40, images served from the same server. Cost: ₹0 for the server, ₹0 for the domain name.

The whole server-side setup is one script: `deploy/oracle/setup.sh`. The steps below are mostly clicking in two websites.

---

## Part 1 – Free domain name (5 min) – DuckDNS
The server needs a name so that https works and so the staff can open it on a phone. DuckDNS gives one free.
1. Open https://www.duckdns.org and sign in with Google/GitHub.
2. In *sub domain* type a name, e.g. `chheda-rate`, click **add domain**. Your address is now `chheda-rate.duckdns.org`.
3. Leave the tab open – you will paste the server's IP into the *current ip* box in Part 3.

(If you already own a domain such as chhedajewellers.com, create an **A record** like `rate.chhedajewellers.com` → server IP instead, and use that name everywhere below.)

## Part 2 – Free server (15 min) – Oracle Cloud
1. Sign up at https://www.oracle.com/cloud/free/ → **Start for free**. Pick the home region closest to you (India: *Mumbai* or *Hyderabad*).
   Oracle asks for a card to prove you are a person. It is not charged for the free resources used here.
2. After the account is ready (can take 10–30 min), go to the console → **Compute → Instances → Create instance**.
3. Fill in:
   - **Name**: `chheda-rate`
   - **Image and shape → Edit**: Image **Canonical Ubuntu 24.04** (or 22.04). Shape: **Ampere → VM.Standard.A1.Flex**, 2 OCPU, 6 GB memory (this stays inside the *Always Free* allowance, the console marks it "Always Free-eligible").
     If Oracle says *Out of host capacity*, try again later, try another availability domain, or pick **VM.Standard.E2.1.Micro** (also free, slower).
   - **Networking**: leave the defaults (a new VCN + public subnet), *Assign a public IPv4 address* = yes.
   - **Add SSH keys**: choose **Generate a key pair for me** and click **Save private key** – keep that file, it is the only way in.
4. **Create**. Wait until the instance shows *Running* and note the **Public IP address**.
5. Open ports 80 and 443 (Oracle blocks them by default):
   Instance page → *Primary VNIC* → **Subnet** link → **Security Lists** → *Default Security List* → **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, IP protocol TCP, Destination port range `80` → Add
   - Repeat with destination port `443`.
6. Optional but recommended, in the same console: **Billing → Upgrade and Manage Payment → Upgrade to Pay As You Go**.
   You still pay nothing for the free server, but Oracle stops reclaiming *idle* free machines and capacity problems become rarer.

## Part 3 – Point the name at the server (1 min)
Back in the DuckDNS tab: paste the server's public IP into **current ip** for your sub domain → **update ip**.

## Part 4 – Install the app (15 min, mostly waiting)
Open a terminal (Mac: *Terminal* app; Windows: *PowerShell*) and connect. Replace the key path and IP with yours:
```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<PUBLIC-IP>
```
Type `yes` at the fingerprint question. You are now on the server. Run the installer (one line; use your own DuckDNS name and email):
```bash
curl -fsSL https://raw.githubusercontent.com/apar-ag3ncy/gold-rate/main/deploy/oracle/setup.sh -o setup.sh && sudo DOMAIN=chheda-rate.duckdns.org EMAIL=you@example.com bash setup.sh
```
It will ask you for two things:
1. **MongoDB connection string** – from Atlas → *Connect → Drivers*: `mongodb+srv://USER:PASSWORD@gold-rate.xxxxx.mongodb.net/chheda_gold`.
   Put the real password in place of `<db_password>` and make sure the database name `chheda_gold` is at the end.
2. **Admin login** – the email and a password (10+ characters with a capital letter, a small letter and a number) you will use to sign in.

Everything else (encryption key, webhook secret, service files, https certificate, nightly backup) is generated on the server.
The script ends with `Done. Open https://chheda-rate.duckdns.org`. If it stops with an error it tells you which log to look at; fixing the cause and running the same command again is safe.

**Atlas must allow the server in.** Atlas → *Network Access* → **Add IP address** → paste the server's public IP (not 0.0.0.0/0). Without this the API log shows a connection timeout.

## Part 5 – First look (5 min)
1. Open `https://<your-name>.duckdns.org` on your phone or laptop → login page → sign in with the admin email/password from Part 4.
2. Rate page: the IBJA card fills within a minute of the first fetch (or press **Refresh**). Press **Use IBJA rates → Save → Approve**.
3. Automation page: you should see the yellow *Dry run is ON* line. Leave it on until the Meta app is approved (`docs/GO-LIVE.md`).
4. Press **Send now (dry run)** on the Rate page → the message lists each channel as a rehearsal. Nothing is really posted yet.
5. Add the staff member's WhatsApp number as an alert email/recipient later from the Automation page.

## Day to day
- The staff routine: open the site → **Refresh** (IBJA) → **Use IBJA rates** → **Save** → **Approve** → **Send now**. Or just Approve and let the 07:00 automation post it.
- Alerts: fill the SMTP_* lines in `/opt/chheda/app/.env` (any Gmail app password works) and restart with `sudo systemctl restart chheda-api chheda-worker` to get an email when a post fails or no rate is approved.
- Updating the app after a new push to GitHub:
  ```bash
  ssh -i ~/Downloads/ssh-key-*.key ubuntu@<PUBLIC-IP> 'cd /opt/chheda/app && sudo -u chheda ./deploy/deploy.sh'
  ```
  It pulls, rebuilds, restarts and rolls back on its own if the health check fails.
- Logs: `sudo tail -f /var/log/chheda/api.log` (or `worker.log`, `web.log`). Status: `systemctl status chheda-api chheda-worker chheda-web`.
- Backups: a copy of the database is saved every night at 02:30 in `/var/backups/chheda` (30 days kept). Atlas' free tier has no backups of its own.

## Going live with real posting
Follow `docs/GO-LIVE.md`. In short: Meta app approved → tokens entered on the Automation page → **Test** shows *Connected* → set `DRY_RUN=false`
in `/opt/chheda/app/.env`, plus `META_APP_ID` / `META_APP_SECRET` from the Meta app → `sudo systemctl restart chheda-api chheda-worker`.
Webhook URL for the Meta app: `https://<your-name>.duckdns.org/api/v1/webhooks/whatsapp` (verify token = `META_WEBHOOK_VERIFY_TOKEN` from `.env`).

## If something goes wrong
| Symptom | Fix |
|---|---|
| Browser cannot reach the site | Ports 80/443 not open in the Oracle security list (Part 2 step 5), or DuckDNS IP not updated (Part 3). `curl -I http://<PUBLIC-IP>` from your laptop should answer. |
| `certificate failed` in the script | Same two causes as above – Let's Encrypt must reach port 80 on the name. Fix and re-run the script. |
| Login page says *Could not reach the server* | `sudo tail -50 /var/log/chheda/api.log`. A MongoDB timeout means the server IP is not in Atlas Network Access. |
| Server disappeared / stopped after weeks | Oracle reclaims idle free machines on accounts that are not Pay As You Go (Part 2 step 6). Start it again from the console; the app starts on boot. |
| Site works but nothing posts at 07:00 | Automation page → Automation must be **ON**, and the rate must be **Approved** before the send time. `sudo tail -f /var/log/chheda/worker.log` prints a line every minute. |
| Out of memory during the build | The script adds swap on small machines; if it still fails, use the 2 OCPU / 6 GB A1 shape. |
