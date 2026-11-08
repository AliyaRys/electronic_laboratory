#!/bin/sh
# Registry retention (ADR-024, OPS-01): keep the ACTIVE release plus the 5
# PREVIOUS releases of the "vse" repository; delete older tags+manifests.
#
# Run one-shot from deploy/registry-compose.yml (profile "retention"); the
# daily cadence is scheduled by host cron (docs/operations/release.md).
#
# The active tag is "active"; released builds are tagged "r<git_sha>".
# Requires REGISTRY_PUSH_CREDENTIAL in the environment — a closed env-file
# value, never in Git, images or logs.
#
# SAFETY: deletion order comes ONLY from the closed release log
# (REGISTRY_RELEASE_LOG, newest first). Without the log the script REFUSES
# to delete anything and exits non-zero — it must never guess which
# releases are newest.
set -eu

REGISTRY_HOST="${REGISTRY_HOST:-registry:5000}"
REPOSITORY="${REGISTRY_REPOSITORY:-vse}"
KEEP_PREVIOUS="${RETENTION_KEEP_PREVIOUS:-5}"
AUTH="Authorization: Basic ${REGISTRY_PUSH_CREDENTIAL:?closed env-file value}"

base="https://${REGISTRY_HOST}/v2/${REPOSITORY}"
order_file="${REGISTRY_RELEASE_LOG:-/etc/vse/registry/releases.log}"

# SAFETY FIRST: refuse before touching the registry if the release log is
# missing — the deletion order must never be guessed.
if [ ! -f "$order_file" ]; then
  echo "RETENTION REFUSED: release log $order_file is missing." >&2
  echo "Without the operator's release log the newest releases cannot be" >&2
  echo "determined; nothing is deleted. Provide the log and re-run." >&2
  exit 3
fi

# Tags present in the registry (skip the rolling "active" tag).
tags=$(curl -sfS -H "$AUTH" "${base}/tags/list" | sed -n 's/.*"tags":\[\(.*\)\].*/\1/p' | tr ',' '\n' | tr -d '" ]' | grep -v '^active$' || true)

i=0
deleted=0
while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  # Only tags that really exist in the registry.
  echo "$tags" | grep -qx "$tag" || continue
  i=$((i + 1))
  if [ "$i" -gt "$((KEEP_PREVIOUS + 1))" ]; then
    echo "deleting release $tag"
    manifest=$(curl -sfS -H "$AUTH" -H 'Accept: application/vnd.oci.image.manifest.v1+json' "${base}/manifests/$tag")
    digest=$(echo "$manifest" | grep -o 'sha256:[a-f0-9]*' | head -1)
    curl -sfS -X DELETE -H "$AUTH" "${base}/manifests/${digest}" >/dev/null
    deleted=$((deleted + 1))
  fi
done < "$order_file"

echo "retention done: active + ${KEEP_PREVIOUS} previous releases kept, ${deleted} deleted"
