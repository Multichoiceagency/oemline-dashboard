---
sidebar_position: 3
title: Deployment
description: Deploying OEMline on Coolify with Docker — services, environment variables, and worker configuration.
---

# Deployment

OEMline is deployed on [Coolify](https://coolify.io/) (self-hosted PaaS) running on a Hetzner CCX53 server (32 vCPU, 128 GB RAM). All services run as Docker containers managed by Coolify.

## Infrastructure

```
Hetzner CCX53 (32 vCPU / 128 GB)
├── Coolify (PaaS orchestrator)
├── PostgreSQL
├── Redis
├── Meilisearch
├── API (Fastify)
├── Worker: sync/match/index (+ scheduler)
├── Worker: pricing/stock
├── Worker: ic-match
├── Dashboard (Next.js)
├── Storefront (Next.js)
└── MinIO (object storage)
```

## Docker Build

The API and workers share the same Dockerfile and image. The entrypoint script handles schema setup and process selection:

```sh
# docker-entrypoint.sh
#!/bin/sh
set -e
npx prisma db push --skip-generate --accept-data-loss
if [ -n "$APP_CMD" ]; then
  exec $APP_CMD
else
  exec "$@"
fi
```

- On every container start, `prisma db push` runs to ensure the database schema is up to date.
- The `APP_CMD` environment variable determines what process runs. The API uses the default CMD; workers set `APP_CMD=node dist/worker.js`.

## Services

| Service | Type | Notes |
|---------|------|-------|
| PostgreSQL | Database | Single instance, persistent volume |
| Redis | Cache / Queue | Used by BullMQ and API response cache |
| Meilisearch | Search | Separate Docker network; use public URL from workers |
| API | Application | Default Dockerfile CMD (Fastify server) |
| Worker (sync/match/index) | Application | `APP_CMD=node dist/worker.js`, runs scheduler |
| Worker (pricing/stock) | Application | `APP_CMD=node dist/worker.js`, 6x concurrency |
| Worker (ic-match) | Application | `APP_CMD=node dist/worker.js`, concurrency=1 |
| Dashboard | Application | Next.js, separate repo/build |
| MinIO | Storage | Product images, CSV files, FTP imports |

## Environment Variables

### Required (all services)

| Variable | Example | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://user:pass@host:5432/oemline` | PostgreSQL connection string |
| `REDIS_URL` | `redis://default:pass@host:6379/0` | Redis connection string |

### API-specific

| Variable | Example | Description |
|----------|---------|-------------|
| `MEILISEARCH_URL` | `https://meilisearch.oemline.eu` | Meilisearch public URL |
| `MEILISEARCH_KEY` | `dek5Xkf...` | Meilisearch master key |
| `NODE_OPTIONS` | `--max-old-space-size=4096` | Node.js memory limit |
| `PORT` | `3000` | API listen port |

### Worker-specific

| Variable | Example | Description |
|----------|---------|-------------|
| `APP_CMD` | `node dist/worker.js` | Overrides default CMD to run the worker |
| `WORKER_QUEUES` | `sync,match,index` | Comma-separated list of queues to handle (omit for all) |
| `WORKER_CONCURRENCY` | `6` | Default concurrency for all queues |
| `WORKER_CONCURRENCY_STOCK` | `6` | Per-queue concurrency override |
| `WORKER_CONCURRENCY_PRICING` | `6` | Per-queue concurrency override |
| `WORKER_CONCURRENCY_SYNC` | `1` | Per-queue concurrency override |
| `WORKER_CONCURRENCY_MATCH` | `1` | Per-queue concurrency override |
| `WORKER_CONCURRENCY_IC_MATCH` | `1` | Per-queue concurrency override |

## Worker Topology

Three worker services handle different queue groups to isolate workloads:

### sync/match/index worker
- **Queues**: `sync`, `match`, `index`
- **Scheduler**: Yes (creates recurring jobs per supplier)
- **Concurrency**: 1 per queue (default)
- Schedules: sync every 4h, match every 2h, index every 6h

### pricing/stock worker
- **Queues**: `pricing`, `stock`
- **Scheduler**: No
- **Concurrency**: 6 per queue
- Jobs are created on demand by the sync/match pipeline

### ic-match worker
- **Queues**: `ic-match`
- **Scheduler**: No (job scheduled by the sync/match/index worker)
- **Concurrency**: 1
- Runs InterCars CSV matching in phases (0, 1A-1D)

## Scaling

- **Horizontal**: Run additional worker containers with the same `WORKER_QUEUES` value. BullMQ distributes jobs automatically across workers sharing a queue.
- **Vertical**: Increase `WORKER_CONCURRENCY_*` to process more jobs in parallel within a single container.
- **Isolation**: Keep heavy queues (pricing, stock) on dedicated workers so they do not block sync or matching.

## Coolify Deployment

To deploy or redeploy a service via the Coolify API:

```bash
# Trigger a deploy
curl -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "https://coolify-host:8000/api/v1/deploy?uuid=<app-uuid>&force=true"

# Restart a service
curl -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "https://coolify-host:8000/api/v1/applications/<app-uuid>/restart"

# Add an environment variable
curl -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"WORKER_QUEUES","value":"pricing,stock"}' \
  "https://coolify-host:8000/api/v1/applications/<app-uuid>/envs"
```

## Troubleshooting

- **Meilisearch unreachable from workers**: Meilisearch runs on its own Docker network. Always use the public URL, not the container hostname.
- **Prisma push fails on startup**: The entrypoint tolerates failures (tables may already exist). Check PostgreSQL connectivity if it persists.
- **Jobs stuck in "waiting"**: Verify `WORKER_QUEUES` includes the target queue and that the worker container is running.
