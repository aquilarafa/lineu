import { spawn } from 'child_process';
import type { LineuConfig, ClaimedJob } from './types.js';
import type { LineuDatabase } from './db.js';
import type { ClaudeService } from './services/claude.js';
import type { LinearService } from './services/linear.js';

export interface Worker {
  stop: () => void;
}

export function startWorker(
  config: LineuConfig,
  db: LineuDatabase,
  claude: ClaudeService,
  linear: LinearService
): Worker {
  let running = true;

  // Process pending jobs at configured interval
  const processInterval = setInterval(() => {
    if (!running) return;
    processJobs(config, db, claude, linear).catch(err => {
      console.error('Worker error:', err);
    });
  }, config.worker.pollInterval);

  // Git pull at configured interval
  const gitPullInterval = setInterval(() => {
    if (!running) return;
    gitPull(config.repo.path).catch(err => {
      console.warn('Git pull error:', err);
    });
  }, config.worker.gitPullInterval);

  // Initial git pull
  gitPull(config.repo.path);

  return {
    stop: () => {
      running = false;
      clearInterval(processInterval);
      clearInterval(gitPullInterval);
    },
  };
}

async function processJobs(
  config: LineuConfig,
  db: LineuDatabase,
  claude: ClaudeService,
  linear: LinearService
): Promise<void> {
  let job: ClaimedJob | undefined;

  while ((job = db.claimNextJob())) {
    await processJob(job, config, db, claude, linear);
  }
}

async function processJob(
  job: ClaimedJob,
  config: LineuConfig,
  db: LineuDatabase,
  claude: ClaudeService,
  linear: LinearService
): Promise<void> {
  const payload = JSON.parse(job.payload) as Record<string, unknown>;

  try {
    // 0. Check if NerdGraph query failed (for newrelic webhooks)
    if (payload.nerdGraphFailed) {
      const errorMsg = payload.nerdGraphError || 'NerdGraph query failed';
      console.log(`[Job ${job.id}] Skipping - NerdGraph query failed: ${errorMsg}`);
      db.markFailed(job.id, `NerdGraph query failed: ${errorMsg}`);
      return;
    }

    // 1. Check for duplicate
    const existing = db.findFingerprint(job.fingerprint, config.deduplication.windowDays);

    if (existing) {
      console.log(`[Job ${job.id}] Duplicate → ${existing.linear_identifier}`);
      db.markDuplicate(job.id, existing.linear_identifier);
      return;
    }

    // 2. Get team context
    const teamList = linear.getTeamListForPrompt();

    // 3. Execute Claude Code
    console.log(`[Job ${job.id}] Analyzing with Claude Code...`);
    const analysis = await claude.analyze(config.repo.path, payload, job.id, teamList);

    // 4. Resolve team
    const teamId = linear.resolveTeamId(analysis.suggested_team);
    if (!teamId) {
      throw new Error(`Invalid team suggestion: ${analysis.suggested_team}`);
    }

    // 5. Create Linear issue
    console.log(`[Job ${job.id}] Creating Linear issue in team ${analysis.suggested_team}...`);
    const issue = await linear.createIssue(teamId, payload, analysis, job.fingerprint);

    // 6. Save fingerprint and mark complete
    db.insertFingerprint(job.fingerprint, issue.id, issue.identifier);
    db.markCompleted(job.id, issue.id, issue.identifier, JSON.stringify(analysis));
    console.log(`[Job ${job.id}] Completed → ${issue.identifier}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Job ${job.id}] Failed: ${message}`);
    db.markFailed(job.id, message);
  }
}

function gitPull(repoPath: string): Promise<void> {
  return new Promise((resolve) => {
    console.log('Running git pull...');
    const proc = spawn('git', ['-C', repoPath, 'pull', '--ff-only']);

    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn('Git pull failed, continuing with current state');
      } else {
        console.log('Git pull completed');
      }
      resolve();
    });

    proc.on('error', () => {
      console.warn('Git pull error, continuing with current state');
      resolve();
    });
  });
}
