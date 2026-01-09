import type { FastifyInstance } from 'fastify';
import fastifyBasicAuth from '@fastify/basic-auth';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';
import type { LineuDatabase } from '../db.js';
import type { LinearService } from '../services/linear.js';
import type { ClaudeSessionEvent, ClaudeAnalysis } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function registerDashboard(
  app: FastifyInstance,
  db: LineuDatabase,
  linear: LinearService
): Promise<void> {
  const dashboardUser = process.env.DASHBOARD_USER;
  const dashboardPass = process.env.DASHBOARD_PASS;

  if (!dashboardUser || !dashboardPass) {
    app.log.warn('DASHBOARD_USER or DASHBOARD_PASS not set - dashboard disabled');
    return;
  }

  // Register basic auth at app level
  await app.register(fastifyBasicAuth, {
    validate: async (username, password, req, reply) => {
      if (username !== dashboardUser || password !== dashboardPass) {
        return new Error('Invalid credentials');
      }
    },
    authenticate: true,
  });

  // Auth hook that uses app.basicAuth
  const authHook = app.basicAuth;

  // Serve static files with auth
  await app.register(async (instance) => {
    instance.addHook('onRequest', authHook);

    await instance.register(fastifyStatic, {
      root: join(__dirname, '..', 'public'),
      prefix: '/',
    });
  }, { prefix: '/dashboard' });

  // API routes with auth
  await app.register(async (instance) => {
    instance.addHook('onRequest', authHook);

    // API: Stats
    instance.get('/stats', async () => {
      return db.getStats();
    });

    // API: Recent jobs
    instance.get('/jobs', async () => {
      return db.getRecentJobs();
    });

    // API: Timeline (jobs per hour, last 24h)
    instance.get('/timeline', async () => {
      return db.getTimeline();
    });

    // API: Single job with session log and analysis
    instance.get<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
      const jobId = Number(request.params.id);

      // Input validation
      if (!Number.isInteger(jobId) || jobId <= 0) {
        return reply.status(400).send({ error: 'Invalid job ID' });
      }

      const job = db.getJob(jobId);
      if (!job) {
        return reply.status(404).send({ error: 'Job not found' });
      }

      const expectedDir = join(os.homedir(), '.lineu', 'logs');

      // Read session JSONL (structured)
      let session: ClaudeSessionEvent[] = [];
      const sessionPath = join(expectedDir, `claude-${jobId}.jsonl`);
      const resolvedPath = join(expectedDir, `claude-${jobId}.jsonl`);

      // Path traversal protection
      if (resolvedPath.startsWith(expectedDir)) {
        try {
          const content = fs.readFileSync(sessionPath, 'utf-8');
          session = content.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
        } catch {
          // File not available
        }
      }

      return {
        ...job,
        session,
        analysis: job.analysis ? JSON.parse(job.analysis) : null,
      };
    });

    // API: Create Linear issue from dry-run job
    instance.post<{ Params: { id: string } }>('/jobs/:id/create-issue', async (request, reply) => {
      const jobId = Number(request.params.id);
      if (!Number.isInteger(jobId) || jobId <= 0) {
        return reply.status(400).send({ error: 'Invalid job ID' });
      }

      const job = db.getJob(jobId);
      if (!job) {
        return reply.status(404).send({ error: 'Job not found' });
      }
      if (job.status !== 'completed' || job.linear_issue_id !== null) {
        return reply.status(400).send({ error: 'Job not eligible for issue creation' });
      }
      if (!job.analysis) {
        return reply.status(400).send({ error: 'Job has no analysis' });
      }

      const analysis = JSON.parse(job.analysis) as ClaudeAnalysis;
      const payload = JSON.parse(job.payload) as Record<string, unknown>;

      // Resolve team using suggested_team from analysis
      const team = linear.resolveTeamId(analysis.suggested_team);
      if (!team) {
        return reply.status(400).send({ error: `Team "${analysis.suggested_team}" not found. Available teams may not be loaded.` });
      }

      try {
        const issue = await linear.createIssue(team.id, payload, analysis, job.fingerprint);

        // CRITICAL: Same behavior as normal worker
        db.insertFingerprint(job.fingerprint, issue.id, issue.identifier);
        db.markCompleted(jobId, issue.id, issue.identifier, job.analysis);

        return reply.status(201).send({
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            url: issue.url
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err, jobId }, 'Failed to create Linear issue');
        return reply.status(500).send({ error: `Failed to create issue: ${message}` });
      }
    });
  }, { prefix: '/api/dashboard' });

  app.log.info('Dashboard registered at /dashboard');
}
