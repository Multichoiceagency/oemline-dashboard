#!/bin/sh
set -e

# Resolve MinIO/Meilisearch FQDNs inside Docker — Traefik proxy runs on the host
for FQDN in $MINIO_ENDPOINT $MEILI_HOST; do
  FQDN=$(echo "$FQDN" | sed 's|https\?://||;s|/.*||;s|:.*||')
  [ -z "$FQDN" ] && continue
  if ! getent hosts "$FQDN" >/dev/null 2>&1; then
    HOST_IP=$(getent hosts host.docker.internal 2>/dev/null | awk '{print $1}')
    [ -z "$HOST_IP" ] && HOST_IP=$(route -n 2>/dev/null | awk '/^0\.0\.0\.0/{print $2}' | head -1)
    [ -z "$HOST_IP" ] && HOST_IP="172.17.0.1"
    echo "$HOST_IP $FQDN" >> /etc/hosts 2>/dev/null || true
    echo "Resolved $FQDN -> $HOST_IP via Docker host gateway"
  fi
done

echo "Running Prisma db push (create/update tables)..."
timeout 30 npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "Warning: prisma db push timed out or failed, tables may already exist"

echo "Starting application..."
if [ -n "$APP_CMD" ]; then
  echo "Using APP_CMD: $APP_CMD"
  exec $APP_CMD
else
  exec "$@"
fi
