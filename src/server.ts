import Fastify, { FastifyInstance } from 'fastify';
import type { LineuConfig } from './types.js';
import type { LineuDatabase } from './db.js';
import { generateFingerprint } from './lib/fingerprint.js';
import { registerDashboard } from './dashboard/routes.js';

export async function createServer(
  config: LineuConfig,
  db: LineuDatabase
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // Generic webhook endpoint - accepts any valid JSON
  app.post('/webhook', async (request, reply) => {
    const payload = request.body as Record<string, unknown>;

    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      return reply.status(400).send({ error: 'Empty or invalid JSON payload' });
    }

    const fingerprint = generateFingerprint(payload);
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

  // Job status endpoint
  app.get<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
    const { id } = request.params;
    const job = db.getJob(Number(id));

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return reply.send(job);
  });

  // Stats endpoint
  app.get('/stats', async () => {
    return db.getStats();
  });

  // Dashboard
  await registerDashboard(app, db);

  return app;
}
