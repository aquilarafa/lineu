# Roadmap

## P1 - Critical (Before Production)

### Security
- [ ] Add webhook authentication (HMAC signature or shared secret header)
- [ ] Implement rate limiting with `@fastify/rate-limit` on all endpoints
- [x] ~~Add authentication to `/jobs/:id` endpoint~~ (removed - use `/api/dashboard/jobs/:id` with basic auth)
- [ ] Validate git repository URLs (restrict to `https://` and `git@`)
- [ ] Improve prompt injection detection (Unicode homoglyphs, encoding bypasses)

### Data Integrity
- [x] Wrap `insertFingerprint` + `markCompleted` in atomic transaction
- [ ] Implement recovery for jobs stuck in `processing` (heartbeat/lease with timeout)
- [ ] Fix race condition in deduplication (lock fingerprint before processing)

## P2 - Important

### Performance
- [ ] Cache prompt template in ClaudeService constructor (avoid sync read per job)
- [ ] Add composite index `idx_jobs_status_created ON jobs(status, created_at)`
- [ ] Add index `idx_jobs_created_at ON jobs(created_at)` for timeline queries
- [ ] Implement materialized counters for stats (avoid full table scan)
- [ ] Add exponential backoff to worker polling when queue is empty

### Security
- [ ] Use `crypto.timingSafeEqual` for dashboard credential comparison
- [ ] Configure security headers (Helmet.js or equivalent)
- [ ] Remove repository path from `/health` endpoint

### Code Quality
- [ ] Consolidate duplicate `gitPull` functions (worker.ts + lib/git.ts)
- [ ] Create centralized `lib/paths.ts` module for `~/.lineu/*` paths
- [ ] Add runtime validation for JSON.parse (safe parse wrapper)
- [ ] Add schema validation on webhook with Fastify JSON Schema
- [ ] Validate Claude output against `ClaudeAnalysis` interface
- [ ] Create type guards for error narrowing (`isErrnoException`)
- [ ] Enable foreign keys in SQLite (`PRAGMA foreign_keys = ON`)

### Maintainability
- [ ] Implement log file rotation/cleanup in `~/.lineu/logs`
- [ ] Remove legacy format support in `buildDescription` (or migrate data)
- [ ] Extract `resolveRepoPath` helper to avoid duplication in serve/test

## P3 - Nice-to-Have

### Cleanup
- [ ] Remove unused code: `getPendingJobs`, `markProcessing` in db.ts
- [ ] Remove redundant path traversal check in `dashboard/routes.ts:89`
- [ ] Simplify fingerprint to single-pass (combine `removeDynamicFields` + `sortObjectKeys`)
- [ ] Add radix to `parseInt(opts.port)` in index.ts

### Quality
- [ ] Replace `console.log` with structured logger (pino)
- [ ] Define constants for magic numbers (LIMIT 100, etc)
- [ ] Add barrel exports in `lib/index.ts`
- [ ] Consider using UUIDs instead of sequential IDs for jobs

### Tests
- [ ] Add unit tests for fingerprinting
- [ ] Add integration tests for worker loop (mock Claude/Linear)
- [ ] Add tests for database layer
- [ ] Add tests for API endpoints

## Backlog

### Features
- [ ] Change Claude prompt to English
- [ ] Allow client to configure issue language in config file (default: en)
- [ ] Implement automatic retry for jobs with transient failures
- [ ] Add worker concurrency (process multiple jobs in parallel)
- [ ] Implement migration system with versioning

### Documentation
- [ ] Create extensive documentation for Lineu server deployment (requirements, environment setup, systemd/Docker, reverse proxy, monitoring)
- [ ] Document HTTPS requirement for dashboard basic auth

### Release
- [ ] Publish repository on GitHub
- [ ] Run `npm audit` and update vulnerable dependencies
