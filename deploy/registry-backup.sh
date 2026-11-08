#!/bin/sh
# Daily registry backup (OPS-01). Copies the registry storage to the closed
# backup host path; the schedule is host cron (docs/operations/release.md):
#   15 2 * * * docker compose -f /srv/vse/deploy/registry-compose.yml run --rm backup
set -eu

BACKUP_DIR="${REGISTRY_BACKUP_DIR:-/backup}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

if [ ! -d /var/lib/registry ]; then
  echo "backup: registry storage /var/lib/registry is not mounted; refusing" >&2
  exit 3
fi

mkdir -p "${BACKUP_DIR}/${STAMP}"
tar -C /var/lib/registry -cf - . | tar -C "${BACKUP_DIR}/${STAMP}" -xf -

# Keep the last 7 daily copies; older daily copies are pruned here (the
# operator's separate host-level retention policy governs long-term archives).
ls -1d "${BACKUP_DIR}"/* | sort | head -n -7 | while read -r old; do
  rm -rf "$old"
done

echo "registry backup ${STAMP} written to the backup host"
