import type { FastifyInstance } from 'fastify';
import fastifyBasicAuth from '@fastify/basic-auth';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { LineuDatabase } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function registerDashboard(
  app: FastifyInstance,
  db: LineuDatabase
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
  }, { prefix: '/api/dashboard' });

  app.log.info('Dashboard registered at /dashboard');
}
