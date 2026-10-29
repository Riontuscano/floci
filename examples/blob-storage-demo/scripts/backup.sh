#!/usr/bin/env bash
# Mirrors the demo's data folders to a backup location with rsync.
# Only new or changed files are copied, so nightly runs are fast and the backup takes the
# same space as the data (not one full copy per night).
#
# The containers are stopped for the few seconds the copy takes, so the file index and
# database are copied in a consistent state.
#
# Usage: scripts/backup.sh <destination>
#   destination: a folder on another disk, e.g. /mnt/usb/blob-backup
#                or another machine,       e.g. backup@192.168.1.50:/backups/blob
# Env:   DATA_ROOT (default /srv/blob)
set -euo pipefail

cd "$(dirname "$0")/.."

DEST="${1:?Usage: scripts/backup.sh <destination folder or user@host:/path>}"
DATA_ROOT="${DATA_ROOT:-/srv/blob}"

if ! command -v rsync >/dev/null; then
  echo "rsync is not installed. Install it with: sudo apt install rsync" >&2
  exit 1
fi

restart() {
  docker compose start >/dev/null 2>&1
}
trap restart EXIT

started=$(date +%s)
docker compose stop >/dev/null 2>&1
rsync -a --delete "$DATA_ROOT/floci" "$DATA_ROOT/app" "$DEST/"
restart
trap - EXIT

echo "$(date '+%F %T') backup to $DEST done, containers were stopped for $(( $(date +%s) - started ))s"
