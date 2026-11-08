# syntax=docker/dockerfile:1
FROM alpine:3.23.2@sha256:865b95f46d98cf867a156fe4a135ad3fe50d2056aa3f25ed31662dff6da4eb62

RUN apk add --no-cache openssh-client \
    && addgroup -S tunnel \
    && adduser -S -G tunnel -h /home/tunnel tunnel

COPY tunnel.conf /etc/vse-backup/tunnel.conf
COPY tunnel-entrypoint.sh /usr/local/bin/tunnel-entrypoint.sh
RUN chmod 0444 /etc/vse-backup/tunnel.conf \
    && chmod 0555 /usr/local/bin/tunnel-entrypoint.sh

USER tunnel
ENTRYPOINT ["/usr/local/bin/tunnel-entrypoint.sh"]
