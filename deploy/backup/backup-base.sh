#!/bin/sh
# Daily fail-closed physical backup. Run only as the dedicated vsebackup user.
set -eu

umask 077
root=${VSE_BACKUP_ROOT:-/srv/vse-backup}
daily="$root/base/daily"
weekly="$root/base/weekly"
staging="$root/base/.staging-$$"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$daily/$stamp"
lock="$root/base/.basebackup.lock"

mkdir -p "$daily" "$weekly" "$root/evidence"
exec 9>"$lock"
flock -n 9 || { echo "base backup already running" >&2; exit 75; }
trap 'rm -rf -- "$staging"' EXIT INT TERM
mkdir -p "$staging/data"

# PGSERVICE must point at 127.0.0.1:6543 through the restricted tunnel.
pg_basebackup \
  --dbname="service=${VSE_BACKUP_PGSERVICE:-vse-replication}" \
  --pgdata="$staging/data" \
  --format=plain \
  --wal-method=stream \
  --checkpoint=fast \
  --manifest-checksums=SHA256 \
  --no-password \
  --verbose
pg_verifybackup "$staging/data"

# The PostgreSQL backup manifest is authoritative; this additional checksum
# covers operator evidence placed beside the copy.
find "$staging/data" -type f -print0 | sort -z | xargs -0 sha256sum >"$staging/SHA256SUMS"
sha256sum "$staging/data/backup_manifest" >"$staging/MANIFEST.sha256"
printf '%s\n' "$stamp" >"$staging/COMPLETED_AT_UTC"
sync -f "$staging/SHA256SUMS" "$staging/MANIFEST.sha256" "$staging/COMPLETED_AT_UTC"
mv "$staging" "$target"
trap - EXIT INT TERM

# A Sunday copy is a hard-linked immutable retention label, not a second run.
if [ "$(date -u +%u)" = 7 ]; then
  cp -al "$target" "$weekly/$stamp"
fi

# Retention is applied only after the new copy passed pg_verifybackup.
find "$daily" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr | awk 'NR>7 {$1=""; sub(/^ /,""); print}' \
  | while IFS= read -r old; do rm -rf -- "$old"; done
find "$weekly" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr | awk 'NR>4 {$1=""; sub(/^ /,""); print}' \
  | while IFS= read -r old; do rm -rf -- "$old"; done

# WAL is never pruned here. The monthly restore procedure proves a new base
# copy and then computes the safe chain boundary before explicit pruning.
printf '%s\n' "$target"
