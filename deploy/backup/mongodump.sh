#!/usr/bin/env bash
# Nightly logical backup of the Atlas database (in addition to Atlas' own continuous/cloud backups).
# Cron (as the chheda user):  30 2 * * * /opt/chheda/app/deploy/backup/mongodump.sh >> /var/log/chheda/backup.log 2>&1
# Requires: mongodb-database-tools (mongodump/mongorestore) and MONGO_URI in /opt/chheda/app/.env
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/chheda/app/.env}"
DEST="${BACKUP_DIR:-/var/backups/chheda}"
KEEP_DAYS="${KEEP_DAYS:-30}"
MONGO_URI=$(grep -E '^MONGO_URI=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
mkdir -p "$DEST"
STAMP=$(date +%Y-%m-%d_%H%M)
mongodump --uri="$MONGO_URI" --gzip --archive="$DEST/chheda-$STAMP.archive.gz"
find "$DEST" -name 'chheda-*.archive.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok: $DEST/chheda-$STAMP.archive.gz ($(du -h "$DEST/chheda-$STAMP.archive.gz" | cut -f1))"
# Restore (into a NEW database name first, then verify, then switch):
#   mongorestore --uri="$MONGO_URI" --gzip --archive=/var/backups/chheda/chheda-YYYY-MM-DD_HHMM.archive.gz --nsFrom='chheda_gold.*' --nsTo='chheda_gold_restored.*'
