---
sidebar_position: 17
title: Jobs & Workers
description: Monitor background job queues and manually trigger worker runs.
---

# Jobs & Workers

OEMline uses BullMQ workers for background processing. The jobs API lets you monitor queue status and manually trigger runs.

## Queue Status

```
GET /jobs/status
```

Returns the current state of all worker queues.

```bash
curl -X GET \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/jobs/status \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "queues": {
    "sync": {
      "waiting": 0,
      "active": 1,
      "completed": 245,
      "failed": 2,
      "delayed": 0,
      "prioritized": 0
    },
    "match": { "..." : "..." },
    "index": { "..." : "..." },
    "pricing": { "..." : "..." },
    "stock": { "..." : "..." },
    "ic-match": { "..." : "..." },
    "ai-match": { "..." : "..." }
  }
}
```

Each queue reports its job counts across all states: `waiting`, `active`, `completed`, `failed`, `delayed`, and `prioritized`.

## Trigger a Job

```
POST /jobs/trigger/:queue
```

Manually trigger a job on a specific queue. This enqueues a new job immediately, bypassing the normal schedule.

```bash
curl -X POST \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/jobs/trigger/ic-match \
  -H "X-API-Key: your-api-key-here"
```

Replace `ic-match` with any valid queue name: `sync`, `match`, `index`, `pricing`, `stock`, `ic-match`, or `ai-match`.

## Worker Schedule

Workers run on the following default intervals:

| Queue | Interval | Description |
|-------|----------|-------------|
| `sync` | Every 4 hours | Syncs product catalog from TecDoc. |
| `match` | Every 2 hours | Runs the 5-priority matching engine. |
| `index` | Every 6 hours | Rebuilds the Meilisearch product index. |
| `pricing` | Continuous | Fetches and updates supplier prices. |
| `stock` | Continuous | Fetches and updates supplier stock levels. |
| `ic-match` | Every 2 hours | Runs IC-specific match phases (0 through 2C). |
| `ai-match` | On demand | AI-assisted matching for difficult cases. |

## Worker Deployment

Workers are deployed as three separate services:

| Service | Queues | Concurrency |
|---------|--------|-------------|
| Worker 1 | sync, match, index | Default (runs scheduler) |
| Worker 2 | pricing, stock | 6x concurrency |
| Worker 3 | ic-match | 1 (isolated) |

The scheduler (repeatable job registration) runs only on Worker 1. Workers 2 and 3 process jobs without scheduling their own.

## Notes

- Jobs with a `priority` field use BullMQ's prioritized state, which is included in the queue status counts.
- The `pricing` and `stock` queues run continuously rather than on a fixed schedule.
- Failed jobs can be retried by triggering the queue again via `POST /jobs/trigger/:queue`.
