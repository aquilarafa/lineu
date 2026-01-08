import { spawn } from 'child_process';
import type { LineuConfig } from './types.js';
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
  const processInterval = setInterval(async () => {
    if (!running) return;
    await processJobs(config, db, claude, linear);
  }, config.worker.pollInterval);

  // Git pull at configured interval
  const gitPullInterval = setInterval(async () => {
    if (!running) return;
    await gitPull(config.repo.path);
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
  const jobs = db.getPendingJobs(10);

  for (const job of jobs) {
    db.markProcessing(job.id);
    const payload = JSON.parse(job.payload) as Record<string, unknown>;

    try {
      // 1. Check for duplicate
      const existing = db.findFingerprint(job.fingerprint, config.deduplication.windowDays);

      if (existing) {
        console.log(`[Job ${job.id}] Duplicate → ${existing.linear_identifier}`);
        db.markDuplicate(job.id, existing.linear_identifier);
        continue;
      }

      // 2. Execute Claude Code
      console.log(`[Job ${job.id}] Analyzing with Claude Code...`);
      const analysis = await claude.analyze(config.repo.path, payload, job.id);

      // 3. Create Linear issue
      console.log(`[Job ${job.id}] Creating Linear issue...`);
      const issue = await linear.createIssue(payload, analysis, job.fingerprint);

      // 4. Save fingerprint and mark complete
      db.insertFingerprint(job.fingerprint, issue.id, issue.identifier);
      db.markCompleted(job.id, issue.id, issue.identifier);
      console.log(`[Job ${job.id}] Completed → ${issue.identifier}`);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Job ${job.id}] Failed: ${message}`);
      db.markFailed(job.id, message);
    }
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
