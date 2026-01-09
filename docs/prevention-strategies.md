# Prevention Strategies for CLI-to-API Integrations

**Project Reference**: Lineu - Error Webhook to Linear via Claude Code CLI
**Date**: 2026-01-07
**Type**: Prevention Strategies / Best Practices

---

## 1. Best Practices Checklist

### Claude Code CLI Integration

- [ ] **Close stdin explicitly** - Use `stdio: ['ignore', 'pipe', 'pipe']` to prevent process hanging
  ```typescript
  spawn('claude', [...args], {
    cwd: repoPath,
    stdio: ['ignore', 'pipe', 'pipe'], // Critical: close stdin
  });
  ```

- [ ] **Use `--output-format stream-json`** for structured, parseable output
  - Allows real-time event processing
  - Provides typed result events with predictable structure
  - Avoids fragile text parsing

- [ ] **Set explicit `--max-turns`** based on task complexity
  - Simple analysis: 3-5 turns
  - Complex investigation: 8-10 turns
  - Always set a limit to prevent runaway loops

- [ ] **Implement manual timeout handling**
  - Don't rely solely on spawn timeout
  - Use explicit `setTimeout` + `proc.kill('SIGTERM')`
  - Log timeout events for debugging

- [ ] **Create comprehensive logging**
  - Log directory with timestamped files per job
  - Capture both stdout and stderr
  - Include prompt sent for reproducibility
  - Log exit codes and parsing attempts

- [ ] **Handle streaming output correctly**
  - Buffer full output for fallback parsing
  - Track last result event for primary extraction
  - Parse incrementally for real-time feedback

### External API Integration

- [ ] **Validate ID formats before API calls**
  ```typescript
  // Linear: UUID vs team key
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(teamIdOrKey)) {
    // Resolve key to UUID via API lookup
  }
  ```

- [ ] **Cache resolved IDs**
  - Store resolved team IDs after first lookup
  - Avoid repeated API calls for static mappings

- [ ] **Implement fallback resolution chains**
  ```typescript
  // Try multiple resolution strategies
  // 1. Exact match (most specific)
  // 2. Partial match (fallback)
  // 3. Default (least specific)
  ```

- [ ] **Handle API rate limits gracefully**
  - Add exponential backoff
  - Queue requests when rate limited
  - Track rate limit headers

### Prompt Engineering for Automated Analysis

- [ ] **Set explicit investigation limits**
  ```
  IMPORTANTE: Voce tem no MAXIMO 5 buscas para investigar.
  Apos isso, DEVE responder com JSON.
  ```

- [ ] **Use directive language**
  - Portuguese: "DEVE", "IMEDIATAMENTE", "OBRIGATORIO"
  - English: "MUST", "IMMEDIATELY", "REQUIRED"
  - Emphasize constraints in CAPS

- [ ] **Provide clear output templates**
  ```json
  {
    "category": "bug|infrastructure|...",
    "priority": "critical|high|medium|low",
    "summary": "Descricao curta (max 80 chars)"
  }
  ```

- [ ] **Include escape hatches for unknown situations**
  - "Se nao encontrar codigo relevante, responda com hipotese baseada no payload"
  - Prevents infinite investigation loops

- [ ] **Request JSON-only responses**
  - "Responda APENAS com o JSON acima"
  - "Nenhum texto adicional"
  - Simplifies parsing

### Fingerprinting and Deduplication

- [ ] **Exclude dynamic fields from fingerprints**
  ```typescript
  const DYNAMIC_FIELDS = new Set([
    'timestamp', 'occurredAt', 'createdAt', 'updatedAt',
    'requestId', 'traceId', 'spanId', 'correlationId',
    'id', 'uuid', 'eventId', 'event_id', 'issueId',
  ]);
  ```

- [ ] **Handle circular references**
  ```typescript
  function removeDynamicFields(obj: unknown, seen = new WeakSet()): unknown {
    if (seen.has(obj as object)) return '[circular]';
    seen.add(obj as object);
    // ...
  }
  ```

- [ ] **Sort keys for consistent hashing**
  - JSON.stringify order is not guaranteed
  - Sort keys recursively before hashing

- [ ] **Use configurable deduplication windows**
  - Default: 7 days
  - Allow override via environment variable

---

## 2. Common Pitfalls to Avoid

### Process Management

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Not closing stdin | Process hangs indefinitely | Use `stdio: ['ignore', 'pipe', 'pipe']` |
| Using `exec` for long commands | Buffer overflow on large output | Use `spawn` with stream handling |
| No timeout handling | Zombie processes consume resources | Manual timeout + kill signal |
| Ignoring stderr | Missing error context | Capture and log stderr separately |
| Using `--output-format json` | Single JSON block, harder to parse incrementally | Use `stream-json` for events |

### API Integration

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Assuming UUIDs | Team keys rejected by Linear API | Validate format, resolve if needed |
| No fallback queries | Missing data when primary query fails | Chain multiple resolution strategies |
| Hardcoding API endpoints | Breaks in different environments | Use configuration |

### Prompt Engineering

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Open-ended investigation | Claude explores indefinitely | Set explicit turn/search limits |
| Soft language ("please", "try") | Model ignores constraints | Use directive language ("MUST", "DEVE") |
| No output template | Inconsistent response format | Provide exact JSON schema |
| Mixed response formats | Parsing becomes complex | Require JSON-only responses |
| No escape clauses | Model loops on impossible tasks | Provide fallback instructions |

### Job Processing

| Pitfall | Problem | Solution |
|---------|---------|----------|
| No deduplication | Same error creates multiple cards | Fingerprint-based deduplication |
| Processing failures silently | Errors lost, no debugging | Comprehensive error logging |
| Synchronous webhook processing | Slow webhook responses, timeouts | Queue jobs, return 202 immediately |
| No graceful shutdown | Lost jobs on restart | Handle SIGTERM/SIGINT properly |
| Single-threaded bottleneck | Slow processing | Batch processing with limits |

---

## 3. Testing Strategies

### Unit Testing

#### Claude Service Testing

```typescript
// Mock spawn for deterministic tests
import { jest } from '@jest/globals';

describe('ClaudeService', () => {
  it('should parse stream-json result events', () => {
    const output = `{"type":"progress","data":"searching..."}
{"type":"result","result":{"category":"bug","priority":"high","summary":"Test"}}`;

    const result = parseStreamOutput(output, null);
    expect(result.category).toBe('bug');
  });

  it('should extract JSON from markdown code blocks', () => {
    const output = '```json\n{"category":"bug"}\n```';
    const result = extractJsonFromText(output);
    expect(result.category).toBe('bug');
  });

  it('should timeout long-running processes', async () => {
    // Simulate hanging process
    const service = new ClaudeService({ maxTurns: 3, timeout: 1000 });
    await expect(service.analyze('/repo', {}))
      .rejects.toThrow('timed out');
  });
});
```

#### Fingerprint Testing

```typescript
describe('generateFingerprint', () => {
  it('should ignore timestamp fields', () => {
    const payload1 = { error: 'test', timestamp: '2026-01-01' };
    const payload2 = { error: 'test', timestamp: '2026-01-02' };

    expect(generateFingerprint(payload1)).toBe(generateFingerprint(payload2));
  });

  it('should produce different fingerprints for different errors', () => {
    const payload1 = { error: 'error A' };
    const payload2 = { error: 'error B' };

    expect(generateFingerprint(payload1)).not.toBe(generateFingerprint(payload2));
  });

  it('should handle circular references', () => {
    const payload: Record<string, unknown> = { error: 'test' };
    payload.self = payload; // Circular

    expect(() => generateFingerprint(payload)).not.toThrow();
  });
});
```

### Integration Testing

#### Webhook Flow Testing

```typescript
describe('Webhook Integration', () => {
  let app: FastifyInstance;
  let db: LineuDatabase;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    app = await createServer(testConfig, db);
  });

  it('should queue job and return 202', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: { error: 'Test error' },
    });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toHaveProperty('jobId');
  });

  it('should deduplicate identical payloads', async () => {
    const payload = { error: 'Same error' };

    await app.inject({ method: 'POST', url: '/webhook', payload });
    await app.inject({ method: 'POST', url: '/webhook', payload });

    const jobs = db.getPendingJobs(10);
    expect(jobs.length).toBe(2); // Both queued, dedup happens in worker
  });
});
```

### End-to-End Testing

#### Full Pipeline Test

```typescript
describe('E2E: Webhook to Linear', () => {
  it('should create Linear issue from webhook', async () => {
    // 1. Send webhook
    const webhookResponse = await fetch('http://localhost:3000/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'E2E test error' }),
    });

    const { jobId } = await webhookResponse.json();

    // 2. Wait for processing
    await new Promise(resolve => setTimeout(resolve, 15000));

    // 3. Check job status
    const statusResponse = await fetch(`http://localhost:3000/jobs/${jobId}`);
    const job = await statusResponse.json();

    expect(job.status).toBe('completed');
    expect(job.linear_identifier).toMatch(/^[A-Z]+-\d+$/);
  });
});
```

### Smoke Testing Checklist

```bash
#!/bin/bash
# smoke-test.sh

echo "1. Health check..."
curl -f http://localhost:3000/health || exit 1

echo "2. Webhook accepts valid JSON..."
curl -f -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": "payload"}' || exit 1

echo "3. Webhook rejects empty payload..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" -d '{}')
[ "$STATUS" = "400" ] || exit 1

echo "4. Jobs endpoint returns 404 for missing job..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/jobs/999999)
[ "$STATUS" = "404" ] || exit 1

echo "5. Stats endpoint responds..."
curl -f http://localhost:3000/stats || exit 1

echo "All smoke tests passed!"
```

### Load Testing

```typescript
// load-test.ts
import autocannon from 'autocannon';

const result = await autocannon({
  url: 'http://localhost:3000/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ error: 'Load test error' }),
  connections: 10,
  duration: 30,
});

console.log('Requests/sec:', result.requests.average);
console.log('Latency p99:', result.latency.p99);
```

---

## 4. Recommended Architecture Patterns

### Defense in Depth for CLI Execution

```
Webhook -> Validation -> Queue -> Worker -> CLI -> Parse -> API
             |            |         |         |       |      |
             v            v         v         v       v      v
          Reject 400   SQLite    Timeout   Logging  Retry  Retry
                      fallback   + kill             chain  queue
```

### Error Handling Hierarchy

1. **Webhook Layer**: Validate JSON, return 202 immediately
2. **Queue Layer**: Persist job before any processing
3. **Worker Layer**: Mark processing, catch all exceptions
4. **CLI Layer**: Timeout, kill, capture all output
5. **Parse Layer**: Multiple extraction strategies
6. **API Layer**: Retry with backoff, cache resolutions

### Configuration Hierarchy

```
CLI Args > Environment Variables > Config File > Defaults
```

---

## 5. Monitoring Recommendations

### Key Metrics to Track

- Job queue depth (pending jobs)
- Job processing time (p50, p95, p99)
- Claude CLI execution time
- Linear API success rate
- Deduplication rate
- Error rate by category

### Log Correlation

Include in all logs:
- `jobId`: Track request through pipeline
- `fingerprint`: Identify duplicate errors
- `timestamp`: Chronological ordering
- `phase`: webhook | worker | claude | linear

### Alerting Thresholds

- Queue depth > 100: Processing backlog
- Job processing time > 5 min: Claude hanging
- Error rate > 10%: Systemic issue
- Deduplication rate < 1%: Fingerprinting may be broken

---

## Summary

The key learnings from Lineu apply broadly to any integration involving:

1. **CLI Tool Orchestration**: Always close stdin, use structured output formats, implement manual timeouts, and log everything
2. **External API Integration**: Validate ID formats, implement fallback resolution, and enrich incomplete data
3. **LLM Prompt Engineering**: Set explicit limits, use directive language, provide output templates
4. **Async Job Processing**: Queue immediately, deduplicate properly, handle failures gracefully

These patterns form a foundation for reliable, debuggable, and maintainable integrations.
