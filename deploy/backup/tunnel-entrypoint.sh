#!/bin/sh
set -eu
umask 077
install -m 0600 /run/secrets/vse_backup_tunnel_key /tmp/tunnel-key
install -m 0600 /run/secrets/vse_backup_known_hosts /tmp/known-hosts
exec ssh \
  -F /etc/vse-backup/tunnel.conf \
  -N vse-backup-tunnel
