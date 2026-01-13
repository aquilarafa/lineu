import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, LineuDatabase } from './db.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('createDatabase', () => {
  const testDir = path.join(os.tmpdir(), 'lineu-db-test-' + Date.now());
  const testDbPath = path.join(testDir, 'test.db');
  let db: LineuDatabase;

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    db = createDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('tracks job lifecycle from insert through completion with accurate stats', () => {
    // Start with empty stats
    let stats = db.getStats();
    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);

    // Insert a job (user submits error via webhook)
    const jobId = db.insertJob({ message: 'TypeError: undefined' }, 'abc123');
    expect(jobId).toBe(1);

    // Stats reflect pending job
    stats = db.getStats();
    expect(stats.total).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.completed).toBe(0);

    // Worker claims the job
    const claimed = db.claimNextJob();
    expect(claimed).toBeDefined();
    expect(claimed!.id).toBe(jobId);
    expect(claimed!.fingerprint).toBe('abc123');

    // Job is now processing, not pending
    stats = db.getStats();
    expect(stats.pending).toBe(0);

    // Worker completes the job
    db.markCompleted(jobId, 'issue-123', 'TEAM-1', '{"summary":"Fixed"}');

    // Final stats show completion
    stats = db.getStats();
    expect(stats.total).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(0);

    // Job details are retrievable
    const job = db.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(job?.linear_identifier).toBe('TEAM-1');
  });

  it('records failed jobs with error message for user debugging', () => {
    // Insert a job
    const jobId = db.insertJob({ message: 'Error in production' }, 'fail-hash');

    // Worker claims it
    const claimed = db.claimNextJob();
    expect(claimed).toBeDefined();

    // Analysis fails (e.g., Claude timeout, API error)
    const errorMessage = 'Claude CLI timed out after 300s';
    db.markFailed(jobId, errorMessage);

    // Stats reflect the failure
    const stats = db.getStats();
    expect(stats.total).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.completed).toBe(0);
    expect(stats.pending).toBe(0);

    // Error message is preserved for debugging
    const job = db.getJob(jobId);
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe(errorMessage);
    expect(job?.processed_at).toBeDefined();
  });

  it('deduplicates repeat errors by fingerprint to avoid duplicate Linear issues', () => {
    const fingerprint = 'same-error-hash';

    // First occurrence: insert job and complete with fingerprint
    const firstJobId = db.insertJob({ message: 'TypeError at line 42' }, fingerprint);
    db.claimNextJob();
    db.completeJobWithFingerprint(firstJobId, fingerprint, 'issue-abc', 'TEAM-99', '{"root_cause":"null ref"}');

    // Verify fingerprint is stored
    const found = db.findFingerprint(fingerprint, 7);
    expect(found).toBeDefined();
    expect(found!.linear_identifier).toBe('TEAM-99');

    // Second occurrence: same error comes in again
    const secondJobId = db.insertJob({ message: 'TypeError at line 42' }, fingerprint);
    db.claimNextJob();

    // Worker finds existing fingerprint, marks as duplicate
    db.markDuplicate(secondJobId, 'TEAM-99');

    // Stats show 1 completed, 1 duplicate (no new Linear issue created)
    const stats = db.getStats();
    expect(stats.completed).toBe(1);
    expect(stats.duplicate).toBe(1);

    // Second job links to original Linear issue
    const job = db.getJob(secondJobId);
    expect(job?.status).toBe('duplicate');
    expect(job?.linear_identifier).toBe('TEAM-99');
  });

  it('getRecentJobs returns job history for dashboard with processing duration', () => {
    // Users view the dashboard to monitor job processing status

    // Create jobs in various states
    const job1 = db.insertJob({ message: 'First error' }, 'hash-1');
    const job2 = db.insertJob({ message: 'Second error' }, 'hash-2');
    const job3 = db.insertJob({ message: 'Third error' }, 'hash-3');

    // Complete job1 (success)
    db.claimNextJob();
    db.markCompleted(job1, 'issue-1', 'ENG-100', '{"summary":"Fixed"}');

    // Fail job2 (error)
    db.claimNextJob();
    db.markFailed(job2, 'Claude timeout');

    // Leave job3 pending

    // Fetch recent jobs for dashboard display
    const recentJobs = db.getRecentJobs();

    // Most recent first (job3 created last)
    expect(recentJobs.length).toBe(3);

    // Pending job - no duration yet
    const pendingJob = recentJobs.find(j => j.id === job3);
    expect(pendingJob?.status).toBe('pending');
    expect(pendingJob?.duration_seconds).toBeNull();
    expect(pendingJob?.processed_at).toBeNull();

    // Completed job - has Linear identifier and duration
    const completedJob = recentJobs.find(j => j.id === job1);
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.linear_identifier).toBe('ENG-100');
    expect(completedJob?.duration_seconds).toBeDefined();

    // Failed job - has error message and duration
    const failedJob = recentJobs.find(j => j.id === job2);
    expect(failedJob?.status).toBe('failed');
    expect(failedJob?.error).toBe('Claude timeout');
    expect(failedJob?.processed_at).toBeDefined();
  });

  it('dry-run completes job with analysis but no Linear issue', () => {
    // Users run --dry-run to test the system without creating real Linear issues
    // This is recommended before going live to verify analysis quality

    const jobId = db.insertJob({ message: 'Test error for dry-run' }, 'dry-run-hash');
    db.claimNextJob();

    // Worker completes in dry-run mode (no Linear issue ID)
    const analysis = '{"root_cause":"Missing null check","fix":"Add validation"}';
    db.markCompletedDryRun(jobId, analysis);

    // Job is completed
    const job = db.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(job?.processed_at).toBeDefined();

    // Analysis is stored for user review
    expect(job?.analysis).toBe(analysis);

    // No Linear issue created (dry-run mode)
    expect(job?.linear_issue_id).toBeNull();
    expect(job?.linear_identifier).toBeNull();

    // Stats count it as completed
    const stats = db.getStats();
    expect(stats.completed).toBe(1);
  });
});
