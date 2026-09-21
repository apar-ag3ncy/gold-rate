#!/usr/bin/env bash
# Update the server to the latest main: pull, install, check env, rebuild the dashboard, restart, verify – with automatic rollback.
# Run as the chheda user in /opt/chheda/app:   ./deploy/deploy.sh            (or  ./deploy/deploy.sh <commit-sha>  to roll back)
set -euo pipefail
cd /opt/chheda/app
PREV=$(git rev-parse --short HEAD)
git fetch --quiet origin main
git checkout --quiet "${1:-origin/main}"

build() {
  npm ci --no-audit --no-fund --loglevel=error
  echo "APP_VERSION=$(git rev-parse --short HEAD)" > .env.version
  node_modules/.bin/tsx apps/api/scripts/check-env.mjs .env
  if systemctl is-enabled --quiet chheda-web 2>/dev/null; then
    NODE_ENV=production API_INTERNAL_URL=http://127.0.0.1:4000 NEXT_TELEMETRY_DISABLED=1 npm run build:web --silent
    sudo systemctl restart chheda-api chheda-worker chheda-web
  else
    sudo systemctl restart chheda-api chheda-worker        # split setup (API server + Vercel dashboard)
  fi
}
healthy() {
  curl -fsS http://127.0.0.1:4000/health >/dev/null && curl -fsS http://127.0.0.1:4100/health >/dev/null || return 1
  if systemctl is-enabled --quiet chheda-web 2>/dev/null; then curl -fsS -o /dev/null http://127.0.0.1:3000/login || return 1; fi
}

build
sleep 6
if healthy; then
  echo "deployed $(git rev-parse --short HEAD) (previous: $PREV)"
else
  echo "HEALTH CHECK FAILED – rolling back to $PREV"
  git checkout --quiet "$PREV"
  build
  exit 1
fi
