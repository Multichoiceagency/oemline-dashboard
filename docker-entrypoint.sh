#!/bin/sh
set -e

# Resolve MinIO FQDN inside Docker — Traefik proxy runs on the host
if [ -n "$MINIO_ENDPOINT" ] && ! getent hosts "$MINIO_ENDPOINT" >/dev/null 2>&1; then
  HOST_IP=$(getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || echo "")
  if [ -z "$HOST_IP" ]; then
    HOST_IP=$(ip route | awk '/default/{print $3}' 2>/dev/null || echo "172.17.0.1")
  fi
  echo "$HOST_IP $MINIO_ENDPOINT" >> /etc/hosts 2>/dev/null || true
  echo "Added $MINIO_ENDPOINT -> $HOST_IP to /etc/hosts"
fi

echo "Running Prisma db push (create/update tables)..."
timeout 30 npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "Warning: prisma db push timed out or failed, tables may already exist"

echo "Starting application..."
if [ -n "$APP_CMD" ]; then
  echo "Using APP_CMD: $APP_CMD"
  exec $APP_CMD
else
  exec "$@"
fi
