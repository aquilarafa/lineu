# Lineu Architecture

## Diagram

```
+------------------+
|  Error Source    |
|  (New Relic,     |
|   Sentry, etc)   |
+--------+---------+
         |
   POST any JSON
         |
         v
+------------------+     +------------------+
|  Lineu Server    |---->|    SQLite DB     |
|                  |     |  - jobs (queue)  |
|  POST /webhook   |     |  - fingerprints  |
|  GET /health     |     +--------+---------+
|  GET /stats      |              |
+------------------+              |
                                  | Worker reads
      +---------------------------+ pending jobs (10s)
      |
      v
+------------------+     +------------------+
|  Background      |     |  Configured      |
|  Worker          |---->|  Repository      |
|                  |     |                  |
|  - Process jobs  |     |  git pull (5min) |
+--------+---------+     +------------------+
         |
         | Runs Claude Code
         v
+------------------+
|  Claude Code CLI |
|                  |
|  $ claude -p     |
|    --output json |
+--------+---------+
         |
         v
+------------------+
|  Linear API      |
|                  |
|  Creates issue:  |
|  - Analysis      |
|  - Files         |
|  - Suggestions   |
+------------------+
```

## Processing Flow

1. **Webhook receives error** - Saves job to SQLite and returns 202 immediately
2. **Worker processes** - Reads pending jobs every 10 seconds
3. **Git sync** - Pull runs every 5 minutes (independent of jobs)
4. **Failure handling** - If Claude/Linear fails, job becomes `failed` (no junk issue created)

## Main Components

| Component | File | Responsibility |
|-----------|------|----------------|
| CLI | `src/index.ts` | Entry point, serve/test/stats commands |
| Server | `src/server.ts` | Fastify endpoints (webhook, health, stats, dashboard) |
| Worker | `src/worker.ts` | Background job processing loop |
| Database | `src/db.ts` | SQLite layer for jobs and fingerprints |
| Claude | `src/services/claude.ts` | Claude CLI integration |
| Linear | `src/services/linear.ts` | Issue creation via SDK |

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhook` | Receives errors (any JSON) |
| GET | `/health` | Health check |
| GET | `/stats` | Job statistics |
| GET | `/dashboard` | Web dashboard (requires authentication) |
