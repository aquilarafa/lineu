import Database from 'better-sqlite3';
import type { Job, ClaimedJob, DashboardJob, TimelineEntry } from './types.js';

const SCHEMA = `
-- Job queue for async processing
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending | processing | completed | failed | duplicate
  error TEXT,
  analysis TEXT,
  linear_issue_id TEXT,
  linear_identifier TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint ON jobs(fingerprint);

-- Fingerprints for deduplication
CREATE TABLE IF NOT EXISTS fingerprints (
  hash TEXT PRIMARY KEY,
  linear_issue_id TEXT NOT NULL,
  linear_identifier TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export interface LineuDatabase {
  // Jobs
  insertJob: (payload: Record<string, unknown>, fingerprint: string) => number;
  getJob: (id: number) => Job | undefined;
  getPendingJobs: (limit: number) => Job[];
  claimNextJob: () => ClaimedJob | undefined;
  markProcessing: (id: number) => void;
  markCompleted: (id: number, linearIssueId: string, linearIdentifier: string, analysis: string) => void;
  markCompletedDryRun: (id: number, analysis: string) => void;
  markFailed: (id: number, error: string) => void;
  markDuplicate: (id: number, linearIdentifier: string) => void;

  // Fingerprints
  findFingerprint: (hash: string, windowDays: number) => { linear_identifier: string } | undefined;
  insertFingerprint: (hash: string, linearIssueId: string, linearIdentifier: string) => void;

  // Stats
  getStats: () => { total: number; pending: number; completed: number; failed: number; duplicate: number };

  // Dashboard
  getRecentJobs: () => DashboardJob[];
  getTimeline: () => TimelineEntry[];

  close: () => void;
}

export function createDatabase(dbPath: string): LineuDatabase {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  // Migration: add analysis column if missing (for existing databases)
  const columns = db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
  if (!columns.some(c => c.name === 'analysis')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN analysis TEXT`);
  }

  const insertJobStmt = db.prepare(`
    INSERT INTO jobs (payload, fingerprint) VALUES (?, ?)
  `);

  const getJobStmt = db.prepare(`
    SELECT id, payload, fingerprint, status, error, analysis, linear_issue_id, linear_identifier, created_at, processed_at
    FROM jobs WHERE id = ?
  `);

  const getPendingJobsStmt = db.prepare(`
    SELECT id, payload, fingerprint, status FROM jobs
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?
  `);

  const claimNextJobStmt = db.prepare(`
    UPDATE jobs
    SET status = 'processing'
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING id, payload, fingerprint
  `);

  const markProcessingStmt = db.prepare(`
    UPDATE jobs SET status = 'processing' WHERE id = ?
  `);

  const markCompletedStmt = db.prepare(`
    UPDATE jobs SET status = 'completed', linear_issue_id = ?, linear_identifier = ?, analysis = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?
  `);

  const markCompletedDryRunStmt = db.prepare(`
    UPDATE jobs SET status = 'completed', analysis = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?
  `);

  const markFailedStmt = db.prepare(`
    UPDATE jobs SET status = 'failed', error = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?
  `);

  const markDuplicateStmt = db.prepare(`
    UPDATE jobs SET status = 'duplicate', linear_identifier = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?
  `);

  const findFingerprintStmt = db.prepare(`
    SELECT linear_identifier FROM fingerprints
    WHERE hash = ? AND created_at > datetime('now', '-' || ? || ' days')
  `);

  const insertFingerprintStmt = db.prepare(`
    INSERT OR IGNORE INTO fingerprints (hash, linear_issue_id, linear_identifier)
    VALUES (?, ?, ?)
  `);

  const getStatsStmt = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
      COALESCE(SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END), 0) as duplicate
    FROM jobs
  `);

  const getRecentJobsStmt = db.prepare(`
    SELECT
      id,
      fingerprint,
      status,
      error,
      linear_identifier,
      created_at,
      processed_at,
      CASE
        WHEN processed_at IS NOT NULL
        THEN (julianday(processed_at) - julianday(created_at)) * 86400
        ELSE NULL
      END as duration_seconds
    FROM jobs
    ORDER BY created_at DESC
    LIMIT 100
  `);

  const getTimelineStmt = db.prepare(`
    SELECT
      strftime('%Y-%m-%d %H:00', created_at) as hour,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM jobs
    WHERE created_at > datetime('now', '-24 hours')
    GROUP BY hour
    ORDER BY hour ASC
  `);

  return {
    insertJob: (payload, fingerprint) => {
      const result = insertJobStmt.run(JSON.stringify(payload), fingerprint);
      return Number(result.lastInsertRowid);
    },

    getJob: (id) => getJobStmt.get(id) as Job | undefined,

    getPendingJobs: (limit) => getPendingJobsStmt.all(limit) as Job[],

    claimNextJob: () => claimNextJobStmt.get() as ClaimedJob | undefined,

    markProcessing: (id) => markProcessingStmt.run(id),

    markCompleted: (id, linearIssueId, linearIdentifier, analysis) =>
      markCompletedStmt.run(linearIssueId, linearIdentifier, analysis, id),

    markCompletedDryRun: (id, analysis) =>
      markCompletedDryRunStmt.run(analysis, id),

    markFailed: (id, error) => markFailedStmt.run(error, id),

    markDuplicate: (id, linearIdentifier) => markDuplicateStmt.run(linearIdentifier, id),

    findFingerprint: (hash, windowDays) =>
      findFingerprintStmt.get(hash, windowDays) as { linear_identifier: string } | undefined,

    insertFingerprint: (hash, linearIssueId, linearIdentifier) =>
      insertFingerprintStmt.run(hash, linearIssueId, linearIdentifier),

    getStats: () => getStatsStmt.get() as { total: number; pending: number; completed: number; failed: number; duplicate: number },

    getRecentJobs: () => getRecentJobsStmt.all() as DashboardJob[],

    getTimeline: () => getTimelineStmt.all() as TimelineEntry[],

    close: () => db.close(),
  };
}
