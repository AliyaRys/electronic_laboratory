#!/bin/sh
# Registry retention (ADR-024, OPS-01): keep the ACTIVE release plus the 5
# PREVIOUS releases of the "vse" repository; delete older tags+manifests.
#
# Run one-shot from deploy/registry-compose.yml (profile "retention"); the
# daily cadence is scheduled by host cron (docs/operations/release.md).
#
# The active tag is "active"; released builds are tagged "r<git_sha>".
# Requires REGISTRY_AUTH credentials in the environment (H) — closed value.
set -eu

REGISTRY_HOST="${REGISTRY_HOST:-registry:5000}"
REPOSITORY="${REGISTRY_REPOSITORY:-vse}"
KEEP_PREVIOUS="${RETENTION_KEEP_PREVIOUS:-5}"
AUTH="Authorization: Basic ${REGISTRY_PUSH_CREDENTIAL:?closed env-file value}"

base="https://${REGISTRY_HOST}/v2/${REPOSITORY}"

# List release tags (skip "active"), newest first by manifest push time is not
# exposed by Distribution; the ordering contract is the release log in the
# manifest directory on the operator host: tags r<git_sha> sorted by date.
tags=$(curl -sfS -H "$AUTH" "${base}/tags/list" | sed -n 's/.*"tags":\[\(.*\)\].*/\1/p' | tr ',' '\n' | tr -d '" ]' | grep -v '^active$' || true)

# Order by the release manifest registry on the host volume, newest first.
released=$(ls -1 /var/lib/registry 2>/dev/null || true) # placeholder, real order from releases.log
order_file="${REGISTRY_RELEASE_LOG:-/etc/vse/registry/releases.log}"
if [ -f "$order_file" ]; then
  newest=$(cat "$order_file")
else
  newest="$tags" # fallback: alphabetical, operator resolves the active one
fi

i=0
echo "$newest" | while read -r tag; do
  [ -n "$tag" ] || continue
  echo "$tags" | grep -qx "$tag" || continue
  i=$((i + 1))
  if [ "$i" -gt "$((KEEP_PREVIOUS + 1))" ]; then
    echo "deleting release $tag"
    manifest=$(curl -sfS -H "$AUTH" -H 'Accept: application/vnd.oci.image.manifest.v1+json' "${base}/manifests/$tag")
    digest=$(echo "$manifest" | grep -o 'sha256:[a-f0-9]*' | head -1)
    curl -sfS -X DELETE -H "$AUTH" "${base}/manifests/${digest}" >/dev/null
  fi
done

echo "retention done: active + ${KEEP_PREVIOUS} previous releases kept"
