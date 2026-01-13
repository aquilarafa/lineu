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

## Webhook Payload

The `/webhook` endpoint accepts any valid JSON payload. Lineu generates a fingerprint for deduplication based on the payload content (ignoring dynamic fields like timestamps and IDs).

### External Fingerprint

You can optionally provide your own fingerprint for deduplication by including a `fingerprint` field in the payload:

```json
{
  "fingerprint": "custom-error-id",
  "error": "TypeError",
  "message": "Cannot read property 'id' of undefined",
  "stack": "..."
}
```

**Validation rules:**

| Value | Behavior |
|-------|----------|
| `"abc123"` | Uses external fingerprint |
| `"custom-error-id"` | Uses external fingerprint |
| `null` | Generates automatically |
| `undefined` / absent | Generates automatically |
| `""` (empty string) | Generates automatically |
| `"   "` (whitespace only) | Generates automatically |
| `0` (zero) | Generates automatically |

**Response (new job):**

```json
{
  "status": "queued",
  "jobId": 1,
  "fingerprint": "custom-error-id"
}
```

**Response (duplicate):**

```json
{
  "status": "duplicate",
  "jobId": 2,
  "fingerprint": "custom-error-id",
  "existingIssue": "TEAM-123"
}
```

When a duplicate fingerprint is detected, a job is still created but with `status: "duplicate"` immediately. This ensures all incoming webhooks are recorded. The `existingIssue` field is included when a Linear issue already exists for that fingerprint.

This is useful when your error source (e.g., Sentry, New Relic) already provides a stable identifier for grouping errors.
