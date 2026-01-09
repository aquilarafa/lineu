import { config as loadDotenv } from 'dotenv';
import type { LineuConfig } from '../types.js';

loadDotenv();

interface ConfigOverrides {
  repo?: { path?: string; url?: string };
  server?: { port?: number };
}

export function loadConfig(overrides: ConfigOverrides = {}): LineuConfig {
  const repoPath = overrides.repo?.path || process.env.LINEU_REPO;

  if (!repoPath) {
    throw new Error('Repository path is required. Use --repo or set LINEU_REPO');
  }

  const linearApiKey = process.env.LINEAR_API_KEY;

  if (!linearApiKey) {
    throw new Error('LINEAR_API_KEY is required');
  }

  return {
    server: {
      port: overrides.server?.port || parseInt(process.env.LINEU_PORT || '3000', 10),
    },
    repo: {
      path: repoPath,
      url: overrides.repo?.url || process.env.LINEU_REPO_URL,
    },
    database: {
      path: process.env.LINEU_DB_PATH || './lineu.db',
    },
    claude: {
      maxTurns: parseInt(process.env.LINEU_CLAUDE_MAX_TURNS || '10', 10),
      timeout: parseInt(process.env.LINEU_CLAUDE_TIMEOUT || '120000', 10),
    },
    linear: {
      apiKey: linearApiKey,
    },
    deduplication: {
      windowDays: parseInt(process.env.LINEU_DEDUP_WINDOW_DAYS || '7', 10),
    },
    worker: {
      pollInterval: parseInt(process.env.LINEU_WORKER_POLL_INTERVAL || '10000', 10),
      gitPullInterval: parseInt(process.env.LINEU_GIT_PULL_INTERVAL || '300000', 10),
    },
  };
}
