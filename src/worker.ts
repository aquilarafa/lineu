import { spawn } from 'child_process';
import type { LineuConfig, ClaimedJob } from './types.js';
import type { LineuDatabase } from './db.js';
import type { ClaudeService } from './services/claude.js';
import type { LinearService } from './services/linear.js';

export interface Worker {
  stop: () => void;
}

export interface WorkerOptions {
  dryRun?: boolean;
}

export function startWorker(
  config: LineuConfig,
  db: LineuDatabase,
  claude: ClaudeService,
  linear: LinearService,
  options: WorkerOptions = {}
): Worker {
  let running = true;
  const { dryRun = false } = options;

  if (dryRun) {
    console.log('[Worker] Running in DRY-RUN mode - no Linear issues will be created');
  }

  // Process pending jobs at configured interval
  const processInterval = setInterval(() => {
    if (!running) return;
    processJobs(config, db, claude, linear, dryRun).catch(err => {
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
  linear: LinearService,
  dryRun: boolean
): Promise<void> {
  let job: ClaimedJob | undefined;

  while ((job = db.claimNextJob())) {
    await processJob(job, config, db, claude, linear, dryRun);
  }
}

async function processJob(
  job: ClaimedJob,
  config: LineuConfig,
  db: LineuDatabase,
  claude: ClaudeService,
  linear: LinearService,
  dryRun: boolean
): Promise<void> {
  const payload = JSON.parse(job.payload) as Record<string, unknown>;

  try {
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

    // 4. Resolve team (with fallback to first team)
    const team = linear.resolveTeamId(analysis.suggested_team);
    if (!team) {
      throw new Error('No teams available in Linear');
    }

    // 5. Create Linear issue (or skip in dry-run mode)
    if (dryRun) {
      console.log(`[Job ${job.id}] DRY-RUN: Would create issue in team ${team.key}`);
      console.log(`[Job ${job.id}] Analysis:`, JSON.stringify(analysis, null, 2));
      db.markCompletedDryRun(job.id, JSON.stringify(analysis));
      console.log(`[Job ${job.id}] Completed (dry-run)`);
    } else {
      console.log(`[Job ${job.id}] Creating Linear issue in team ${team.key}...`);
      const issue = await linear.createIssue(team.id, payload, analysis, job.fingerprint);

      // 6. Save fingerprint and mark complete (atomic transaction)
      db.completeJobWithFingerprint(job.id, job.fingerprint, issue.id, issue.identifier, JSON.stringify(analysis));
      console.log(`[Job ${job.id}] Completed → ${issue.identifier}`);
    }

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
