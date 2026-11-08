# syntax=docker/dockerfile:1

# Small offline tools image for the private registry one-shots (retention,
# backup): alpine + curl, with the deploy scripts baked in read-only use.
# The alpine digest is verified by `docker pull` + `docker image inspect`
# before release (ADR-024).

FROM alpine:3.23.2@sha256:865b95f46d98cf867a156fe4a135ad3fe50d2056aa3f25ed31662dff6da4eb62

RUN apk add --no-cache curl

COPY registry-retention.sh /usr/local/bin/registry-retention.sh
COPY registry-backup.sh /usr/local/bin/registry-backup.sh
COPY registry-nginx.conf /etc/vse/registry/nginx/default.conf

RUN chmod 0555 /usr/local/bin/registry-retention.sh /usr/local/bin/registry-backup.sh
