import { config as loadDotenv } from 'dotenv';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { LineuConfig, ConfigFileResult } from '../types.js';

loadDotenv();

interface ConfigFile {
  teams?: string[];
  prefix?: string;
}

export function getDefaultConfigPath(): string {
  return path.join(os.homedir(), '.lineu', 'config.yml');
}

export function getDefaultDatabasePath(): string {
  return path.join(os.homedir(), '.lineu', 'lineu.db');
}

export function loadConfigFile(configPath?: string, isExplicit = false): ConfigFileResult | null {
  const filePath = configPath || getDefaultConfigPath();
  const expandedPath = filePath.startsWith('~/')
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath;

  try {
    const content = fs.readFileSync(expandedPath, 'utf8');
    const parsed = yaml.load(content, { filename: expandedPath }) as ConfigFile;

    if (parsed?.teams && Array.isArray(parsed.teams)) {
      if (parsed.teams.every(t => typeof t === 'string')) {
        console.log(`[Config] Loaded from ${expandedPath}`);
        return {
          teams: parsed.teams,
          prefix: typeof parsed.prefix === 'string' ? parsed.prefix : undefined,
        };
      }
      throw new Error('teams must be an array of strings');
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (isExplicit) {
        throw new Error(`Config file not found: ${expandedPath}`);
      }
      return null;
    }
    throw error;
  }
}

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
      path: process.env.LINEU_DB_PATH || getDefaultDatabasePath(),
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
