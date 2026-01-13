import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigFile, loadConfig } from './config.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('loadConfigFile', () => {
  const testDir = path.join(os.tmpdir(), 'lineu-config-test-' + Date.now());
  const testConfigPath = path.join(testDir, 'config.yml');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('parses valid YAML config with teams array', () => {
    const configContent = `
teams:
  - platform
  - backend
  - frontend
`;
    fs.writeFileSync(testConfigPath, configContent);

    const teams = loadConfigFile(testConfigPath);

    expect(teams).toEqual(['platform', 'backend', 'frontend']);
  });

  it('throws clear error when explicit config path does not exist', () => {
    const missingPath = path.join(testDir, 'nonexistent.yml');

    expect(() => loadConfigFile(missingPath, true)).toThrow(
      `Config file not found: ${missingPath}`
    );
  });

  it('throws clear error when teams contains non-string values', () => {
    const configContent = `
teams:
  - platform
  - 123
  - backend
`;
    fs.writeFileSync(testConfigPath, configContent);

    expect(() => loadConfigFile(testConfigPath)).toThrow(
      'teams must be an array of strings'
    );
  });
});

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LINEAR_API_KEY;
    delete process.env.LINEU_REPO;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws clear error when LINEAR_API_KEY is missing', () => {
    expect(() => loadConfig({ repo: { path: '/tmp/test-repo' } })).toThrow(
      'LINEAR_API_KEY is required'
    );
  });

  it('throws clear error when repository path is missing', () => {
    process.env.LINEAR_API_KEY = 'test-key';

    expect(() => loadConfig()).toThrow(
      'Repository path is required. Use --repo or set LINEU_REPO'
    );
  });
});
