#!/bin/sh
set -e

echo "Running Prisma db push (create/update tables)..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "Warning: prisma db push failed, tables may already exist"

echo "Starting application..."
if [ -n "$APP_CMD" ]; then
  echo "Using APP_CMD: $APP_CMD"
  exec $APP_CMD
else
  exec "$@"
fi
