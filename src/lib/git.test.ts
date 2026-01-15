import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRepoOptions } from './git.js';

describe('resolveRepoOptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REPO_PATH;
    delete process.env.REPO_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns CLI args when provided', () => {
    const result = resolveRepoOptions({
      repo: '/path/to/repo',
      repoUrl: 'https://github.com/org/repo.git',
    });

    expect(result.path).toBe('/path/to/repo');
    expect(result.url).toBe('https://github.com/org/repo.git');
  });

  it('falls back to REPO_PATH env var when no CLI arg', () => {
    process.env.REPO_PATH = '/env/path/to/repo';

    const result = resolveRepoOptions({});

    expect(result.path).toBe('/env/path/to/repo');
  });

  it('falls back to REPO_URL env var when no CLI arg', () => {
    process.env.REPO_URL = 'https://github.com/env/repo.git';

    const result = resolveRepoOptions({});

    expect(result.url).toBe('https://github.com/env/repo.git');
  });

  it('CLI args take priority over env vars', () => {
    process.env.REPO_PATH = '/env/path';
    process.env.REPO_URL = 'https://github.com/env/repo.git';

    const result = resolveRepoOptions({
      repo: '/cli/path',
      repoUrl: 'https://github.com/cli/repo.git',
    });

    expect(result.path).toBe('/cli/path');
    expect(result.url).toBe('https://github.com/cli/repo.git');
  });

  it('returns undefined when no args or env vars', () => {
    const result = resolveRepoOptions({});

    expect(result.path).toBeUndefined();
    expect(result.url).toBeUndefined();
  });

  it('handles partial CLI args with env fallback', () => {
    process.env.REPO_URL = 'https://github.com/env/repo.git';

    const result = resolveRepoOptions({
      repo: '/cli/path',
    });

    expect(result.path).toBe('/cli/path');
    expect(result.url).toBe('https://github.com/env/repo.git');
  });
});
