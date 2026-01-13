import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from './server.js';
import { createDatabase, LineuDatabase } from './db.js';
import { LinearService } from './services/linear.js';
import type { LineuConfig } from './types.js';
import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('POST /webhook with external fingerprint', () => {
  let testDir: string;
  let db: LineuDatabase;
  let app: FastifyInstance;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), 'lineu-server-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    const testDbPath = path.join(testDir, 'test.db');
    fs.mkdirSync(testDir, { recursive: true });
    db = createDatabase(testDbPath);

    const testConfig: LineuConfig = {
      server: { port: 3000 },
      repo: { path: '/tmp/test-repo' },
      database: { path: testDbPath },
      claude: { maxTurns: 10, timeout: 30000 },
      linear: { apiKey: 'test-key' },
      deduplication: { windowDays: 7 },
      worker: { pollInterval: 10000, gitPullInterval: 60000 },
    };

    const linear = new LinearService({ apiKey: 'test-key' });
    app = await createServer(testConfig, db, linear);
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('uses external fingerprint when valid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint: 'my-custom-fingerprint',
        error: 'TestError',
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.fingerprint).toBe('my-custom-fingerprint');
  });

  it('generates fingerprint when external is null', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint: null,
        error: 'TestError',
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.fingerprint).not.toBe(null);
    expect(body.fingerprint).toHaveLength(32); // SHA-256 truncated
  });

  it('generates fingerprint when external is empty string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint: '',
        error: 'TestError',
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.fingerprint).toHaveLength(32);
  });

  it('generates fingerprint when external is zero', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint: 0,
        error: 'TestError',
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.fingerprint).toHaveLength(32);
  });

  it('generates fingerprint when external is whitespace only', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint: '   ',
        error: 'TestError',
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.fingerprint).toHaveLength(32);
  });

  it('generates fingerprint when external is not provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        error: 'TestError',
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.fingerprint).toHaveLength(32);
  });

  it('rejects duplicate fingerprint when job is pending', async () => {
    // First request creates a job
    const response1 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint: 'dup-test',
        error: 'Error1',
      },
    });

    expect(response1.statusCode).toBe(202);
    const body1 = JSON.parse(response1.body);
    expect(body1.status).toBe('queued');
    expect(body1.fingerprint).toBe('dup-test');

    // Second request with same fingerprint is rejected as duplicate
    const response2 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint: 'dup-test',
        error: 'Error2',
      },
    });

    expect(response2.statusCode).toBe(200);
    const body2 = JSON.parse(response2.body);
    expect(body2.status).toBe('duplicate');
    expect(body2.fingerprint).toBe('dup-test');
    expect(body2.existingJobId).toBe(body1.jobId);
  });

  it('rejects duplicate fingerprint when already completed', async () => {
    const fingerprint = 'completed-dup-test';

    // Simulate a completed job by inserting fingerprint directly
    db.insertFingerprint(fingerprint, 'issue-123', 'TEAM-1');

    // Request with same fingerprint is rejected
    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint,
        error: 'TestError',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('duplicate');
    expect(body.fingerprint).toBe(fingerprint);
    expect(body.existingIssue).toBe('TEAM-1');
  });

  it('allows different fingerprints', async () => {
    // First request
    const response1 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint: 'fingerprint-1',
        error: 'Error1',
      },
    });

    expect(response1.statusCode).toBe(202);

    // Second request with different fingerprint
    const response2 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint: 'fingerprint-2',
        error: 'Error2',
      },
    });

    expect(response2.statusCode).toBe(202);
    const body2 = JSON.parse(response2.body);
    expect(body2.status).toBe('queued');
  });
});
