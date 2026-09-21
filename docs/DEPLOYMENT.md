# Deployment – Chheda Gold Rate Automation

Target: **API + worker on an Ubuntu VPS** (systemd + Nginx + Let's Encrypt), **dashboard on Vercel**, **MongoDB Atlas**, **Cloudinary** for images.
Domains used below (replace with yours): `api.chhedajewellers.com` (API), `rate.chhedajewellers.com` (dashboard).

## 0. Accounts you need
| Service | Plan | Used for |
|---|---|---|
| Ubuntu 22.04/24.04 VPS (1 vCPU / 1 GB is enough) | any provider | API + worker |
| MongoDB Atlas | M0 free tier works for a trial; M10 for backups | database |
| Cloudinary | free tier | rate images (public CDN URL Instagram fetches) |
| Vercel | hobby/pro | dashboard (Next.js) |
| Sentry (optional) | free | error tracking |
| Meta for Developers | – | Instagram + WhatsApp APIs |
| SMTP (Gmail app password, Brevo, SES…) | – | admin alert emails |

## 1. DNS
- `api.chhedajewellers.com` → **A record** to the VPS IP.
- `rate.chhedajewellers.com` → **CNAME** to `cname.vercel-dns.com` (Vercel shows the exact value).

## 2. MongoDB Atlas
1. Create a project + cluster (region: Mumbai `ap-south-1`).
2. Database Access → add user `chheda_app` with **readWrite** on `chheda_gold` (strong generated password).
3. Network Access → add the **VPS public IP** only (never 0.0.0.0/0). Vercel never talks to Mongo (the dashboard goes through the API).
4. Backup → enable **Cloud Backup** (M10+; continuous or daily snapshots, keep ≥ 7 days). M0 has no backups → the `mongodump` cron below is your backup.
5. Copy the connection string → `MONGO_URI=mongodb+srv://chheda_app:<password>@<cluster>/chheda_gold?retryWrites=true&w=majority`.

## 3. Cloudinary
Console → Settings → API keys: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Set `STORAGE_DRIVER=cloudinary`, `CLOUDINARY_FOLDER=chheda`.
Images are uploaded signed, into `chheda/creative/YYYY-MM/`, never overwritten.

## 4. VPS – first time
```bash
# as root
apt update && apt install -y nginx certbot python3-certbot-nginx git curl ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
# mongodump for backups
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb.gpg
echo "deb [signed-by=/usr/share/keyrings/mongodb.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb.list
apt update && apt install -y mongodb-database-tools
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
useradd -m -s /bin/bash chheda
mkdir -p /opt/chheda /var/log/chheda /var/backups/chheda && chown -R chheda:chheda /opt/chheda /var/log/chheda /var/backups/chheda
# as chheda
su - chheda
git clone https://github.com/apar-ag3ncy/gold-rate.git /opt/chheda/app && cd /opt/chheda/app
npm ci --omit=dev --no-audit --no-fund
cp .env.example .env && nano .env        # fill every value – see §5
node apps/api/scripts/check-env.mjs .env   # must print "env OK"
SEED_ADMIN_EMAIL=owner@chhedajewellers.com SEED_ADMIN_PASSWORD='<strong password>' npm run seed
# back as root: services, nginx, TLS, logrotate
cp /opt/chheda/app/deploy/systemd/*.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now chheda-api chheda-worker
cp /opt/chheda/app/deploy/nginx/chheda-http.conf /etc/nginx/conf.d/
cp /opt/chheda/app/deploy/nginx/chheda-proxy.conf /etc/nginx/snippets/
cp /opt/chheda/app/deploy/nginx/chheda-api.conf /etc/nginx/sites-available/ && ln -s /etc/nginx/sites-available/chheda-api.conf /etc/nginx/sites-enabled/
certbot --nginx -d api.chhedajewellers.com        # creates the certificate + auto-renewal
nginx -t && systemctl reload nginx
cp /opt/chheda/app/deploy/logrotate/chheda /etc/logrotate.d/chheda
# backups (as chheda): crontab -e  →  30 2 * * * /opt/chheda/app/deploy/backup/mongodump.sh >> /var/log/chheda/backup.log 2>&1
```
Check: `curl https://api.chhedajewellers.com/health` → `{"ok":true,"db":"up",...}` and `curl http://127.0.0.1:4100/ready` on the VPS.

## 5. `.env` on the VPS (production values)
```
NODE_ENV=production
API_PORT=4000
WORKER_PORT=4100
MONGO_URI=mongodb+srv://…
WEB_ORIGIN=https://rate.chhedajewellers.com
WEB_PUBLIC_URL=https://rate.chhedajewellers.com
MEDIA_BASE_URL=https://api.chhedajewellers.com
ENCRYPTION_KEY=<openssl rand -base64 32>
SESSION_TTL_HOURS=12
DRY_RUN=true                      # keep true until the go-live plan says otherwise
STORAGE_DRIVER=cloudinary
CLOUDINARY_CLOUD_NAME=… CLOUDINARY_API_KEY=… CLOUDINARY_API_SECRET=… CLOUDINARY_FOLDER=chheda
META_GRAPH_VERSION=v21.0
META_APP_ID=… META_APP_SECRET=… META_WEBHOOK_VERIFY_TOKEN=<random string>
VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:owner@chhedajewellers.com
SMTP_HOST=… SMTP_PORT=587 SMTP_SECURE=false SMTP_USER=… SMTP_PASS=… SMTP_FROM="Chheda Gold Rate <alerts@chhedajewellers.com>"
SENTRY_DSN=https://…@….ingest.sentry.io/…
IBJA_SOURCE=api            # website during the trial
IBJA_API_TOKEN=…
```
`.env` is `chmod 600`, owned by `chheda`, and never committed. Tokens for Instagram/WhatsApp are entered in the dashboard (encrypted at rest), not in `.env`.

## 6. Vercel (dashboard)
The dashboard runs **Next.js 16** (Node ≥ 20.9; Turbopack; the request gate lives in `apps/web/proxy.ts`, Next 16's name for middleware, and runs on the Node runtime).
1. Import the GitHub repo. **Root directory:** `apps/web`. Framework: Next.js. Build command: `next build` (default). Install command: `cd ../.. && npm ci`.
   - If Vercel's monorepo detection complains, set *Root Directory* to the repo root with build command `npm run build:web` and output `apps/web/.next`.
2. Environment variables: `API_INTERNAL_URL=https://api.chhedajewellers.com` (the Next server proxies `/api/v1/*` and `/media/*` there), optional `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_APP_VERSION`.
3. Domains → add `rate.chhedajewellers.com` (CNAME above). Vercel issues TLS automatically.
4. Set `WEB_ORIGIN` on the VPS to exactly this https origin – the API's CSRF check rejects any other origin.

## 7. Meta app settings
- App → **Webhooks** → WhatsApp: callback `https://api.chhedajewellers.com/api/v1/webhooks/whatsapp`, verify token = `META_WEBHOOK_VERIFY_TOKEN`, subscribe field `messages`.
- Instagram: callback `https://api.chhedajewellers.com/api/v1/webhooks/instagram`, field `messages` (needs `instagram_manage_messages`).
- App mode **Live**; permissions approved: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_messages`, `whatsapp_business_messaging`, `whatsapp_business_management`.
- Tokens + ids go into **Dashboard → Settings → Connections** → Test connection.

## 8. Deploying an update
```bash
ssh chheda@<vps> 'cd /opt/chheda/app && ./deploy/deploy.sh'
```
`deploy.sh` pulls `main`, installs, runs the env check, restarts both services and verifies `/health`; if the health check fails it **rolls back** to the previous commit automatically.
Vercel deploys the dashboard on every push to `main` (CI must be green first – `.github/workflows/ci.yml`).

## 9. Rolling back
- VPS: `cd /opt/chheda/app && ./deploy/deploy.sh <previous-commit-sha>`.
- Vercel: Deployments → previous deployment → **Promote to Production**.
- Database: restore a backup into a *new* database name first (see comment at the bottom of `deploy/backup/mongodump.sh`), verify, then point `MONGO_URI` at it.

## 10. Monitoring
- **Uptime**: point UptimeRobot / Better Stack at `https://api.chhedajewellers.com/health` (expects HTTP 200 and `"ok":true`) every 5 min, and at the dashboard URL.
  The worker's `/ready` is only bound to localhost; expose it through Nginx (`location /worker/ready { proxy_pass http://127.0.0.1:4100/ready; }`) if you want it monitored too – it returns 503 when no scheduler tick ran in the last 3 minutes or a Meta token is invalid.
- **Errors**: Sentry projects for `chheda-api`/`chheda-worker` (Node) and the dashboard (Next). Releases are tagged with the git sha.
- **Logs**: `/var/log/chheda/api.log`, `/var/log/chheda/worker.log` (JSON lines, one `req.id` per request, rotated daily, 14 days). `journalctl -u chheda-api -f` also works.

## 11. Manual smoke test after every deploy (5 minutes)
1. `curl https://api.chhedajewellers.com/health` → `ok:true, db:up`; VPS `curl 127.0.0.1:4100/ready` → `ok:true`.
2. Open `https://rate.chhedajewellers.com` → login page loads with the emerald theme; log in as admin.
3. Dashboard banner shows today's state; Alerts badge count matches the Alerts page.
4. Enter Rate → save tomorrow's rate → **Preview image** renders both images (URLs on `res.cloudinary.com`) → **Test Send** → appears under Today's delivery as DRY RUN.
5. Settings → Connections → **Test connection** on both channels → "Connected".
6. `/staff` on a phone → shows "Nothing to share yet" or today's rate → Mark posted works.
7. Send a signed test webhook or a real "rate" WhatsApp message (after go-live) → row in Deliveries → Keyword replies.
8. Check Sentry shows the release and no new errors; check `tail -f /var/log/chheda/worker.log` prints a tick within a minute.
