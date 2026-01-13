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
  const testDir = path.join(os.tmpdir(), 'lineu-server-test-' + Date.now());
  const testDbPath = path.join(testDir, 'test.db');
  let db: LineuDatabase;
  let app: FastifyInstance;

  const testConfig: LineuConfig = {
    server: { port: 3000 },
    repo: { path: '/tmp/test-repo' },
    database: { path: testDbPath },
    claude: { maxTurns: 10, timeout: 30000 },
    linear: { apiKey: 'test-key' },
    deduplication: { windowDays: 7 },
    worker: { pollInterval: 10000, gitPullInterval: 60000 },
  };

  beforeEach(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    db = createDatabase(testDbPath);
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

  it('uses external fingerprint for deduplication', async () => {
    // First request with custom fingerprint
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
    expect(body1.fingerprint).toBe('dup-test');

    // Second request with same fingerprint but different payload
    const response2 = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        fingerprint: 'dup-test',
        error: 'Error2',
      },
    });

    expect(response2.statusCode).toBe(202);
    const body2 = JSON.parse(response2.body);
    expect(body2.fingerprint).toBe('dup-test');

    // Both jobs have same fingerprint for deduplication
    const job1 = db.getJob(body1.jobId);
    const job2 = db.getJob(body2.jobId);
    expect(job1?.fingerprint).toBe(job2?.fingerprint);
  });
});
