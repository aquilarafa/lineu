import Fastify, { FastifyInstance } from 'fastify';
import type { LineuConfig } from './types.js';
import type { LineuDatabase } from './db.js';
import type { LinearService } from './services/linear.js';
import { generateFingerprint, isValidExternalFingerprint } from './lib/fingerprint.js';
import { registerDashboard } from './dashboard/routes.js';

export async function createServer(
  config: LineuConfig,
  db: LineuDatabase,
  linear: LinearService
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // Generic webhook endpoint - accepts any valid JSON
  app.post('/webhook', async (request, reply) => {
    const payload = request.body as Record<string, unknown>;

    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      return reply.status(400).send({ error: 'Empty or invalid JSON payload' });
    }

    // Use external fingerprint if valid, otherwise generate automatically
    const externalFingerprint = payload.fingerprint;
    const fingerprint = isValidExternalFingerprint(externalFingerprint)
      ? externalFingerprint
      : generateFingerprint(payload);

    // Check for duplicates before inserting
    const existing = db.findExistingByFingerprint(fingerprint, config.deduplication.windowDays);
    if (existing) {
      if (existing.type === 'completed') {
        return reply.status(200).send({
          status: 'duplicate',
          fingerprint,
          existingIssue: existing.linear_identifier,
        });
      } else {
        return reply.status(200).send({
          status: 'duplicate',
          fingerprint,
          existingJobId: existing.jobId,
        });
      }
    }

    const jobId = db.insertJob(payload, fingerprint);

    return reply.status(202).send({
      status: 'queued',
      jobId,
      fingerprint,
    });
  });

  // Health check endpoint
  app.get('/health', async () => ({
    status: 'ok',
    repo: config.repo.path,
  }));

  // Stats endpoint
  app.get('/stats', async () => {
    return db.getStats();
  });

  // Dashboard (includes /api/dashboard/jobs/:id with basic auth)
  await registerDashboard(app, db, linear);

  return app;
}
