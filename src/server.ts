import Fastify, { FastifyInstance } from 'fastify';
import type { LineuConfig } from './types.js';
import type { LineuDatabase } from './db.js';
import { generateFingerprint } from './lib/fingerprint.js';
import { NewRelicService } from './services/newrelic.js';
import { registerDashboard } from './dashboard/routes.js';

// New Relic webhook payload structure
interface NewRelicWebhookPayload {
  id?: string;
  issueUrl?: string;
  title?: string;
  priority?: string;
  impactedEntities?: string[];
  state?: string;
  sources?: string[];
  alertPolicyNames?: string[];
  alertConditionNames?: string[];
  error?: {
    message?: string;
    transaction?: string[];
    host?: string;
  };
  entity?: {
    guid?: string[];
    type?: string[];
  };
  [key: string]: unknown;
}

export async function createServer(
  config: LineuConfig,
  db: LineuDatabase
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // Initialize New Relic service if configured
  const newrelic = config.newrelic
    ? new NewRelicService(config.newrelic)
    : null;

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

  // New Relic specific webhook - enriches payload with NerdGraph data
  app.post('/webhook/newrelic', async (request, reply) => {
    const payload = request.body as NewRelicWebhookPayload;

    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      return reply.status(400).send({ error: 'Empty or invalid JSON payload' });
    }

    // Build enriched payload
    const enrichedPayload: Record<string, unknown> = {
      source: 'newrelic',
      original: payload,
      enriched: null as unknown,
    };

    // Try to enrich with NerdGraph data
    if (newrelic) {
      try {
        const issueId = payload.id;
        let found = false;

        // 1. Try by issue ID (preferred - gets exact issue details)
        if (issueId && !found) {
          app.log.info(`Fetching issue details for ID: ${issueId}`);
          const issue = await newrelic.getIssueById(issueId);

          if (issue && issue.entityGuids.length > 0) {
            // Use entity GUID from issue to get error details
            const entityGuid = issue.entityGuids[0];
            const errors = await newrelic.getErrorsByEntityGuid(entityGuid, '7 days ago');

            if (errors.length > 0) {
              enrichedPayload.enriched = {
                issue,
                errorDetails: errors[0],
                recentErrors: errors,
                queryType: 'issueId',
              };
              app.log.info(`Enriched with issue ${issueId} and ${errors.length} errors`);
              found = true;
            }
          }
        }

        // 2. Fallback: try by transaction name
        const transactionName = payload.error?.transaction?.[0];
        if (transactionName && !found) {
          const errorDetails = await newrelic.getErrorDetails(transactionName, '7 days ago');
          if (errorDetails) {
            enrichedPayload.enriched = {
              errorDetails,
              queryType: 'transaction',
            };
            app.log.info(`Enriched with error details for transaction: ${transactionName}`);
            found = true;
          }
        }

        // 3. Fallback: try by entity GUID from payload
        const entityGuid = payload.entity?.guid?.[0];
        if (entityGuid && !found) {
          const errors = await newrelic.getErrorsByEntityGuid(entityGuid, '7 days ago');
          if (errors.length > 0) {
            enrichedPayload.enriched = {
              errorDetails: errors[0],
              recentErrors: errors,
              queryType: 'entityGuid',
            };
            app.log.info(`Enriched with ${errors.length} errors for entity: ${entityGuid}`);
            found = true;
          }
        }

        // 4. Fallback: get recent errors from the app
        const appName = payload.impactedEntities?.[0];
        if (appName && !found) {
          const errors = await newrelic.getRecentErrors(appName, '1 day ago', 3);
          if (errors.length > 0) {
            enrichedPayload.enriched = {
              errorDetails: errors[0],
              recentErrors: errors,
              queryType: 'appName',
              note: `No errors found for specific issue, showing recent errors from ${appName}`,
            };
            app.log.info(`Enriched with ${errors.length} recent errors from app: ${appName}`);
            found = true;
          }
        }

        if (!found) {
          app.log.info('No error details found in New Relic');
        }
      } catch (err) {
        app.log.error(`Failed to query NerdGraph API: ${err}`);
        enrichedPayload.nerdGraphFailed = true;
        enrichedPayload.nerdGraphError = err instanceof Error ? err.message : String(err);
      }
    } else {
      app.log.warn('New Relic API not configured - proceeding without enrichment');
    }

    const fingerprint = generateFingerprint(payload);
    const jobId = db.insertJob(enrichedPayload, fingerprint);

    return reply.status(202).send({
      status: 'queued',
      jobId,
      fingerprint,
      enriched: enrichedPayload.enriched !== null,
    });
  });

  // Health check endpoint
  app.get('/health', async () => ({
    status: 'ok',
    repo: config.repo.path,
    newrelicConfigured: newrelic !== null,
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
