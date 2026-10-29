#!/usr/bin/env bash
# Nightly backup of the demo's data folders.
# Stops the containers for a few seconds so the file index and database are copied in a
# consistent state, archives both folders, starts the containers again, and keeps the
# newest $KEEP_DAYS archives.
#
# Usage: scripts/backup.sh [backup-dir]
# Env:   DATA_ROOT (default /srv/blob), KEEP_DAYS (default 7)
set -euo pipefail

cd "$(dirname "$0")/.."

DATA_ROOT="${DATA_ROOT:-/srv/blob}"
BACKUP_DIR="${1:-/srv/backups/blob}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date +%Y-%m-%d_%H%M)"
ARCHIVE="$BACKUP_DIR/blob-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

restart() {
  docker compose start >/dev/null
}
trap restart EXIT

docker compose stop >/dev/null
tar -czf "$ARCHIVE" -C "$DATA_ROOT" floci app
restart
trap - EXIT

find "$BACKUP_DIR" -name 'blob-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
