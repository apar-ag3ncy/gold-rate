#!/usr/bin/env bash
# Update the VPS to the latest main: pull, install, check env, restart, verify. Run as the chheda user in /opt/chheda/app.
set -euo pipefail
cd /opt/chheda/app
PREV=$(git rev-parse --short HEAD)
git fetch --quiet origin main
git checkout --quiet "${1:-origin/main}"
npm ci --omit=dev --no-audit --no-fund
echo "APP_VERSION=$(git rev-parse --short HEAD)" > .env.version
node apps/api/scripts/check-env.mjs .env
sudo systemctl restart chheda-api chheda-worker
sleep 5
curl -fsS http://127.0.0.1:4000/health >/dev/null && curl -fsS http://127.0.0.1:4100/health >/dev/null && echo "deployed $(git rev-parse --short HEAD) (previous: $PREV)" || { echo "HEALTH CHECK FAILED – rolling back to $PREV"; git checkout --quiet "$PREV"; npm ci --omit=dev --no-audit --no-fund; sudo systemctl restart chheda-api chheda-worker; exit 1; }
